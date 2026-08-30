import {
  PROMO_CAMPAIGN_ID,
  auth,
  onAuthStateChanged,
  promoApi,
  signInWithEmailAndPassword,
  signOut
} from "./firebase-config.js?v=20260830-auth-fix";

const elements = {
  authPanel: document.getElementById("authPanel"),
  adminPanel: document.getElementById("adminPanel"),
  signInForm: document.getElementById("signInForm"),
  email: document.getElementById("adminEmail"),
  password: document.getElementById("adminPassword"),
  signIn: document.getElementById("signInButton"),
  signOut: document.getElementById("signOutButton"),
  authMessage: document.getElementById("authMessage"),
  signedIn: document.getElementById("signedInText"),
  campaignForm: document.getElementById("campaignForm"),
  campaignId: document.getElementById("campaignId"),
  campaignName: document.getElementById("campaignName"),
  campaignActive: document.getElementById("campaignActive"),
  campaignMessage: document.getElementById("campaignMessage"),
  importForm: document.getElementById("importForm"),
  codeInput: document.getElementById("codeInput"),
  importButton: document.getElementById("importButton"),
  importMessage: document.getElementById("importMessage"),
  availableCount: document.getElementById("availableCount"),
  claimedCount: document.getElementById("claimedCount"),
  blockedCount: document.getElementById("blockedCount"),
  protectionSummary: document.getElementById("protectionSummary"),
  rows: document.getElementById("codeRows"),
  refresh: document.getElementById("refreshButton"),
  delete: document.getElementById("deleteButton"),
  inventoryMessage: document.getElementById("inventoryMessage"),
  tabs: [...document.querySelectorAll(".tab-button")]
};

let activeStatus = "available";
elements.campaignId.value = PROMO_CAMPAIGN_ID;

function errorText(error) {
  return String(error?.message || "Something went wrong.")
    .replace(/^Firebase:\s*/i, "")
    .replace(/\s*\(functions\/[\w-]+\)\.?$/i, "");
}

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function renderRows(codes) {
  elements.rows.replaceChildren();
  if (!codes.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = `No ${activeStatus} codes found.`;
    row.append(cell);
    elements.rows.append(row);
    return;
  }

  codes.forEach((item) => {
    const row = document.createElement("tr");
    const selectCell = document.createElement("td");
    if (item.status === "available") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = item.id;
      checkbox.setAttribute("aria-label", `Select ${item.code}`);
      selectCell.append(checkbox);
    }

    const codeCell = document.createElement("td");
    const code = document.createElement("code");
    code.textContent = item.code;
    codeCell.append(code);

    const statusCell = document.createElement("td");
    const chip = document.createElement("span");
    chip.className = `status-chip ${item.status}`;
    chip.textContent = item.status;
    statusCell.append(chip);

    const timeCell = document.createElement("td");
    timeCell.textContent = formatTime(item.claimedAt || item.importedAt);
    row.append(selectCell, codeCell, statusCell, timeCell);
    elements.rows.append(row);
  });
}

async function loadCampaign() {
  const { data } = await promoApi.status({ campaignId: PROMO_CAMPAIGN_ID });
  elements.campaignName.value = data.name || elements.campaignName.value;
  elements.campaignActive.checked = data.active === true;
  elements.availableCount.textContent = (data.availableCount || 0).toLocaleString();
  elements.claimedCount.textContent = (data.claimedCount || 0).toLocaleString();
}

async function loadCodes() {
  elements.rows.innerHTML = '<tr><td colspan="4">Loading inventory…</td></tr>';
  setMessage(elements.inventoryMessage, "");
  try {
    const { data } = await promoApi.listCodes({ campaignId: PROMO_CAMPAIGN_ID, status: activeStatus });
    renderRows(data.codes);
  } catch (error) {
    elements.rows.innerHTML = '<tr><td colspan="4">Unable to load inventory.</td></tr>';
    throw error;
  }
}

async function loadAbuseSummary() {
  const { data } = await promoApi.getAbuseSummary({ campaignId: PROMO_CAMPAIGN_ID });
  elements.blockedCount.textContent = (data.blockedLast24Hours || 0).toLocaleString();
  elements.protectionSummary.textContent = `Active: 1 claim per browser, up to ${data.protections.maxClaimsPerIp} per network, and ${data.protections.maxAttemptsPerTenMinutes} attempts per 10 minutes.`;
}

