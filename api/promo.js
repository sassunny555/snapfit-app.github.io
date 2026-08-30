const { createHash, createHmac, randomBytes, timingSafeEqual } = require("node:crypto");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "snapfit-web-820e0";
const MAX_CODES_PER_IMPORT = 400;
const MAX_CLAIMS_PER_IP = 3;
const MAX_CLAIM_ATTEMPTS_PER_WINDOW = 8;
const CLAIM_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const CLAIM_COOKIE_NAME = "snapfit_promo_visitor";
const CLAIM_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const DEFAULT_CAMPAIGN_ID = "premium-launch-2026";
const CAMPAIGN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,79}$/;
const ADMIN_ACTIONS = new Set([
  "adminSaveCampaign",
  "adminImportCodes",
  "adminListCodes",
  "adminListCampaigns",
  "adminSetPublicCampaign",
  "adminGetAbuseSummary",
  "adminDeleteAvailableCodes"
]);

function firebaseCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    return cert(serviceAccount);
  }

  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return cert({
      projectId: PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    });
  }

  throw new Error("Firebase Admin credentials are not configured.");
}

function adminApp() {
  return getApps()[0] || initializeApp({ credential: firebaseCredential(), projectId: PROJECT_ID });
}

function db() {
  return getFirestore(adminApp());
}

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requiredString(value, label, maxLength = 120) {
  if (typeof value !== "string") throw new ApiError(400, "invalid-argument", `${label} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new ApiError(400, "invalid-argument", `${label} is invalid.`);
  return normalized;
}

function normalizeCampaignId(value) {
  const campaignId = requiredString(value, "Campaign", 64).toLowerCase();
  if (!CAMPAIGN_ID_PATTERN.test(campaignId)) {
    throw new ApiError(400, "invalid-argument", "Campaign ID must use lowercase letters, numbers, and hyphens.");
  }
  return campaignId;
}

function normalizeName(value) {
  const name = requiredString(value, "Name", 80).replace(/\s+/g, " ");
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\p{N} .'-]{1,79}$/u.test(name)) {
    throw new ApiError(400, "invalid-argument", "Enter a valid name.");
  }
  return name;
}

function normalizeDeviceId(value) {
  const deviceId = requiredString(value, "Browser identifier", 100);
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(deviceId)) {
    throw new ApiError(400, "invalid-argument", "Browser identifier is invalid.");
  }
  return deviceId;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const candidate = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return String(req.headers["x-real-ip"] || candidate || req.socket?.remoteAddress || "unknown").trim().slice(0, 100);
}

function privateHash(type, value) {
  const secret = process.env.CLAIM_HASH_SECRET;
  if (!secret || secret.length < 32) throw new Error("CLAIM_HASH_SECRET must contain at least 32 characters.");
  return createHmac("sha256", secret).update(`${type}:${value}`).digest("hex");
}

function parseCookies(req) {
  return String(req.headers.cookie || "").split(";").reduce((cookies, item) => {
    const separator = item.indexOf("=");
    if (separator < 1) return cookies;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key) cookies[key] = value;
    return cookies;
  }, {});
}

function signVisitorId(visitorId) {
  return createHmac("sha256", process.env.CLAIM_HASH_SECRET).update(`cookie:${visitorId}`).digest("base64url");
}

function verifiedVisitorId(req) {
  const value = parseCookies(req)[CLAIM_COOKIE_NAME];
  if (!value) return null;
  const [visitorId, signature] = value.split(".");
  if (!/^[a-f0-9]{64}$/.test(visitorId || "") || !signature) return null;
  const expected = Buffer.from(signVisitorId(visitorId));
  const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied) ? visitorId : null;
}

function visitorCookie(visitorId) {
  return `${CLAIM_COOKIE_NAME}=${visitorId}.${signVisitorId(visitorId)}; Path=/; Max-Age=${CLAIM_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

async function checkClaimRateLimit(campaignId, ipHash) {
  const firestore = db();
  const rateRef = firestore.collection("promoRateLimits").doc(`${campaignId}_${ipHash}`);
  const now = Timestamp.now();
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateRef);
    const current = snapshot.data();
    const windowStart = current?.windowStart?.toMillis?.() || 0;
    const inCurrentWindow = now.toMillis() - windowStart < CLAIM_ATTEMPT_WINDOW_MS;
    const attempts = inCurrentWindow ? (Number(current.attempts) || 0) + 1 : 1;
    transaction.set(rateRef, {
      campaignId,
      attempts,
      windowStart: inCurrentWindow ? current.windowStart : now,
      updatedAt: now
    });
    return attempts <= MAX_CLAIM_ATTEMPTS_PER_WINDOW;
  });
}

