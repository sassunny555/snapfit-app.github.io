const { createHash, createHmac } = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

initializeApp();

setGlobalOptions({
  region: "asia-southeast1",
  maxInstances: 20,
  timeoutSeconds: 30,
  memory: "256MiB"
});

const db = getFirestore();
const hashSecret = defineSecret("CLAIM_HASH_SECRET");
const adminEmails = defineString("ADMIN_EMAILS", { default: "" });
const MAX_CODES_PER_IMPORT = 400;
const MAX_CLAIMS_PER_IP = 3;
const CAMPAIGN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,79}$/;

function requiredString(value, label, maxLength = 120) {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${label} is required.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new HttpsError("invalid-argument", `${label} is invalid.`);
  }
  return normalized;
}

function normalizeCampaignId(value) {
  const campaignId = requiredString(value, "Campaign", 64).toLowerCase();
  if (!CAMPAIGN_ID_PATTERN.test(campaignId)) {
    throw new HttpsError("invalid-argument", "Campaign ID must use lowercase letters, numbers, and hyphens.");
  }
  return campaignId;
}

function normalizeEmail(value) {
  const email = requiredString(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Enter a valid email address.");
  }
  return email;
}

function normalizeDeviceId(value) {
  const deviceId = requiredString(value, "Browser identifier", 100);
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(deviceId)) {
    throw new HttpsError("invalid-argument", "Browser identifier is invalid.");
  }
  return deviceId;
}

function getClientIp(request) {
  const forwarded = request.rawRequest?.headers?.["x-forwarded-for"];
  const candidate = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return String(request.rawRequest?.ip || candidate || "unknown").trim().slice(0, 100);
}

function privateHash(type, value) {
  const secret = process.env.CLAIM_HASH_SECRET || hashSecret.value();
  return createHmac("sha256", secret).update(`${type}:${value}`).digest("hex");
}

function stableCodeId(campaignId, code) {
  return createHash("sha256").update(`${campaignId}:${code}`).digest("hex");
}

function campaignIsOpen(campaign, now) {
  if (!campaign?.active) return false;
  const startsAt = campaign.startsAt?.toMillis?.();
  const endsAt = campaign.endsAt?.toMillis?.();
  return (!startsAt || startsAt <= now) && (!endsAt || endsAt >= now);
}

function serializeTime(value) {
  return value?.toDate?.().toISOString() || null;
}

function requireAdmin(request) {
  const email = request.auth?.token?.email?.toLowerCase();
  const verified = request.auth?.token?.email_verified === true;
  const allowed = adminEmails.value()
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (!email || !verified || !allowed.includes(email)) {
    throw new HttpsError("permission-denied", "This account is not authorized for promo administration.");
  }

  return email;
}

exports.getPromoStatus = onCall({ enforceAppCheck: false }, async (request) => {
  const campaignId = normalizeCampaignId(request.data?.campaignId);
  const snapshot = await db.collection("promoCampaigns").doc(campaignId).get();

  if (!snapshot.exists) {
    return { exists: false, active: false, availableCount: 0, claimedCount: 0 };
  }

  const campaign = snapshot.data();
  return {
    exists: true,
    name: campaign.name || "SnapFit Premium",
    active: campaignIsOpen(campaign, Date.now()),
    availableCount: Math.max(0, Number(campaign.availableCount) || 0),
    claimedCount: Math.max(0, Number(campaign.claimedCount) || 0),
    endsAt: serializeTime(campaign.endsAt)
  };
});

