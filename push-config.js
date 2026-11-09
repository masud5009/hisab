// ============================================================
// push-config.js
// VAPID Public Configuration for Web Push Notifications
// ============================================================

export const VAPID_PUBLIC_KEY = "BJrhVa4SoaeK3Z6VX50FsZWJNNENKRulzBxG_hpZGwQ7K5lC-Ymi6BtmMAVmZa0QsVxgcZY4r3NVIQ6Df9hKMZw";

export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