async function recordBlockedClaim(data, req, error) {
  try {
    const campaignId = typeof data?.campaignId === "string" && CAMPAIGN_ID_PATTERN.test(data.campaignId.toLowerCase())
      ? data.campaignId.toLowerCase()
      : "unknown";
    const rawDeviceId = typeof data?.deviceId === "string" ? data.deviceId : "unknown";
    await db().collection("promoBlockedAttempts").add({
      campaignId,
      reason: error.code || "rejected",
      deviceHash: privateHash("device", rawDeviceId.slice(0, 100)),
      ipHash: privateHash("ip", clientIp(req)),
      blockedAt: Timestamp.now()
    });
  } catch (auditError) {
    console.error("Could not record blocked promo attempt", auditError);
  }
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

async function requireAdmin(req) {
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    throw new ApiError(401, "unauthenticated", "Sign in with an authorized admin account.");
  }

  let decoded;
  try {
    const { getAuth } = await import("firebase-admin/auth");
    decoded = await getAuth(adminApp()).verifyIdToken(authorization.slice(7));
  } catch (error) {
    console.error("Promo admin token verification failed", {
      code: error?.code || "unknown",
      message: error?.message || "Token verification failed"
    });
    throw new ApiError(401, "unauthenticated", "Your admin session is invalid or expired.");
  }

  const email = decoded.email?.toLowerCase();
  const provider = decoded.firebase?.sign_in_provider;
  const allowed = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!email || provider !== "password" || !allowed.includes(email)) {
    throw new ApiError(403, "permission-denied", "This account is not authorized for promo administration.");
  }
  return email;
}

async function getPromoStatus(data) {
  let campaignId;
  if (data?.campaignId) {
    campaignId = normalizeCampaignId(data.campaignId);
  } else {
    const publicSettings = await db().collection("promoSettings").doc("public").get();
    campaignId = publicSettings.exists
      ? normalizeCampaignId(publicSettings.data().campaignId)
      : DEFAULT_CAMPAIGN_ID;
  }
  const snapshot = await db().collection("promoCampaigns").doc(campaignId).get();
  if (!snapshot.exists) return { campaignId, exists: false, active: false, availableCount: 0, claimedCount: 0 };
  const campaign = snapshot.data();
  return {
    exists: true,
    campaignId,
    name: campaign.name || "SnapFit Premium",
    active: campaignIsOpen(campaign, Date.now()),
    availableCount: Math.max(0, Number(campaign.availableCount) || 0),
    claimedCount: Math.max(0, Number(campaign.claimedCount) || 0),
    endsAt: serializeTime(campaign.endsAt)
  };
}

async function claimPromo(data, req, visitorId) {
  const campaignId = normalizeCampaignId(data.campaignId);
  const claimantName = normalizeName(data.name);
  const deviceId = normalizeDeviceId(data.deviceId);
  const deviceHash = privateHash("device", deviceId);
  const ipHash = privateHash("ip", clientIp(req));
  if (!(await checkClaimRateLimit(campaignId, ipHash))) {
    throw new ApiError(429, "rate-limited", "Too many claim attempts. Please wait before trying again.");
  }
  const firestore = db();
  const campaignRef = firestore.collection("promoCampaigns").doc(campaignId);
  const deviceLockRef = firestore.collection("promoClaimLocks").doc(`${campaignId}_device_${deviceHash}`);
  const visitorHash = privateHash("visitor", visitorId);
  const visitorLockRef = firestore.collection("promoClaimLocks").doc(`${campaignId}_visitor_${visitorHash}`);
  const ipStatRef = firestore.collection("promoIpStats").doc(`${campaignId}_${ipHash}`);
  const claimRef = firestore.collection("promoClaims").doc();
  const now = Timestamp.now();

  return firestore.runTransaction(async (transaction) => {
    const [campaignSnapshot, deviceLock, visitorLock, ipStat] = await Promise.all([
      transaction.get(campaignRef),
      transaction.get(deviceLockRef),
      transaction.get(visitorLockRef),
      transaction.get(ipStatRef)
    ]);
    if (!campaignSnapshot.exists) throw new ApiError(409, "failed-precondition", "This promotion is not available yet.");
    if (!campaignIsOpen(campaignSnapshot.data(), now.toMillis())) {
      throw new ApiError(409, "failed-precondition", "This promotion is currently closed.");
    }
    if (deviceLock.exists || visitorLock.exists) {
      throw new ApiError(409, "already-exists", "A free code has already been claimed from this browser.");
    }
    if ((ipStat.data()?.claimCount || 0) >= MAX_CLAIMS_PER_IP) {
      throw new ApiError(429, "resource-exhausted", "The claim limit for this network has been reached.");
    }

    const codeQuery = firestore.collection("promoCodes")
      .where("campaignId", "==", campaignId)
      .where("status", "==", "available")
      .orderBy("importedAt", "asc")
      .limit(1);
    const codeResults = await transaction.get(codeQuery);
    if (codeResults.empty) throw new ApiError(409, "resource-exhausted", "All codes have been claimed.");

    const codeSnapshot = codeResults.docs[0];
    const code = codeSnapshot.data().code;
    const lockData = { campaignId, claimId: claimRef.id, createdAt: now };
    transaction.update(codeSnapshot.ref, { status: "claimed", claimId: claimRef.id, claimedAt: now, updatedAt: now });
    transaction.create(claimRef, { campaignId, codeId: codeSnapshot.id, claimantName, deviceHash, ipHash, claimedAt: now });
    transaction.create(deviceLockRef, { ...lockData, type: "device" });
    transaction.create(visitorLockRef, { ...lockData, type: "signed-cookie" });
    transaction.set(ipStatRef, { campaignId, claimCount: FieldValue.increment(1), updatedAt: now }, { merge: true });
    transaction.update(campaignRef, {
      availableCount: FieldValue.increment(-1),
      claimedCount: FieldValue.increment(1),
      updatedAt: now
    });
    return { code, claimId: claimRef.id, claimedAt: now.toDate().toISOString() };
  });
}