exports.claimPromo = onCall(
  { enforceAppCheck: false, secrets: [hashSecret] },
  async (request) => {
    const campaignId = normalizeCampaignId(request.data?.campaignId);
    const email = normalizeEmail(request.data?.email);
    const deviceId = normalizeDeviceId(request.data?.deviceId);
    const clientIp = getClientIp(request);
    const emailHash = privateHash("email", email);
    const deviceHash = privateHash("device", deviceId);
    const ipHash = privateHash("ip", clientIp);
    const campaignRef = db.collection("promoCampaigns").doc(campaignId);
    const emailLockRef = db.collection("promoClaimLocks").doc(`${campaignId}_email_${emailHash}`);
    const deviceLockRef = db.collection("promoClaimLocks").doc(`${campaignId}_device_${deviceHash}`);
    const ipStatRef = db.collection("promoIpStats").doc(`${campaignId}_${ipHash}`);
    const claimRef = db.collection("promoClaims").doc();
    const now = Timestamp.now();

    try {
      const result = await db.runTransaction(async (transaction) => {
        const [campaignSnapshot, emailLock, deviceLock, ipStat] = await Promise.all([
          transaction.get(campaignRef),
          transaction.get(emailLockRef),
          transaction.get(deviceLockRef),
          transaction.get(ipStatRef)
        ]);

        if (!campaignSnapshot.exists) {
          throw new HttpsError("failed-precondition", "This promotion is not available yet.");
        }

        const campaign = campaignSnapshot.data();
        if (!campaignIsOpen(campaign, now.toMillis())) {
          throw new HttpsError("failed-precondition", "This promotion is currently closed.");
        }
        if (emailLock.exists || deviceLock.exists) {
          throw new HttpsError("already-exists", "A free code has already been claimed with this email or browser.");
        }
        if ((ipStat.data()?.claimCount || 0) >= MAX_CLAIMS_PER_IP) {
          throw new HttpsError("resource-exhausted", "The claim limit for this network has been reached.");
        }

        const codeQuery = db.collection("promoCodes")
          .where("campaignId", "==", campaignId)
          .where("status", "==", "available")
          .orderBy("importedAt", "asc")
          .limit(1);
        const codeResults = await transaction.get(codeQuery);
        if (codeResults.empty) {
          throw new HttpsError("resource-exhausted", "All codes have been claimed.");
        }

        const codeSnapshot = codeResults.docs[0];
        const code = codeSnapshot.data().code;
        const lockData = { campaignId, claimId: claimRef.id, createdAt: now };

        transaction.update(codeSnapshot.ref, {
          status: "claimed",
          claimId: claimRef.id,
          claimedAt: now,
          updatedAt: now
        });
        transaction.create(claimRef, {
          campaignId,
          codeId: codeSnapshot.id,
          emailHash,
          deviceHash,
          ipHash,
          claimedAt: now
        });
        transaction.create(emailLockRef, { ...lockData, type: "email" });
        transaction.create(deviceLockRef, { ...lockData, type: "device" });
        transaction.set(ipStatRef, {
          campaignId,
          claimCount: FieldValue.increment(1),
          updatedAt: now
        }, { merge: true });
        transaction.update(campaignRef, {
          availableCount: FieldValue.increment(-1),
          claimedCount: FieldValue.increment(1),
          updatedAt: now
        });

        return { code, claimId: claimRef.id, claimedAt: now.toDate().toISOString() };
      });

      logger.info("Promo code claimed", { campaignId, claimId: result.claimId });
      return result;
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error("Promo claim failed", { campaignId, error });
      throw new HttpsError("internal", "We could not complete the claim. Please try again.");
    }
  }
);

exports.adminSaveCampaign = onCall({ enforceAppCheck: false }, async (request) => {
  const adminEmail = requireAdmin(request);
  const campaignId = normalizeCampaignId(request.data?.campaignId);
  const name = requiredString(request.data?.name, "Campaign name", 100);
  const active = request.data?.active === true;
  const campaignRef = db.collection("promoCampaigns").doc(campaignId);
  const existing = await campaignRef.get();
  const now = Timestamp.now();

  await campaignRef.set({
    name,
    active,
    availableCount: existing.data()?.availableCount || 0,
    claimedCount: existing.data()?.claimedCount || 0,
    createdAt: existing.data()?.createdAt || now,
    updatedAt: now,
    updatedBy: adminEmail
  }, { merge: true });

  return { ok: true, campaignId };
});

