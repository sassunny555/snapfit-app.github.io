import { promoApi } from "./firebase-config.js?v=20260830-campaign-cards";

let publicCampaignId = null;

const elements = {
  loading: document.getElementById("loadingState"),
  claim: document.getElementById("claimState"),
  success: document.getElementById("successState"),
  empty: document.getElementById("emptyState"),
  closed: document.getElementById("closedState"),
  form: document.getElementById("claimForm"),
  name: document.getElementById("claimName"),
  button: document.getElementById("claimButton"),
  message: document.getElementById("formMessage"),
  inventory: document.getElementById("inventoryText"),
  remaining: document.getElementById("remainingCount"),
  code: document.getElementById("claimedCode"),
  copy: document.getElementById("copyButton")
};

const states = [elements.loading, elements.claim, elements.success, elements.empty, elements.closed];

function showState(target) {
  states.forEach((state) => { state.hidden = state !== target; });
}

function getDeviceId() {
  const storageKey = "snapfit_promo_device_id";
  try {
    let value = localStorage.getItem(storageKey);
    if (!value) {
      value = crypto.randomUUID();
      localStorage.setItem(storageKey, value);
    }
    return value;
  } catch {
    return crypto.randomUUID();
  }
}

function readableError(error) {
  const message = String(error?.message || "").replace(/^Firebase:\s*/i, "").replace(/\s*\(functions\/[\w-]+\)\.?$/i, "");
  if (message.includes("already been claimed")) return "A code has already been claimed from this browser.";
  if (message.includes("network")) return "This network has reached its claim limit.";
  if (message.includes("Too many claim attempts")) return "Too many attempts. Please wait 10 minutes and try again.";
  if (message.includes("All codes")) return "All codes have been claimed.";
  if (message.includes("closed")) return "This promotion is currently closed.";
  return message || "Something went wrong. Please try again.";
}

async function loadStatus() {
  showState(elements.loading);
  const preview = location.hostname === "localhost" ? new URLSearchParams(location.search).get("preview") : null;
  if (preview === "claim") {
    elements.remaining.textContent = "42";
    elements.inventory.textContent = "codes remaining";
    showState(elements.claim);
    return;
  }
  if (preview === "success") {
    elements.code.textContent = "SNAPFIT-PREMIUM-DEMO";
    showState(elements.success);
    return;
  }
  if (preview === "empty") {
    showState(elements.empty);
    return;
  }
  try {
    const { data } = await promoApi.status({});
    publicCampaignId = data.campaignId;
    if (!data.exists || !data.active) {
      showState(elements.closed);
    } else if (data.availableCount < 1) {
      showState(elements.empty);
    } else {
      elements.remaining.textContent = data.availableCount.toLocaleString();
      elements.inventory.textContent = data.availableCount === 1 ? "code remaining" : "codes remaining";
      showState(elements.claim);
    }
  } catch {
    showState(elements.closed);
  }
}

function validateName() {
  const name = elements.name.value.trim().replace(/\s+/g, " ");
  const valid = name.length >= 2 && name.length <= 80;
  elements.name.setAttribute("aria-invalid", String(!valid));
  return valid;
}

elements.name.addEventListener("blur", validateName);

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.message.textContent = "";

  if (!validateName()) {
    elements.message.textContent = "Enter your name to continue.";
    elements.name.focus();
    return;
  }

  elements.button.disabled = true;
  elements.button.querySelector("span").textContent = "Assigning your code…";
  try {
    const { data } = await promoApi.claim({
      campaignId: publicCampaignId,
      name: elements.name.value,
      deviceId: getDeviceId()
    });
    elements.code.textContent = data.code;
    showState(elements.success);
    elements.copy.focus();
  } catch (error) {
    const message = readableError(error);
    if (message === "All codes have been claimed.") {
      showState(elements.empty);
    } else if (message.includes("currently closed")) {
      showState(elements.closed);
    } else {
      elements.message.textContent = message;
    }
  } finally {
    elements.button.disabled = false;
    elements.button.querySelector("span").textContent = "Claim promo";
  }
});

elements.copy.addEventListener("click", async () => {
  const label = elements.copy.querySelector("span");
  try {
    await navigator.clipboard.writeText(elements.code.textContent);
    label.textContent = "Copied";
    window.setTimeout(() => { label.textContent = "Copy"; }, 1800);
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(elements.code);
    selection.removeAllRanges();
    selection.addRange(range);
    label.textContent = "Selected";
  }
});

loadStatus();
