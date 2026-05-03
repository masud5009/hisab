// ============================================================
// firebase-config.js
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
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

export const auth = getAuth(app);
export const db = getFirestore(app);