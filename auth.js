// ============================================================
// auth.js
// Handles Firebase Authentication for admin and users
// ============================================================

import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─────────────────────────────────────────────
// Convert username → fake email for Firebase Auth
// e.g. "masud" → "masud@hisab.local"
// ─────────────────────────────────────────────
export function usernameToEmail(username) {
  const value = username.trim().toLowerCase();
  // Accept both plain usernames (e.g. "masud") and email-like input.
  return value.includes("@") ? value : `${value}@hisab.local`;
}

export async function sendResetEmail(email) {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

// ─────────────────────────────────────────────
// Admin Login
// ─────────────────────────────────────────────
export async function adminLogin(username, password) {
  try {
    const email = usernameToEmail(username);

    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    const userDoc = await getDoc(doc(db, "users", uid));
    if (!userDoc.exists() || userDoc.data().role !== "admin") {
      await signOut(auth);
      throw new Error("Access denied. Not an admin account.");
    }

    return userCredential.user;
  } catch (err) {
    throw err;
  }
}

// ─────────────────────────────────────────────
// User Login (username → fake email)
// ─────────────────────────────────────────────
export async function userLogin(username, password) {
  try {
    const email = usernameToEmail(username);
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    // Verify role in Firestore
    const userDoc = await getDoc(doc(db, "users", uid));
    if (!userDoc.exists() || userDoc.data().role !== "user") {
      await signOut(auth);
      throw new Error("Access denied. Not a user account.");
    }

    return userCredential.user;
  } catch (err) {
    throw err;
  }
}

// ─────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────
export async function logout() {
  await signOut(auth);
}

// ─────────────────────────────────────────────
// Get current user's Firestore profile
// ─────────────────────────────────────────────
export async function getCurrentUserProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() ? { uid: user.uid, ...snap.data() } : null;
}

// ─────────────────────────────────────────────
// Route guard: redirect if not logged in or wrong role
// Call on dashboard pages to protect routes
// ─────────────────────────────────────────────
export function requireAuth(expectedRole, redirectTo) {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = redirectTo;
        return;
      }
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists() || snap.data().role !== expectedRole) {
        window.location.href = redirectTo;
        return;
      }
      resolve({ uid: user.uid, ...snap.data() });
    });
  });
}
