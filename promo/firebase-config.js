import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";

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
export const functions = getFunctions(app, "asia-southeast1");
export const googleProvider = new GoogleAuthProvider();

if (location.hostname === "localhost" && new URLSearchParams(location.search).has("emulator")) {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

export const promoApi = {
  status: httpsCallable(functions, "getPromoStatus"),
  claim: httpsCallable(functions, "claimPromo"),
  saveCampaign: httpsCallable(functions, "adminSaveCampaign"),
  importCodes: httpsCallable(functions, "adminImportCodes"),
  listCodes: httpsCallable(functions, "adminListCodes"),
  deleteCodes: httpsCallable(functions, "adminDeleteAvailableCodes")
};

export { onAuthStateChanged, signInWithPopup, signOut };