exports.adminImportCodes = onCall({ enforceAppCheck: false }, async (request) => {
  const adminEmail = requireAdmin(request);
  const campaignId = normalizeCampaignId(request.data?.campaignId);
  if (!Array.isArray(request.data?.codes)) {
    throw new HttpsError("invalid-argument", "Codes must be provided as a list.");
  }

  const codes = [...new Set(request.data.codes.map((value) => String(value).trim().toUpperCase()).filter(Boolean))];
  if (!codes.length || codes.length > MAX_CODES_PER_IMPORT) {
    throw new HttpsError("invalid-argument", `Import between 1 and ${MAX_CODES_PER_IMPORT} codes at a time.`);
  }
  if (codes.some((code) => !CODE_PATTERN.test(code))) {
    throw new HttpsError("invalid-argument", "Codes may contain uppercase letters, numbers, hyphens, and underscores only.");
  }

  const campaignRef = db.collection("promoCampaigns").doc(campaignId);
  const campaign = await campaignRef.get();
  if (!campaign.exists) {
    throw new HttpsError("failed-precondition", "Create the campaign before importing codes.");
  }

  const references = codes.map((code) => db.collection("promoCodes").doc(stableCodeId(campaignId, code)));
  const existing = await db.getAll(...references);
  const newItems = existing
    .map((snapshot, index) => ({ snapshot, code: codes[index] }))
    .filter(({ snapshot }) => !snapshot.exists);
  const now = Timestamp.now();
  const batch = db.batch();

  newItems.forEach(({ snapshot, code }) => {
    batch.create(snapshot.ref, {
      campaignId,
      code,
      status: "available",
      importedAt: now,
      updatedAt: now,
      importedBy: adminEmail
    });
  });
  if (newItems.length) {
    batch.update(campaignRef, {
      availableCount: FieldValue.increment(newItems.length),
      updatedAt: now,
      updatedBy: adminEmail
    });
    await batch.commit();
  }

  return { imported: newItems.length, duplicates: codes.length - newItems.length };
});

exports.adminListCodes = onCall({ enforceAppCheck: false }, async (request) => {
  requireAdmin(request);
  const campaignId = normalizeCampaignId(request.data?.campaignId);
  const status = request.data?.status === "claimed" ? "claimed" : "available";
  const orderField = status === "claimed" ? "claimedAt" : "importedAt";
  const orderDirection = status === "claimed" ? "desc" : "asc";
  const snapshot = await db.collection("promoCodes")
    .where("campaignId", "==", campaignId)
    .where("status", "==", status)
    .orderBy(orderField, orderDirection)
    .limit(100)
    .get();

  return {
    codes: snapshot.docs.map((doc) => ({
      id: doc.id,
      code: doc.data().code,
      status: doc.data().status,
      importedAt: serializeTime(doc.data().importedAt),
      claimedAt: serializeTime(doc.data().claimedAt)
    }))
  };
});

exports.adminDeleteAvailableCodes = onCall({ enforceAppCheck: false }, async (request) => {
  const adminEmail = requireAdmin(request);
  const campaignId = normalizeCampaignId(request.data?.campaignId);
  const ids = Array.isArray(request.data?.codeIds) ? [...new Set(request.data.codeIds)] : [];
  if (!ids.length || ids.length > 100 || ids.some((id) => !/^[a-f0-9]{64}$/.test(String(id)))) {
    throw new HttpsError("invalid-argument", "Select between 1 and 100 valid available codes.");
  }

  const codeRefs = ids.map((id) => db.collection("promoCodes").doc(id));
  const campaignRef = db.collection("promoCampaigns").doc(campaignId);
  const deleted = await db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(codeRefs.map((ref) => transaction.get(ref)));
    const deletable = snapshots.filter((snapshot) =>
      snapshot.exists &&
      snapshot.data().campaignId === campaignId &&
      snapshot.data().status === "available"
    );
    deletable.forEach((snapshot) => transaction.delete(snapshot.ref));
    if (deletable.length) {
      transaction.update(campaignRef, {
        availableCount: FieldValue.increment(-deletable.length),
        updatedAt: Timestamp.now(),
        updatedBy: adminEmail
      });
    }
    return deletable.length;
  });

  return { deleted };
});
