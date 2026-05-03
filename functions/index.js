const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");

admin.initializeApp();

const allowedOrigins = new Set([
  "https://hisab-9454a.web.app",
  "https://hisab-9454a.firebaseapp.com"
]);

function applyCors(req, res) {
  const origin = req.headers.origin;
  const isLocalOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || "");
  if (allowedOrigins.has(origin) || isLocalOrigin) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

exports.updateMemberPassword = onRequest(async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const authHeader = req.headers.authorization || "";
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) {
      res.status(401).json({ error: "Missing admin token." });
      return;
    }

    const decoded = await admin.auth().verifyIdToken(match[1]);
    const adminDoc = await admin.firestore().collection("users").doc(decoded.uid).get();
    if (!adminDoc.exists || adminDoc.data().role !== "admin") {
      res.status(403).json({ error: "Only admins can change member passwords." });
      return;
    }

    const { uid, password } = req.body || {};
    if (!uid || typeof uid !== "string") {
      res.status(400).json({ error: "Member uid is required." });
      return;
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters." });
      return;
    }

    const memberDoc = await admin.firestore().collection("users").doc(uid).get();
    if (!memberDoc.exists || memberDoc.data().role !== "user") {
      res.status(404).json({ error: "Member not found." });
      return;
    }

    await admin.auth().updateUser(uid, { password });
    await memberDoc.ref.set({
      passwordUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "Password change failed." });
  }
});