async function refreshDashboard() {
  try {
    await Promise.all([loadCampaign(), loadCodes(), loadAbuseSummary()]);
  } catch (error) {
    const message = errorText(error);
    setMessage(elements.inventoryMessage, message, true);
    if (message.includes("not authorized")) {
      elements.adminPanel.hidden = true;
      elements.authPanel.hidden = false;
      setMessage(elements.authMessage, message, true);
    }
  }
}

elements.signInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.signIn.disabled = true;
  setMessage(elements.authMessage, "");
  try {
    await signInWithEmailAndPassword(auth, elements.email.value.trim(), elements.password.value);
    elements.password.value = "";
  } catch (error) {
    const message = errorText(error);
    setMessage(elements.authMessage, message.includes("auth/") ? "Invalid email or password." : message, true);
  } finally {
    elements.signIn.disabled = false;
  }
});

elements.signOut.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  elements.authPanel.hidden = Boolean(user);
  elements.adminPanel.hidden = !user;
  if (user) {
    elements.signedIn.textContent = `Signed in as ${user.email}`;
    refreshDashboard();
  }
});

elements.campaignForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = elements.campaignForm.querySelector('button[type="submit"]');
  button.disabled = true;
  setMessage(elements.campaignMessage, "Saving…");
  try {
    await promoApi.saveCampaign({
      campaignId: PROMO_CAMPAIGN_ID,
      name: elements.campaignName.value,
      active: elements.campaignActive.checked
    });
    setMessage(elements.campaignMessage, "Campaign saved.");
    await loadCampaign();
  } catch (error) {
    setMessage(elements.campaignMessage, errorText(error), true);
  } finally {
    button.disabled = false;
  }
});

elements.importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const codes = [...new Set(elements.codeInput.value.split(/[\s,;]+/).map((code) => code.trim()).filter(Boolean))];
  if (!codes.length) {
    setMessage(elements.importMessage, "Paste at least one code.", true);
    return;
  }

  elements.importButton.disabled = true;
  let imported = 0;
  let duplicates = 0;
  try {
    for (let index = 0; index < codes.length; index += 400) {
      setMessage(elements.importMessage, `Importing ${Math.min(index + 400, codes.length)} of ${codes.length}…`);
      const { data } = await promoApi.importCodes({
        campaignId: PROMO_CAMPAIGN_ID,
        codes: codes.slice(index, index + 400)
      });
      imported += data.imported;
      duplicates += data.duplicates;
    }
    elements.codeInput.value = "";
    setMessage(elements.importMessage, `Imported ${imported} code${imported === 1 ? "" : "s"}. ${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped.`);
    await refreshDashboard();
  } catch (error) {
    setMessage(elements.importMessage, errorText(error), true);
  } finally {
    elements.importButton.disabled = false;
  }
});

elements.tabs.forEach((button) => {
  button.addEventListener("click", async () => {
    activeStatus = button.dataset.status;
    elements.tabs.forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    elements.delete.hidden = activeStatus !== "available";
    try {
      await loadCodes();
    } catch (error) {
      setMessage(elements.inventoryMessage, errorText(error), true);
    }
  });
});

elements.refresh.addEventListener("click", refreshDashboard);

elements.delete.addEventListener("click", async () => {
  const selected = [...elements.rows.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
  if (!selected.length) {
    setMessage(elements.inventoryMessage, "Select at least one available code.", true);
    return;
  }
  if (!window.confirm(`Delete ${selected.length} selected available code${selected.length === 1 ? "" : "s"}?`)) return;

  elements.delete.disabled = true;
  try {
    const { data } = await promoApi.deleteCodes({ campaignId: PROMO_CAMPAIGN_ID, codeIds: selected });
    setMessage(elements.inventoryMessage, `Deleted ${data.deleted} available code${data.deleted === 1 ? "" : "s"}.`);
    await refreshDashboard();
  } catch (error) {
    setMessage(elements.inventoryMessage, errorText(error), true);
  } finally {
    elements.delete.disabled = false;
  }
});