async function adminSaveCampaign(data, adminEmail) {
  const campaignId = normalizeCampaignId(data.campaignId);
  const name = requiredString(data.name, "Campaign name", 100);
  const active = data.active === true;
  const campaignRef = db().collection("promoCampaigns").doc(campaignId);
  const existing = await campaignRef.get();
  if (data.createOnly === true && existing.exists) {
    throw new ApiError(409, "already-exists", "That campaign ID is already in use.");
  }
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
}

async function adminListCampaigns() {
  const firestore = db();
  const [campaigns, publicSettings] = await Promise.all([
    firestore.collection("promoCampaigns").orderBy("updatedAt", "desc").limit(50).get(),
    firestore.collection("promoSettings").doc("public").get()
  ]);
  const publicCampaignId = publicSettings.exists ? publicSettings.data().campaignId : DEFAULT_CAMPAIGN_ID;
  return {
    publicCampaignId,
    campaigns: campaigns.docs.map((doc) => ({
      id: doc.id,
      name: doc.data().name || doc.id,
      active: doc.data().active === true,
      availableCount: Math.max(0, Number(doc.data().availableCount) || 0),
      claimedCount: Math.max(0, Number(doc.data().claimedCount) || 0),
      updatedAt: serializeTime(doc.data().updatedAt)
    }))
  };
}

async function adminSetPublicCampaign(data, adminEmail) {
  const campaignId = normalizeCampaignId(data.campaignId);
  const firestore = db();
  const campaign = await firestore.collection("promoCampaigns").doc(campaignId).get();
  if (!campaign.exists) throw new ApiError(404, "not-found", "Campaign not found.");
  await firestore.collection("promoSettings").doc("public").set({
    campaignId,
    updatedAt: Timestamp.now(),
    updatedBy: adminEmail
  });
  return { ok: true, campaignId };
}

async function adminImportCodes(data, adminEmail) {
  const campaignId = normalizeCampaignId(data.campaignId);
  if (!Array.isArray(data.codes)) throw new ApiError(400, "invalid-argument", "Codes must be provided as a list.");
  const codes = [...new Set(data.codes.map((value) => String(value).trim().toUpperCase()).filter(Boolean))];
  if (!codes.length || codes.length > MAX_CODES_PER_IMPORT) {
    throw new ApiError(400, "invalid-argument", `Import between 1 and ${MAX_CODES_PER_IMPORT} codes at a time.`);
  }
  if (codes.some((code) => !CODE_PATTERN.test(code))) {
    throw new ApiError(400, "invalid-argument", "Codes may contain uppercase letters, numbers, hyphens, and underscores only.");
  }

  const firestore = db();
  const campaignRef = firestore.collection("promoCampaigns").doc(campaignId);
  if (!(await campaignRef.get()).exists) throw new ApiError(409, "failed-precondition", "Create the campaign before importing codes.");
  const references = codes.map((code) => firestore.collection("promoCodes").doc(stableCodeId(campaignId, code)));
  const existing = await firestore.getAll(...references);
  const newItems = existing.map((snapshot, index) => ({ snapshot, code: codes[index] })).filter(({ snapshot }) => !snapshot.exists);
  const now = Timestamp.now();
  const batch = firestore.batch();
  newItems.forEach(({ snapshot, code }) => batch.create(snapshot.ref, {
    campaignId, code, status: "available", importedAt: now, updatedAt: now, importedBy: adminEmail
  }));
  if (newItems.length) {
    batch.update(campaignRef, {
      availableCount: FieldValue.increment(newItems.length), updatedAt: now, updatedBy: adminEmail
    });
    await batch.commit();
  }
  return { imported: newItems.length, duplicates: codes.length - newItems.length };
}

