// ============================================================
// admin.js
// Admin Dashboard logic: user management, monthly costs,
// calculation table, lock/remove, PDF export
// ============================================================

import { auth, db, firebaseConfig } from "./firebase-config.js";
import { requireAuth, logout } from "./auth.js";
import { buildCalculationTable } from "./calculation.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let currentAdmin = null;
let selectedMonth = getCurrentMonth();
let calcData = null; // last built table
let memberRows = [];

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  currentAdmin = await requireAuth("admin", "admin-login.html");
  document.getElementById("adminName").textContent = currentAdmin.name;

  initMonthSelector();
  loadUsersPanel();
  loadMonthCosts();
  loadCalculation();

  // Event bindings
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
  document.getElementById("addUserForm").addEventListener("submit", handleAddUser);
  document.getElementById("editMemberForm").addEventListener("submit", handleEditMember);
  document.getElementById("passwordMemberForm").addEventListener("submit", handleChangeMemberPassword);
  document.getElementById("monthCostForm").addEventListener("submit", handleSaveMonthCosts);
  document.getElementById("recalculateBtn").addEventListener("click", loadCalculation);
  document.getElementById("exportPdfBtn").addEventListener("click", exportToPdf);
  document.getElementById("monthSelector").addEventListener("change", onMonthChange);
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => hideModal(btn.dataset.closeModal));
  });
  document.querySelectorAll(".app-modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) hideModal(modal.id);
    });
  });
});

// ─────────────────────────────────────────────
// Month Selector
// ─────────────────────────────────────────────
function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function initMonthSelector() {
  const sel = document.getElementById("monthSelector");
  // Generate last 12 months
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("default", { month: "long", year: "numeric" });
    const opt = new Option(label, val);
    if (val === selectedMonth) opt.selected = true;
    sel.appendChild(opt);
  }
}

function onMonthChange() {
  selectedMonth = document.getElementById("monthSelector").value;
  loadMonthCosts();
  loadCalculation();
}

// ─────────────────────────────────────────────
// Add User
// ─────────────────────────────────────────────
async function handleAddUser(e) {
  e.preventDefault();
  const form = e.target;
  const name = form.name.value.trim();
  const username = form.username.value.trim().toLowerCase();
  const password = form.password.value;
  const phone = form.phone.value.trim();
  const email = `${username}@hisab.local`;

  showAlert("addUserAlert", "Creating user...", "info");
  try {
    // Create Firebase Auth user
    const secondaryApp = initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = getAuth(secondaryApp);

const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);

await secondaryAuth.signOut();
    // Save profile in Firestore
    await setDoc(doc(db, "users", cred.user.uid), {
      name,
      username,
      phone,
      role: "user",
      createdAt: serverTimestamp()
    });
    showAlert("addUserAlert", `User "${name}" created successfully!`, "success");
    form.reset();
    loadUsersPanel();
    loadCalculation();
  } catch (err) {
    showAlert("addUserAlert", err.message, "danger");
  }
}

