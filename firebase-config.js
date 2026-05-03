// ============================================================
// firebase-config.js
// Initialize Firebase app and export shared services
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 🔧 REPLACE with your own Firebase project config
// Go to: Firebase Console → Project Settings → Your Apps → Firebase SDK snippet
const firebaseConfig = {
  apiKey: "AIzaSyCGX4xWYrpfYRfIce20GYISa3Pcn6It4Y0",
  authDomain: "hisab-9454a.firebaseapp.com",
  projectId: "hisab-9454a",
  storageBucket: "hisab-9454a.firebasestorage.app",
  messagingSenderId: "797649665700",
  appId: "1:797649665700:web:fa08ea4f2040a997103031",
  measurementId: "G-0C0W62KWYD"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export auth and firestore instances for use across the app
export const auth = getAuth(app);
export const db = getFirestore(app);
