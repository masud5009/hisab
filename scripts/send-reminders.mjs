// ============================================================
// scripts/send-reminders.mjs
// Automated & Individual Meal Reminder via Web Push (GitHub Actions Cron / Local CLI)
// 100% Free - Firebase Spark Tier Compatible
// ============================================================

import webpush from "web-push";
import fs from "fs";

// Load local .env file if present
if (fs.existsSync(".env")) {
  try {
    const envLines = fs.readFileSync(".env", "utf8").split(/\r?\n/);
    for (const line of envLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch (e) {
    // ignore
  }
}

// Firebase Configuration
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyCGX4xWYrpfYRfIce20GYISa3Pcn6It4Y0";
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "hisab-9454a";

// VAPID Web Push Keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "BJrhVa4SoaeK3Z6VX50FsZWJNNENKRulzBxG_hpZGwQ7K5lC-Ymi6BtmMAVmZa0QsVxgcZY4r3NVIQ6Df9hKMZw";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "4WiT--uqTyv1tu6zr9d0bnPzq5oVcQYPAw6PehQf-zo";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@hisab.local";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// CLI Arguments Parser
const args = process.argv.slice(2);
function getArg(name) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && args[i + 1]) return args[i + 1];
    if (args[i].startsWith(`--${name}=`)) return args[i].slice(name.length + 3);
  }
  return null;
}
const hasArg = (name) => args.includes(`--${name}`) || args.some((a) => a.startsWith(`--${name}=`));

const targetUserArg = getArg("user") || process.env.TARGET_USER;
const isForce = hasArg("force") || hasArg("test") || hasArg("manual") || process.env.MANUAL_RUN === "true";
const customTitle = getArg("title") || process.env.CUSTOM_TITLE;
const customBody = getArg("body") || process.env.CUSTOM_BODY;
const directSubArg = getArg("subscription") || process.env.SUBSCRIPTION_JSON;
const passwordArg = getArg("password");
if (passwordArg) process.env.ADMIN_PASSWORD = passwordArg;
const usernameArg = getArg("admin");
if (usernameArg) process.env.ADMIN_USERNAME = usernameArg;

// Helper: Convert username to email
function usernameToEmail(username) {
  const value = String(username || "admin").trim().toLowerCase();
  return value.includes("@") ? value : `${value}@hisab.local`;
}

// Helper: Decode Firestore document fields to normal JavaScript object
function decodeFirestoreValue(v) {
  if (!v || typeof v !== "object") return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
  if (v.doubleValue !== undefined) return parseFloat(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.mapValue !== undefined) {
    const obj = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) {
      obj[k] = decodeFirestoreValue(val);
    }
    return obj;
  }
  if (v.arrayValue !== undefined) {
    return (v.arrayValue.values || []).map(decodeFirestoreValue);
  }
  return null;
}

function decodeDoc(doc) {
  if (!doc || !doc.fields) return null;
  const data = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    data[k] = decodeFirestoreValue(v);
  }
  const id = doc.name ? doc.name.split("/").pop() : null;
  return { id, ...data };
}