// ─────────────────────────────────────────────
// Load Users Panel
// ─────────────────────────────────────────────
async function loadUsersPanel() {
  const snap = await getDocs(query(collection(db, "users"), where("role", "==", "user")));
  const tbody = document.getElementById("usersTableBody");
  tbody.innerHTML = "";
  memberRows = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));

  if (memberRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No members found.</td></tr>`;
    return;
  }

  memberRows.forEach((u) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(u.name || "")}</td>
      <td><code>${escapeHtml(u.username || "")}</code></td>
      <td>${escapeHtml(u.phone || "—")}</td>
      <td><span class="badge bg-success">Active</span></td>
      <td class="text-end">
        <div class="d-inline-flex gap-2">
          <button type="button" class="btn-icon edit-member-btn" data-uid="${u.uid}" title="Edit member">
            <i class="bi bi-pencil-square"></i>
          </button>
          <button type="button" class="btn-icon password-member-btn" data-uid="${u.uid}" title="Change password">
            <i class="bi bi-key"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".edit-member-btn").forEach((btn) => {
    btn.addEventListener("click", () => openEditMemberModal(btn.dataset.uid));
  });
  tbody.querySelectorAll(".password-member-btn").forEach((btn) => {
    btn.addEventListener("click", () => openPasswordMemberModal(btn.dataset.uid));
  });
}

function openEditMemberModal(uid) {
  const member = memberRows.find((u) => u.uid === uid);
  if (!member) return;

  const form = document.getElementById("editMemberForm");
  form.uid.value = member.uid;
  form.name.value = member.name || "";
  form.username.value = member.username || "";
  form.phone.value = member.phone || "";
  hideAlert("editMemberAlert");
  showModal("editMemberModal");
}

async function handleEditMember(e) {
  e.preventDefault();
  const form = e.target;
  const uid = form.uid.value;
  const name = form.name.value.trim();
  const phone = form.phone.value.trim();

  if (!name) {
    showAlert("editMemberAlert", "Full name is required.", "danger", false);
    return;
  }

  try {
    await setDoc(doc(db, "users", uid), {
      name,
      phone,
      updatedAt: serverTimestamp()
    }, { merge: true });

    hideModal("editMemberModal");
    showAlert("usersPanelAlert", "Member updated successfully.", "success");
    loadUsersPanel();
    loadCalculation();
  } catch (err) {
    showAlert("editMemberAlert", err.message, "danger", false);
  }
}

function openPasswordMemberModal(uid) {
  const member = memberRows.find((u) => u.uid === uid);
  if (!member) return;

  const form = document.getElementById("passwordMemberForm");
  form.reset();
  form.uid.value = member.uid;
  form.memberName.value = `${member.name || "Member"} (@${member.username || ""})`;
  hideAlert("passwordMemberAlert");
  showModal("passwordMemberModal");
}

async function handleChangeMemberPassword(e) {
  e.preventDefault();
  const form = e.target;
  const uid = form.uid.value;
  const newPassword = form.newPassword.value;
  const confirmPassword = form.confirmPassword.value;

  if (newPassword.length < 6) {
    showAlert("passwordMemberAlert", "Password must be at least 6 characters.", "danger", false);
    return;
  }
  if (newPassword !== confirmPassword) {
    showAlert("passwordMemberAlert", "New password and confirm password do not match.", "danger", false);
    return;
  }

  try {
    await updateMemberPassword(uid, newPassword);
    hideModal("passwordMemberModal");
    showAlert("usersPanelAlert", "Password changed successfully.", "success");
  } catch (err) {
    showAlert("passwordMemberAlert", err.message, "danger", false);
  }
}

async function updateMemberPassword(uid, newPassword) {
  const endpoint = window.HISAB_PASSWORD_UPDATE_ENDPOINT ||
    `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/updateMemberPassword`;

  const idToken = await auth.currentUser.getIdToken();
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ uid, password: newPassword })
    });
  } catch (err) {
    throw new Error("Password update backend reachable na. functions/updateMemberPassword deploy korte hobe.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || "Password change failed.");
  }
}

// ─────────────────────────────────────────────
// Monthly Costs
// ─────────────────────────────────────────────
async function loadMonthCosts() {
  const snap = await getDoc(doc(db, "months", selectedMonth));
  if (snap.exists()) {
    const d = snap.data();
    document.getElementById("khalaInput").value = d.khalaTotal || 0;
    document.getElementById("gasInput").value = d.gasTotal || 0;
    document.getElementById("electricityInput").value = d.electricityTotal || 0;
    document.getElementById("wifiInput").value = d.wifiTotal || 0;
    document.getElementById("bariVaraInput").value = d.bariVaraTotal || 0;
  } else {
    // Reset inputs
    ["khalaInput","gasInput","electricityInput","wifiInput","bariVaraInput"].forEach(id => {
      document.getElementById(id).value = 0;
    });
  }
}

async function handleSaveMonthCosts(e) {
  e.preventDefault();
  const data = {
    khalaTotal: parseFloat(document.getElementById("khalaInput").value) || 0,
    gasTotal: parseFloat(document.getElementById("gasInput").value) || 0,
    electricityTotal: parseFloat(document.getElementById("electricityInput").value) || 0,
    wifiTotal: parseFloat(document.getElementById("wifiInput").value) || 0,
    bariVaraTotal: parseFloat(document.getElementById("bariVaraInput").value) || 0,
    updatedAt: serverTimestamp()
  };
  try {
    await setDoc(doc(db, "months", selectedMonth), data, { merge: true });
    showAlert("monthCostAlert", "Monthly costs saved!", "success");
    loadCalculation();
  } catch (err) {
    showAlert("monthCostAlert", err.message, "danger");
  }
}

// ─────────────────────────────────────────────
// Calculation Table
// ─────────────────────────────────────────────
async function loadCalculation() {
  const tableWrap = document.getElementById("calcTableWrap");
  tableWrap.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-primary"></div></div>`;

  try {
    // Fetch users
    const usersSnap = await getDocs(query(collection(db, "users"), where("role", "==", "user")));
    const users = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));

    // Fetch meals for month
    const mealsSnap = await getDocs(query(collection(db, "meals"), where("month", "==", selectedMonth)));
    const allMeals = mealsSnap.docs.map((d) => d.data());

    // Fetch bazar for month
    const bazarSnap = await getDocs(query(collection(db, "bazar"), where("month", "==", selectedMonth)));
    const allBazar = bazarSnap.docs.map((d) => d.data());

    // Fetch month costs
    const monthSnap = await getDoc(doc(db, "months", selectedMonth));
    const monthCosts = monthSnap.exists() ? monthSnap.data() : {};

    // Fetch rent splits
    const rentSnap = await getDocs(query(collection(db, "rentSplits"), where("month", "==", selectedMonth)));
    const rentSplits = rentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Build table
    const result = buildCalculationTable(users, allMeals, allBazar, monthCosts, rentSplits);
    calcData = result;
    renderCalcTable(result, tableWrap);
  } catch (err) {
    tableWrap.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
  }
}