async function adminListCodes(data) {
  const campaignId = normalizeCampaignId(data.campaignId);
  const status = data.status === "claimed" ? "claimed" : "available";
  const orderField = status === "claimed" ? "claimedAt" : "importedAt";
  const direction = status === "claimed" ? "desc" : "asc";
  const snapshot = await db().collection("promoCodes")
    .where("campaignId", "==", campaignId)
    .where("status", "==", status)
    .orderBy(orderField, direction)
    .limit(100)
    .get();
  return { codes: snapshot.docs.map((doc) => ({
    id: doc.id,
    code: doc.data().code,
    status: doc.data().status,
    importedAt: serializeTime(doc.data().importedAt),
    claimedAt: serializeTime(doc.data().claimedAt)
  })) };
}

async function adminGetAbuseSummary(data) {
  const campaignId = normalizeCampaignId(data.campaignId);
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  const snapshot = await db().collection("promoBlockedAttempts")
    .orderBy("blockedAt", "desc")
    .limit(100)
    .get();
  const recent = snapshot.docs.filter((doc) => {
    const attempt = doc.data();
    return attempt.campaignId === campaignId && (attempt.blockedAt?.toMillis?.() || 0) >= cutoff;
  });
  const reasons = recent.reduce((counts, doc) => {
    const reason = doc.data().reason || "rejected";
    counts[reason] = (counts[reason] || 0) + 1;
    return counts;
  }, {});
  return {
    blockedLast24Hours: recent.length,
    reasons,
    protections: {
      claimsPerBrowser: 1,
      maxClaimsPerIp: MAX_CLAIMS_PER_IP,
      maxAttemptsPerTenMinutes: MAX_CLAIM_ATTEMPTS_PER_WINDOW
    }
  };
}

async function adminDeleteAvailableCodes(data, adminEmail) {
  const campaignId = normalizeCampaignId(data.campaignId);
  const ids = Array.isArray(data.codeIds) ? [...new Set(data.codeIds)] : [];
  if (!ids.length || ids.length > 100 || ids.some((id) => !/^[a-f0-9]{64}$/.test(String(id)))) {
    throw new ApiError(400, "invalid-argument", "Select between 1 and 100 valid available codes.");
  }
  const firestore = db();
  const refs = ids.map((id) => firestore.collection("promoCodes").doc(id));
  const campaignRef = firestore.collection("promoCampaigns").doc(campaignId);
  const deleted = await firestore.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    const deletable = snapshots.filter((snapshot) => snapshot.exists && snapshot.data().campaignId === campaignId && snapshot.data().status === "available");
    deletable.forEach((snapshot) => transaction.delete(snapshot.ref));
    if (deletable.length) transaction.update(campaignRef, {
      availableCount: FieldValue.increment(-deletable.length), updatedAt: Timestamp.now(), updatedBy: adminEmail
    });
    return deletable.length;
  });
  return { deleted };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") return res.status(405).json({ error: { code: "method-not-allowed", message: "Use POST." } });

  let requestAction = null;
  let requestData = {};
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const action = requiredString(body.action, "Action", 60);
    const data = body.data || {};
    requestAction = action;
    requestData = data;
    const adminEmail = ADMIN_ACTIONS.has(action) ? await requireAdmin(req) : null;
    let result;
    if (action === "getPromoStatus") result = await getPromoStatus(data);
    else if (action === "claimPromo") {
      const visitorId = verifiedVisitorId(req) || randomBytes(32).toString("hex");
      result = await claimPromo(data, req, visitorId);
      res.setHeader("Set-Cookie", visitorCookie(visitorId));
    }
    else if (action === "adminSaveCampaign") result = await adminSaveCampaign(data, adminEmail);
    else if (action === "adminImportCodes") result = await adminImportCodes(data, adminEmail);
    else if (action === "adminListCodes") result = await adminListCodes(data);
    else if (action === "adminListCampaigns") result = await adminListCampaigns();
    else if (action === "adminSetPublicCampaign") result = await adminSetPublicCampaign(data, adminEmail);
    else if (action === "adminGetAbuseSummary") result = await adminGetAbuseSummary(data);
    else if (action === "adminDeleteAvailableCodes") result = await adminDeleteAvailableCodes(data, adminEmail);
    else throw new ApiError(404, "not-found", "Unknown promo action.");
    return res.status(200).json({ data: result });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : "internal";
    const message = error instanceof ApiError ? error.message : "The promo service could not complete this request.";
    if (error instanceof ApiError && requestAction === "claimPromo") {
      await recordBlockedClaim(requestData, req, error);
    }
    if (status === 500) console.error("Promo API error", error);
    return res.status(status).json({ error: { code, message } });
  }
};