// ─── Firebase Auth: Obtain ID Token for Admin ───
async function getAdminAuthToken() {
  const username = process.env.ADMIN_USERNAME || "masud5009";
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.warn("⚠️ No ADMIN_PASSWORD provided in environment variables or GitHub Secrets.");
    console.warn("👉 For automated daily cron reminders, please set ADMIN_PASSWORD in GitHub Settings -> Secrets -> Actions.");
    return null;
  }

  const email = usernameToEmail(username);
  console.log(`🔐 Authenticating as admin (${email})...`);

  const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
  const res = await fetch(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true
    })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Firebase Auth failed (${email}): ${data.error?.message || res.statusText}`);
  }

  console.log("✅ Authenticated successfully as Admin.");
  return data.idToken;
}

// ─── Main Runner ───
async function run() {
  console.log("==================================================");
  console.log("🚀 Hisab - Meal Reminder via Web Push Runner");
  console.log("==================================================");

  // Time in Bangladesh (Asia/Dhaka)
  const now = new Date();
  const dhakaDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const todayStr = dhakaDateFormatter.format(now);

  const dhakaTimeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const timeParts = dhakaTimeFormatter.formatToParts(now);
  const currentDhakaHour = parseInt(timeParts.find((p) => p.type === "hour")?.value || "0", 10);
  const currentDhakaMinute = parseInt(timeParts.find((p) => p.type === "minute")?.value || "0", 10);

  console.log(`🕒 Current Time (Asia/Dhaka): ${todayStr} ${String(currentDhakaHour).padStart(2, "0")}:${String(currentDhakaMinute).padStart(2, "0")}`);

  // ─── Case 0: Direct Push Subscription Provided (from 1-Click Admin Dashboard) ───
  if (directSubArg && directSubArg.trim() && directSubArg.trim() !== "null" && directSubArg.trim() !== "undefined") {
    console.log("⚡ Direct push subscription received. Bypassing Firestore queries.");
    try {
      const sub = typeof directSubArg === "object" ? directSubArg : JSON.parse(directSubArg);
      const recipientName = targetUserArg && targetUserArg !== "all" ? targetUserArg : "মেম্বার";
      const payload = JSON.stringify({
        title: customTitle || "হিসাব - মিল রিমাইন্ডার 🍽️",
        body: customBody || `${recipientName}, আজকের মিল এন্ট্রি এখনো দেননি! অনুগ্রহ করে অ্যাপে গিয়ে মিল যোগ করুন।`,
        icon: "./pwa-icon-192.png",
        badge: "./favicon.svg",
        tag: "meal-reminder-direct",
        data: { url: "./user-dashboard.html#section-meals" }
      });

      console.log(`📤 Sending push notification directly to ${recipientName}'s device...`);
      const pushRes = await webpush.sendNotification(sub, payload);
      console.log(`🎉 SUCCESS! Push delivered directly to device! HTTP ${pushRes.statusCode}`);
      console.log("==================================================");
      process.exit(0);
    } catch (directErr) {
      console.error("❌ Direct push delivery failed:", directErr.message);
      process.exit(1);
    }
  }

  const idToken = await getAdminAuthToken();
  const authHeaders = {
    "Content-Type": "application/json"
  };
  if (idToken) {
    authHeaders["Authorization"] = `Bearer ${idToken}`;
  }

  const baseUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

  // 1. Fetch Notification Settings
  console.log("📋 Fetching notification settings from Firestore...");
  let settings = {
    enabled: true,
    time: "20:00",
    title: "হিসাব - মিল রিমাইন্ডার 🍽️",
    body: "আজকের মিল এন্ট্রি এখনো দেননি! অনুগ্রহ করে অ্যাপে গিয়ে আজকের মিল যোগ করুন।"
  };

  try {
    const settingsRes = await fetch(`${baseUrl}/settings/notifications`, { headers: authHeaders });
    if (settingsRes.ok) {
      const settingsDoc = await settingsRes.json();
      const decodedSettings = decodeDoc(settingsDoc);
      if (decodedSettings) {
        settings = { ...settings, ...decodedSettings };
      }
    } else if (settingsRes.status === 404) {
      console.log("ℹ️ No custom settings document found; using defaults.");
    } else {
      console.warn(`⚠️ Warning fetching settings: HTTP ${settingsRes.status}`);
    }
  } catch (err) {
    console.warn("⚠️ Error fetching settings:", err.message);
  }

  console.log(`⚙️ Settings: Enabled=${settings.enabled}, Time=${settings.time}`);

  // 2. Fetch All Members
  console.log("👥 Fetching members from Firestore...");
  const usersRes = await fetch(`${baseUrl}:runQuery`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "users" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "role" },
            op: "EQUAL",
            value: { stringValue: "user" }
          }
        }
      }
    })
  });

  if (!usersRes.ok) {
    const errText = await usersRes.text();
    throw new Error(`Failed to query users: ${usersRes.status} ${errText}`);
  }

  const usersQueryData = await usersRes.json();
  const allMembers = usersQueryData
    .map((item) => (item.document ? decodeDoc(item.document) : null))
    .filter(Boolean);

  console.log(`Found ${allMembers.length} active mess members.`);

  // 3. Fetch Push Subscriptions
  console.log("📲 Fetching push subscriptions from Firestore...");
  const subsRes = await fetch(`${baseUrl}/pushSubscriptions`, { headers: authHeaders });
  let subscriptionsMap = new Map();

  if (subsRes.ok) {
    const subsData = await subsRes.json();
    (subsData.documents || []).forEach((d) => {
      const decoded = decodeDoc(d);
      if (decoded && decoded.subscription && decoded.enabled !== false) {
        subscriptionsMap.set(decoded.id, decoded.subscription);
      }
    });
  } else {
    console.warn(`Could not list pushSubscriptions directly (${subsRes.status}). Trying individual lookups.`);
  }

  // ─── Case A: Individual Target User Specified ───
  if (targetUserArg && targetUserArg !== "all") {
    const queryTerm = targetUserArg.trim().toLowerCase();
    const targetMember = allMembers.find(
      (m) =>
        m.id.toLowerCase() === queryTerm ||
        (m.username && m.username.toLowerCase() === queryTerm) ||
        (m.name && m.name.toLowerCase().includes(queryTerm))
    );

    if (!targetMember) {
      console.error(`❌ Member not found matching "${targetUserArg}".`);
      console.log(`Available members:`);
      allMembers.forEach((m) => console.log(` - @${m.username || 'unknown'} (${m.name}) [ID: ${m.id}]`));
      process.exit(1);
    }

    console.log(`🎯 Target Member Selected: ${targetMember.name} (@${targetMember.username}) [UID: ${targetMember.id}]`);

    let sub = subscriptionsMap.get(targetMember.id);
    if (!sub) {
      // Try direct GET
      try {
        const directRes = await fetch(`${baseUrl}/pushSubscriptions/${targetMember.id}`, { headers: authHeaders });
        if (directRes.ok) {
          const directDoc = await directRes.json();
          const decoded = decodeDoc(directDoc);
          if (decoded && decoded.subscription && decoded.enabled !== false) {
            sub = decoded.subscription;
          }
        }
      } catch (e) {
        // ignore
      }
    }

    if (!sub) {
      console.error(`❌ Cannot send push: ${targetMember.name} has NOT enabled push notifications in their PWA yet!`);
      console.log(`👉 What to do: Ask ${targetMember.name} to log in to the PWA on their phone and click "নোটিফিকেশন চালু করুন" (Enable Notifications) on the banner.`);
      process.exit(1);
    }

    const payload = JSON.stringify({
      title: customTitle || settings.title || "হিসাব - মিল রিমাইন্ডার 🍽️",
      body: customBody || `${targetMember.name}, ${settings.body || "আজকের মিল এন্ট্রি এখনো দেননি! অনুগ্রহ করে অ্যাপে গিয়ে আজকের মিল যোগ করুন।"}`,
      icon: "./pwa-icon-192.png",
      badge: "./favicon.svg",
      tag: "meal-reminder-test",
      data: { url: "./user-dashboard.html#section-meals" }
    });

    console.log(`📤 Sending push notification to ${targetMember.name}...`);
    try {
      const pushRes = await webpush.sendNotification(sub, payload);
      console.log(`🎉 SUCCESS! Push notification delivered to ${targetMember.name}'s device!`);
      console.log(`Status Code: ${pushRes.statusCode}`);
      console.log("==================================================");
      process.exit(0);
    } catch (pushErr) {
      console.error(`❌ Push delivery failed to ${targetMember.name}:`, pushErr.message);
      if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
        console.log(`Subscription is invalid or expired. Removing from Firestore...`);
        await fetch(`${baseUrl}/pushSubscriptions/${targetMember.id}`, { method: "DELETE", headers: authHeaders });
      }
      process.exit(1);
    }
  }

  // ─── Case B: Scheduled Or Forced Run for Today's Missing Meals ───

  // Check enabled status in settings
  if (!settings.enabled && !isForce) {
    console.log("🛑 Daily meal reminders are disabled in Admin Settings. Exiting.");
    process.exit(0);
  }

  // Check schedule match (unless forced by manual dispatch)
  const [targetHourStr] = (settings.time || "20:00").split(":");
  const targetHour = parseInt(targetHourStr, 10);

  if (!isForce && currentDhakaHour !== targetHour) {
    console.log(`⏰ Current hour (${currentDhakaHour}) does not match configured reminder hour (${targetHour}). Skipping.`);
    process.exit(0);
  }

  if (isForce) {
    console.log("⚡ Force/Manual run mode active.");
  } else {
    console.log(`🎯 Reminder hour matched (${currentDhakaHour}:00). Proceeding with missing meal check...`);
  }

  // Query Today's Meals (date == todayStr)
  console.log(`🍽️ Checking submitted meals for today (${todayStr})...`);
  const mealsRes = await fetch(`${baseUrl}:runQuery`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "meals" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "date" },
            op: "EQUAL",
            value: { stringValue: todayStr }
          }
        }
      }
    })
  });

  if (!mealsRes.ok) {
    const errText = await mealsRes.text();
    throw new Error(`Failed to query meals: ${mealsRes.status} ${errText}`);
  }

  const mealsQueryData = await mealsRes.json();
  const submittedUserIds = new Set();
  mealsQueryData.forEach((item) => {
    if (item.document) {
      const meal = decodeDoc(item.document);
      if (meal && meal.userId) {
        submittedUserIds.add(meal.userId);
      }
    }
  });

  console.log(`${submittedUserIds.size} members have already added today's meal.`);

  const missingMembers = allMembers.filter((m) => !submittedUserIds.has(m.id));
  if (missingMembers.length === 0 && !isForce) {
    console.log("🎉 All members have already added meals for today! No push notifications needed.");
    process.exit(0);
  }

  const recipients = isForce && targetUserArg === "all" ? allMembers : missingMembers;
  console.log(`⚠️ Recipients to notify (${recipients.length}):`, recipients.map((m) => m.name || m.id).join(", "));

  // Dispatch Notifications
  let sentCount = 0;
  let failCount = 0;

  for (const member of recipients) {
    let sub = subscriptionsMap.get(member.id);

    // If not in map, try direct GET
    if (!sub) {
      try {
        const directRes = await fetch(`${baseUrl}/pushSubscriptions/${member.id}`, { headers: authHeaders });
        if (directRes.ok) {
          const directDoc = await directRes.json();
          const decoded = decodeDoc(directDoc);
          if (decoded && decoded.subscription && decoded.enabled !== false) {
            sub = decoded.subscription;
          }
        }
      } catch (e) {
        // ignore
      }
    }

    if (!sub) {
      console.log(`ℹ️ Member ${member.name || member.id} has not subscribed to push notifications.`);
      continue;
    }

    const payload = JSON.stringify({
      title: customTitle || settings.title || "হিসাব - মিল রিমাইন্ডার 🍽️",
      body: customBody || `${member.name ? member.name + ", " : ""}${settings.body || "আজকের মিল এন্ট্রি এখনো দেননি! অনুগ্রহ করে অ্যাপে গিয়ে আজকের মিল যোগ করুন।"}`,
      icon: "./pwa-icon-192.png",
      badge: "./favicon.svg",
      tag: "meal-reminder",
      data: { url: "./user-dashboard.html#section-meals" }
    });

    try {
      console.log(`📤 Sending push notification to ${member.name || member.id}...`);
      await webpush.sendNotification(sub, payload);
      console.log(`✅ Push sent successfully to ${member.name || member.id}!`);
      sentCount++;
    } catch (pushErr) {
      console.error(`❌ Failed to push to ${member.name || member.id}:`, pushErr.message);
      failCount++;

      if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
        console.log(`🗑️ Subscription for ${member.id} is invalid/expired. Removing from Firestore...`);
        try {
          await fetch(`${baseUrl}/pushSubscriptions/${member.id}`, {
            method: "DELETE",
            headers: authHeaders
          });
        } catch (delErr) {
          console.warn("Could not delete expired subscription:", delErr.message);
        }
      }
    }
  }

  console.log("==================================================");
  console.log(`📊 Summary: Sent=${sentCount}, Failed=${failCount}, Unsubscribed=${recipients.length - sentCount - failCount}`);
  console.log("🏁 Reminder run finished.");
  console.log("==================================================");
}

run().catch((err) => {
  console.error("💥 Fatal error running meal reminders:", err);
  process.exit(1);
});