function renderCalcTable({ rows, summary }, container) {
  if (rows.length === 0) {
    container.innerHTML = `<div class="alert alert-info">No users or data found for this month.</div>`;
    return;
  }

  // Summary badges
  const summaryHtml = `
    <div class="d-flex flex-wrap gap-2 mb-3">
      <span class="badge bg-primary fs-6">Total Meals: ${summary.totalMeals}</span>
      <span class="badge bg-success fs-6">Total Bazar: ৳${summary.totalBazar}</span>
      <span class="badge bg-warning text-dark fs-6">Meal Rate: ৳${summary.mealRate}</span>
      <span class="badge bg-info text-dark fs-6">Members: ${summary.userCount}</span>
    </div>`;

  const thead = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Meals</th>
        <th>Bazar (৳)</th>
        <th>Meal Rate</th>
        <th>Meal Cost</th>
        <th>Khala</th>
        <th>Gas</th>
        <th>Electricity</th>
        <th>WiFi</th>
        <th>Bari Vara</th>
        <th>Total Payable</th>
        <th>Lock</th>
        <th>Remove</th>
      </tr>
    </thead>`;

  const tbody = rows.map((row) => `
    <tr id="row-${row.uid}" class="${row.locked ? "table-warning" : ""}">
      <td><strong>${row.name}</strong><br><small class="text-muted">@${row.username}</small></td>
      <td>${row.totalMeals}</td>
      <td>${row.totalBazar}</td>
      <td>${row.mealRate}</td>
      <td>${row.mealCost}</td>
      <td>${row.khalaPerPerson}</td>
      <td>${row.gasPerPerson}</td>
      <td>${row.electricityPerPerson}</td>
      <td>${row.wifiPerPerson}</td>
      <td>
        ${row.locked
          ? `<strong>${row.bariVara}</strong>`
          : `<input type="number" class="form-control form-control-sm bari-vara-input" 
              data-uid="${row.uid}" value="${row.bariVara}" style="width:90px">`
        }
      </td>
      <td><strong class="text-success">৳${row.totalPayable}</strong></td>
      <td>
        <button class="btn btn-sm ${row.locked ? "btn-warning" : "btn-outline-warning"} lock-btn"
          data-uid="${row.uid}" data-locked="${row.locked}">
          ${row.locked ? "🔒 Locked" : "🔓 Lock"}
        </button>
      </td>
      <td>
        <button class="btn btn-sm btn-outline-danger remove-btn" data-uid="${row.uid}" data-name="${row.name}">
          Remove
        </button>
      </td>
    </tr>`).join("");

  container.innerHTML = summaryHtml + `
    <div class="table-responsive">
      <table class="table table-bordered table-hover align-middle" id="calcTable">
        ${thead}
        <tbody>${tbody}</tbody>
      </table>
    </div>`;

  // Bind events
  container.querySelectorAll(".lock-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleLock(btn.dataset.uid, btn.dataset.locked === "true"));
  });
  container.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleRemoveFromCalc(btn.dataset.uid, btn.dataset.name));
  });
}

// ─────────────────────────────────────────────
// Lock Rent
// ─────────────────────────────────────────────
async function handleLock(uid, isLocked) {
  if (isLocked) {
    // Unlock
    const snap = await getDocs(query(
      collection(db, "rentSplits"),
      where("userId", "==", uid),
      where("month", "==", selectedMonth)
    ));
    const batch = writeBatch(db);
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } else {
    // Lock with current bari vara input value
    const input = document.querySelector(`.bari-vara-input[data-uid="${uid}"]`);
    const amount = parseFloat(input?.value) || 0;
    await addDoc(collection(db, "rentSplits"), {
      userId: uid,
      month: selectedMonth,
      amount,
      locked: true
    });
  }
  loadCalculation();
}

// ─────────────────────────────────────────────
// Remove from Calculation (visual only via flag)
// ─────────────────────────────────────────────
function handleRemoveFromCalc(uid, name) {
  if (!confirm(`Remove ${name} from this month's calculation?`)) return;
  const row = document.getElementById(`row-${uid}`);
  if (row) row.remove();
}

