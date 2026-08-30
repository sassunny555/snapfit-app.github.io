import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDg3IhSmbgvEKGhVCpWi3t3c7ak-TDuxYc",
  authDomain: "snapfit-web-820e0.firebaseapp.com",
  projectId: "snapfit-web-820e0",
  storageBucket: "snapfit-web-820e0.firebasestorage.app",
  messagingSenderId: "949121621944",
  appId: "1:949121621944:web:3267eeda1b63c7287f394d"
};

export const PROMO_CAMPAIGN_ID = "premium-launch-2026";
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

async function callPromoApi(action, data, requiresAdmin = false) {
  const headers = { "Content-Type": "application/json" };
  if (requiresAdmin) {
    const user = auth.currentUser;
    if (!user) throw new Error("Sign in with an authorized Google account.");
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  }

  const response = await fetch("/api/promo", {
    method: "POST",
    headers,
    body: JSON.stringify({ action, data })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || "The promo service is unavailable.");
    error.code = payload.error?.code;
    throw error;
  }
  return payload;
}

export const promoApi = {
  status: (data) => callPromoApi("getPromoStatus", data),
  claim: (data) => callPromoApi("claimPromo", data),
  saveCampaign: (data) => callPromoApi("adminSaveCampaign", data, true),
  importCodes: (data) => callPromoApi("adminImportCodes", data, true),
  listCodes: (data) => callPromoApi("adminListCodes", data, true),
  deleteCodes: (data) => callPromoApi("adminDeleteAvailableCodes", data, true)
};

export { onAuthStateChanged, signInWithPopup, signOut };