// ─────────────────────────────────────────────
// PDF Export using jsPDF + autoTable
// ─────────────────────────────────────────────
function exportToPdf() {
  if (!calcData || calcData.rows.length === 0) {
    alert("No data to export.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(16);
  doc.text(`Meal & Expense Report — ${selectedMonth}`, 14, 15);
  doc.setFontSize(10);
  doc.text(`Meal Rate: ৳${calcData.summary.mealRate} | Total Meals: ${calcData.summary.totalMeals} | Total Bazar: ৳${calcData.summary.totalBazar}`, 14, 23);

  const head = [["Name", "Meals", "Bazar", "Meal Cost", "Khala", "Gas", "Electricity", "WiFi", "Bari Vara", "Total Payable"]];
  const body = calcData.rows.map((r) => [
    r.name, r.totalMeals, `৳${r.totalBazar}`, `৳${r.mealCost}`,
    `৳${r.khalaPerPerson}`, `৳${r.gasPerPerson}`, `৳${r.electricityPerPerson}`,
    `৳${r.wifiPerPerson}`, `৳${r.bariVara}`, `৳${r.totalPayable}`
  ]);

  doc.autoTable({ head, body, startY: 28, theme: "grid" });
  doc.save(`hisab-${selectedMonth}.pdf`);
}

// ─────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────
async function handleLogout() {
  await logout();
  window.location.href = "index.html";
}

// ─────────────────────────────────────────────
// Alert helper
// ─────────────────────────────────────────────
function showModal(id) {
  const modal = document.getElementById(id);
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function hideModal(id) {
  const modal = document.getElementById(id);
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function hideAlert(id) {
  const el = document.getElementById(id);
  el.classList.add("d-none");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showAlert(id, msg, type, autoHide = true) {
  const el = document.getElementById(id);
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove("d-none");
  if (autoHide) setTimeout(() => el.classList.add("d-none"), 4000);
}
