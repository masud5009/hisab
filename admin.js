// ============================================================
// admin.js
// Admin Dashboard logic: user management, monthly costs,
// calculation table, lock/remove, PDF export
// ============================================================

import { auth, db, firebaseConfig } from "./firebase-config.js";
import { requireAuth, logout } from "./auth.js";
import { DEFAULT_MEAL_PERCENTAGES, buildCalculationTable, getMealPercentages } from "./calculation.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  doc,
  deleteDoc,
  setDoc,
  updateDoc,
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
let adminBazarRows = [];
let bazarCurrentPage = 1;
let bazarPageSize = 25;
let bazarMemberMap = new Map();

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
  loadAdminBazarHistory();

  // Event bindings
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
  document.getElementById("addUserForm").addEventListener("submit", handleAddUser);
  document.getElementById("editMemberForm").addEventListener("submit", handleEditMember);
  document.getElementById("monthCostForm").addEventListener("submit", handleSaveMonthCosts);
  document.getElementById("saveRoomRentsBtn").addEventListener("click", handleSaveRoomRents);
  document.getElementById("recalculateBtn").addEventListener("click", loadCalculation);
  document.getElementById("exportPdfBtn").addEventListener("click", exportToPdf);
  bindIfExists("editBazarForm", "submit", handleEditBazar);
  bindIfExists("refreshBazarHistoryBtn", "click", loadAdminBazarHistory);
  bindIfExists("bulkDeleteBazarBtn", "click", handleBulkDeleteBazar);
  bindIfExists("selectAllBazarRows", "change", handleSelectAllBazarRows);
  bindIfExists("bazarPageSize", "change", handleBazarPageSizeChange);
  bindIfExists("bazarPrevPageBtn", "click", () => changeBazarPage(-1));
  bindIfExists("bazarNextPageBtn", "click", () => changeBazarPage(1));
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
  loadAdminBazarHistory();
}

// ─────────────────────────────────────────────
// Add User
// ─────────────────────────────────────────────
async function handleAddUser(e) {
  e.preventDefault();
  const form = e.target;
  const name = form.name.value.trim();
  const username = form.username.value.trim().toLowerCase();
  const email = form.email.value.trim().toLowerCase();
  const password = form.password.value;
  const phone = form.phone.value.trim();

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
      email,
      phone,
      role: "user",
      createdAt: serverTimestamp()
    });
    showAlert("addUserAlert", `User "${name}" created successfully!`, "success");
    form.reset();
    loadUsersPanel();
    loadAdminBazarHistory();
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
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No members found.</td></tr>`;
    return;
  }

  memberRows.forEach((u) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(u.name || "")}</td>
      <td><code>${escapeHtml(u.username || "")}</code></td>
      <td>${escapeHtml(u.email || "—")}</td>
      <td>${escapeHtml(u.phone || "—")}</td>
      <td><span class="badge bg-success">Active</span></td>
      <td class="text-end">
        <div class="d-inline-flex gap-2">
          <button type="button" class="btn-icon edit-member-btn" data-uid="${u.uid}" title="Edit member">
            <i class="bi bi-pencil-square"></i>
          </button>
          <button type="button" class="btn-icon danger delete-member-btn" data-uid="${u.uid}" data-name="${escapeHtml(u.name || "this member")}" title="Delete member">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".edit-member-btn").forEach((btn) => {
    btn.addEventListener("click", () => openEditMemberModal(btn.dataset.uid));
  });
  tbody.querySelectorAll(".delete-member-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteMember(btn.dataset.uid, btn.dataset.name));
  });
}

function openEditMemberModal(uid) {
  const member = memberRows.find((u) => u.uid === uid);
  if (!member) return;

  const form = document.getElementById("editMemberForm");
  form.uid.value = member.uid;
  form.name.value = member.name || "";
  form.username.value = member.username || "";
  form.email.value = member.email || "";
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
    loadAdminBazarHistory();
    loadCalculation();
  } catch (err) {
    showAlert("editMemberAlert", err.message, "danger", false);
  }
}

async function handleDeleteMember(uid, name) {
  if (!confirm(`Delete ${name}? This will remove the member profile from the app.`)) return;

  try {
    await deleteDoc(doc(db, "users", uid));
    showAlert("usersPanelAlert", "Member deleted successfully.", "success");
    loadUsersPanel();
    loadAdminBazarHistory();
    loadCalculation();
  } catch (err) {
    showAlert("usersPanelAlert", err.message, "danger");
  }
}

// ─────────────────────────────────────────────
// Admin Bazar History
// ─────────────────────────────────────────────
async function loadAdminBazarHistory() {
  const tbody = document.getElementById("adminBazarHistoryBody");
  if (!tbody) return;
  const selectAll = document.getElementById("selectAllBazarRows");
  const bulkBtn = document.getElementById("bulkDeleteBazarBtn");
  tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Loading bazar history...</td></tr>`;
  if (selectAll) selectAll.checked = false;
  if (bulkBtn) bulkBtn.disabled = true;

  try {
    bazarMemberMap = await getMemberMap();
    const snap = await getDocs(query(collection(db, "bazar"), where("month", "==", selectedMonth)));
    adminBazarRows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    bazarCurrentPage = 1;
    renderAdminBazarHistory();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function getMemberMap() {
  const snap = await getDocs(query(collection(db, "users"), where("role", "==", "user")));
  memberRows = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  return new Map(memberRows.map((u) => [u.uid, u]));
}

function renderAdminBazarHistory() {
  const tbody = document.getElementById("adminBazarHistoryBody");

  if (adminBazarRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No bazar entries found for this month.</td></tr>`;
    renderBazarPagination();
    updateBulkDeleteState();
    return;
  }

  normalizeBazarPage();
  const pageRows = getVisibleBazarRows();

  tbody.innerHTML = pageRows.map((bazar) => {
    const member = bazarMemberMap.get(bazar.userId);
    const memberName = member?.name || "Unknown member";
    const username = member?.username ? `@${member.username}` : bazar.userId || "";

    return `
      <tr>
        <td><input type="checkbox" class="bazar-row-check" value="${bazar.id}" aria-label="Select bazar row"/></td>
        <td>${escapeHtml(bazar.date || "")}</td>
        <td><strong>${escapeHtml(memberName)}</strong><br><small class="text-muted">${escapeHtml(username)}</small></td>
        <td>${escapeHtml(bazar.description || "")}</td>
        <td>${round2(bazar.amount || 0)}</td>
        <td class="text-end">
          <div class="d-inline-flex gap-2">
            <button type="button" class="btn-icon edit-bazar-btn" data-id="${bazar.id}" title="Edit bazar">
              <i class="bi bi-pencil-square"></i>
            </button>
            <button type="button" class="btn-icon danger delete-bazar-btn" data-id="${bazar.id}" title="Delete bazar">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join("");

  tbody.querySelectorAll(".bazar-row-check").forEach((check) => {
    check.addEventListener("change", updateBulkDeleteState);
  });
  tbody.querySelectorAll(".edit-bazar-btn").forEach((btn) => {
    btn.addEventListener("click", () => openEditBazarModal(btn.dataset.id));
  });
  tbody.querySelectorAll(".delete-bazar-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteBazar(btn.dataset.id));
  });
  renderBazarPagination();
  updateBulkDeleteState();
}

async function openEditBazarModal(id) {
  const bazar = adminBazarRows.find((row) => row.id === id);
  if (!bazar) return;

  const memberMap = await getMemberMap();
  const member = memberMap.get(bazar.userId);
  const form = document.getElementById("editBazarForm");
  form.elements.id.value = bazar.id;
  form.elements.member.value = member ? `${member.name || ""} (@${member.username || ""})` : bazar.userId || "Unknown member";
  form.elements.date.value = bazar.date || "";
  form.elements.description.value = bazar.description || "";
  form.elements.amount.value = bazar.amount || "";
  hideAlert("editBazarAlert");
  showModal("editBazarModal");
}

async function handleEditBazar(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.elements.id.value;
  const date = form.elements.date.value;
  const description = form.elements.description.value.trim();
  const amount = parseFloat(form.elements.amount.value);

  if (!id || !date || !description || !Number.isFinite(amount) || amount <= 0) {
    showAlert("editBazarAlert", "Please fill all fields correctly.", "danger", false);
    return;
  }

  try {
    await updateDoc(doc(db, "bazar", id), {
      date,
      description,
      amount,
      month: date.substring(0, 7),
      updatedAt: serverTimestamp()
    });
    hideModal("editBazarModal");
    showAlert("bazarHistoryAlert", "Bazar entry updated.", "success");
    await loadAdminBazarHistory();
    await loadCalculation();
  } catch (err) {
    showAlert("editBazarAlert", err.message, "danger", false);
  }
}

async function handleDeleteBazar(id) {
  const bazar = adminBazarRows.find((row) => row.id === id);
  const label = bazar ? `${bazar.date || ""} - ${bazar.description || "bazar"}` : "this bazar entry";
  if (!confirm(`Delete ${label}?`)) return;

  try {
    await deleteDoc(doc(db, "bazar", id));
    showAlert("bazarHistoryAlert", "Bazar entry deleted.", "success");
    await loadAdminBazarHistory();
    await loadCalculation();
  } catch (err) {
    showAlert("bazarHistoryAlert", err.message, "danger");
  }
}

function handleSelectAllBazarRows(e) {
  document.querySelectorAll(".bazar-row-check").forEach((check) => {
    check.checked = e.target.checked;
  });
  updateBulkDeleteState();
}

function handleBazarPageSizeChange(e) {
  bazarPageSize = parseInt(e.target.value, 10) || 25;
  bazarCurrentPage = 1;
  renderAdminBazarHistory();
}

function changeBazarPage(delta) {
  bazarCurrentPage += delta;
  normalizeBazarPage();
  renderAdminBazarHistory();
}

function getBazarPageCount() {
  return Math.max(1, Math.ceil(adminBazarRows.length / bazarPageSize));
}

function normalizeBazarPage() {
  const pageCount = getBazarPageCount();
  if (bazarCurrentPage < 1) bazarCurrentPage = 1;
  if (bazarCurrentPage > pageCount) bazarCurrentPage = pageCount;
}

function getVisibleBazarRows() {
  const start = (bazarCurrentPage - 1) * bazarPageSize;
  return adminBazarRows.slice(start, start + bazarPageSize);
}

function renderBazarPagination() {
  const total = adminBazarRows.length;
  const pageCount = getBazarPageCount();
  const start = total === 0 ? 0 : (bazarCurrentPage - 1) * bazarPageSize + 1;
  const end = Math.min(total, bazarCurrentPage * bazarPageSize);
  const info = document.getElementById("bazarPaginationInfo");
  const indicator = document.getElementById("bazarPageIndicator");
  const prevBtn = document.getElementById("bazarPrevPageBtn");
  const nextBtn = document.getElementById("bazarNextPageBtn");

  if (info) info.textContent = total === 0 ? "Showing 0 entries" : `Showing ${start}-${end} of ${total} entries`;
  if (indicator) indicator.textContent = `Page ${bazarCurrentPage} of ${pageCount}`;
  if (prevBtn) prevBtn.disabled = bazarCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = bazarCurrentPage >= pageCount;
}

function getSelectedBazarIds() {
  return Array.from(document.querySelectorAll(".bazar-row-check:checked")).map((check) => check.value);
}

function updateBulkDeleteState() {
  const selectedCount = getSelectedBazarIds().length;
  const bulkBtn = document.getElementById("bulkDeleteBazarBtn");
  const selectAll = document.getElementById("selectAllBazarRows");
  if (bulkBtn) {
    bulkBtn.disabled = selectedCount === 0;
    bulkBtn.innerHTML = `<i class="bi bi-trash me-1"></i>Delete Selected${selectedCount ? ` (${selectedCount})` : ""}`;
  }
  if (selectAll) {
    const checks = Array.from(document.querySelectorAll(".bazar-row-check"));
    selectAll.checked = checks.length > 0 && checks.every((check) => check.checked);
    selectAll.indeterminate = selectedCount > 0 && selectedCount < checks.length;
  }
}

async function handleBulkDeleteBazar() {
  const selectedIds = getSelectedBazarIds();
  if (selectedIds.length === 0) return;
  if (!confirm(`Delete ${selectedIds.length} selected bazar entries?`)) return;

  try {
    await deleteDocsInBatches("bazar", selectedIds);
    showAlert("bazarHistoryAlert", `${selectedIds.length} bazar entries deleted.`, "success");
    await loadAdminBazarHistory();
    await loadCalculation();
  } catch (err) {
    showAlert("bazarHistoryAlert", err.message, "danger");
  }
}

async function deleteDocsInBatches(collectionName, ids) {
  const chunkSize = 450;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = writeBatch(db);
    ids.slice(i, i + chunkSize).forEach((id) => {
      batch.delete(doc(db, collectionName, id));
    });
    await batch.commit();
  }
}

// Monthly Costs
// ─────────────────────────────────────────────
async function loadMonthCosts() {
  const snap = await getDoc(doc(db, "months", selectedMonth));
  if (snap.exists()) {
    const d = snap.data();
    const mealPercentages = getMealPercentages(d);
    setInputValue("khalaInput", d.khalaTotal || 0);
    setInputValue("gasInput", d.gasTotal || 0);
    setInputValue("electricityInput", d.electricityTotal || 0);
    setInputValue("wifiInput", d.wifiTotal || 0);
    setInputValue("morningPercentInput", mealPercentages.morning);
    setInputValue("lunchPercentInput", mealPercentages.lunch);
    setInputValue("dinnerPercentInput", mealPercentages.dinner);
  } else {
    // Reset inputs
    ["khalaInput","gasInput","electricityInput","wifiInput"].forEach(id => {
      setInputValue(id, 0);
    });
    setInputValue("morningPercentInput", DEFAULT_MEAL_PERCENTAGES.morning);
    setInputValue("lunchPercentInput", DEFAULT_MEAL_PERCENTAGES.lunch);
    setInputValue("dinnerPercentInput", DEFAULT_MEAL_PERCENTAGES.dinner);
  }
}

async function handleSaveMonthCosts(e) {
  e.preventDefault();
  const data = {
    khalaTotal: getInputNumber("khalaInput", 0),
    gasTotal: getInputNumber("gasInput", 0),
    electricityTotal: getInputNumber("electricityInput", 0),
    wifiTotal: getInputNumber("wifiInput", 0),
    morningMealPercent: getInputNumber("morningPercentInput", DEFAULT_MEAL_PERCENTAGES.morning),
    lunchMealPercent: getInputNumber("lunchPercentInput", DEFAULT_MEAL_PERCENTAGES.lunch),
    dinnerMealPercent: getInputNumber("dinnerPercentInput", DEFAULT_MEAL_PERCENTAGES.dinner),
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
      <span class="badge bg-light text-dark border fs-6">Morning: ${summary.totalMorningMeals}</span>
      <span class="badge bg-light text-dark border fs-6">Lunch: ${summary.totalLunchMeals}</span>
      <span class="badge bg-light text-dark border fs-6">Dinner: ${summary.totalDinnerMeals}</span>
      <span class="badge bg-success fs-6">Total Bazar: ৳${summary.totalBazar}</span>
      <span class="badge bg-secondary fs-6">Room Rent: ৳${summary.totalBariVara}</span>
      <span class="badge bg-warning text-dark fs-6">Base Rate: ৳${summary.mealRate}</span>
      <span class="badge bg-light text-dark border fs-6">Dinner Rate: ৳${summary.mealRates.dinner}</span>
      <span class="badge bg-light text-dark border fs-6">Lunch Rate: ৳${summary.mealRates.lunch}</span>
      <span class="badge bg-light text-dark border fs-6">Morning Rate: ৳${summary.mealRates.morning}</span>
      <span class="badge bg-light text-dark border fs-6">Rate %: M ${summary.mealPercentages.morning}% / L ${summary.mealPercentages.lunch}% / D ${summary.mealPercentages.dinner}%</span>
      <span class="badge bg-info text-dark fs-6">Members: ${summary.userCount}</span>
    </div>`;

  const thead = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Morning</th>
        <th>Lunch</th>
        <th>Dinner</th>
        <th>Total Meals</th>
        <th>Bazar (৳)</th>
        <th>Base Rate</th>
        <th>Dinner Rate</th>
        <th>Lunch Rate</th>
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
      <td>${row.morningMeals}</td>
      <td>${row.lunchMeals}</td>
      <td>${row.dinnerMeals}</td>
      <td>${row.totalMeals}</td>
      <td>${row.totalBazar}</td>
      <td>${row.mealRate}</td>
      <td>${row.dinnerRate}</td>
      <td>${row.lunchRate}</td>
      <td>${row.mealCost}</td>
      <td>${row.khalaPerPerson}</td>
      <td>${row.gasPerPerson}</td>
      <td>${row.electricityPerPerson}</td>
      <td>${row.wifiPerPerson}</td>
      <td>
        ${row.locked
          ? `<strong>${row.bariVara}</strong>`
          : `<input type="number" class="form-control form-control-sm bari-vara-input" 
              data-uid="${row.uid}" value="${row.bariVara}" min="0" step="0.01" style="width:90px">`
        }
      </td>
      <td><strong class="text-success">৳<span class="total-payable-value" data-base-payable="${basePayable(row)}">${row.totalPayable}</span></strong></td>
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
  container.querySelectorAll(".bari-vara-input").forEach((input) => {
    input.addEventListener("input", () => updateRentPreview(input));
  });
}

// ─────────────────────────────────────────────
// Lock Rent
// ─────────────────────────────────────────────
async function handleLock(uid, isLocked) {
  if (isLocked) {
    await deleteRentSplitsForUser(uid);
  } else {
    // Lock with current bari vara input value
    const input = document.querySelector(`.bari-vara-input[data-uid="${uid}"]`);
    const amount = parseFloat(input?.value) || 0;
    await deleteRentSplitsForUser(uid);
    await setDoc(doc(db, "rentSplits", rentSplitDocId(uid)), {
      userId: uid,
      month: selectedMonth,
      amount,
      locked: true,
      updatedAt: serverTimestamp()
    });
  }
  loadCalculation();
}

async function handleSaveRoomRents() {
  if (!calcData || calcData.rows.length === 0) {
    showAlert("calcAlert", "No calculation rows to save.", "warning");
    return;
  }
  const saveBtn = document.getElementById("saveRoomRentsBtn");

  const rents = calcData.rows.map((row) => {
    const input = document.querySelector(`.bari-vara-input[data-uid="${row.uid}"]`);
    const amount = input ? parseFloat(input.value) : row.bariVara;
    return { row, amount };
  });

  const invalidRent = rents.find(({ amount }) => !Number.isFinite(amount) || amount < 0);
  if (invalidRent) {
    showAlert("calcAlert", "Room rent amounts must be zero or more.", "warning");
    return;
  }

  try {
    if (saveBtn) saveBtn.disabled = true;
    showAlert("calcAlert", "Saving room rents...", "info", false);
    const existing = await getDocs(query(collection(db, "rentSplits"), where("month", "==", selectedMonth)));
    const targetIds = new Set(rents.map(({ row }) => rentSplitDocId(row.uid)));
    const batch = writeBatch(db);
    existing.forEach((d) => {
      if (!targetIds.has(d.id)) batch.delete(d.ref);
    });
    rents.forEach(({ row, amount }) => {
      batch.set(doc(db, "rentSplits", rentSplitDocId(row.uid)), {
        userId: row.uid,
        month: selectedMonth,
        amount: round2(amount),
        locked: true,
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
    showAlert("calcAlert", "Room rents saved person-wise.", "success", false);
    await loadCalculation();
  } catch (err) {
    showAlert("calcAlert", err.message, "danger", false);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function deleteRentSplitsForUser(uid) {
  const snap = await getDocs(query(
    collection(db, "rentSplits"),
    where("userId", "==", uid),
    where("month", "==", selectedMonth)
  ));
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

function rentSplitDocId(uid) {
  return `${selectedMonth}_${uid}`;
}

function updateRentPreview(input) {
  const amount = parseFloat(input.value) || 0;
  const row = input.closest("tr");
  const totalEl = row?.querySelector(".total-payable-value");
  const basePayableAmount = parseFloat(totalEl?.dataset.basePayable) || 0;
  if (totalEl) totalEl.textContent = round2(basePayableAmount + amount);
}

function basePayable(row) {
  return round2(
    row.mealCost +
    row.khalaPerPerson +
    row.gasPerPerson +
    row.electricityPerPerson +
    row.wifiPerPerson
  );
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function parseNonNegativeNumber(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getInputNumber(id, fallback) {
  const input = document.getElementById(id);
  return input ? parseNonNegativeNumber(input.value, fallback) : fallback;
}

function setInputValue(id, value) {
  const input = document.getElementById(id);
  if (input) input.value = value;
}

function bindIfExists(id, eventName, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(eventName, handler);
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
  doc.text(`Base Rate: ৳${calcData.summary.mealRate} | Total Meals: ${calcData.summary.totalMeals}`, 14, 23);
  doc.text(`Morning: ${calcData.summary.totalMorningMeals} (${calcData.summary.mealPercentages.morning}%, ৳${calcData.summary.mealRates.morning}) | Lunch: ${calcData.summary.totalLunchMeals} (${calcData.summary.mealPercentages.lunch}%, ৳${calcData.summary.mealRates.lunch}) | Dinner: ${calcData.summary.totalDinnerMeals} (${calcData.summary.mealPercentages.dinner}%, ৳${calcData.summary.mealRates.dinner})`, 14, 29);
  doc.text(`Total Bazar: ৳${calcData.summary.totalBazar} | Room Rent: ৳${calcData.summary.totalBariVara}`, 14, 35);

  const head = [["Name", "Morning", "Lunch", "Dinner", "Total Meals", "Bazar", "Base Rate", "Dinner Rate", "Lunch Rate", "Meal Cost", "Khala", "Gas", "Electricity", "WiFi", "Bari Vara", "Total Payable"]];
  const body = calcData.rows.map((r) => [
    r.name, r.morningMeals, r.lunchMeals, r.dinnerMeals, r.totalMeals, `৳${r.totalBazar}`, `৳${r.mealRate}`, `৳${r.dinnerRate}`, `৳${r.lunchRate}`, `৳${r.mealCost}`,
    `৳${r.khalaPerPerson}`, `৳${r.gasPerPerson}`, `৳${r.electricityPerPerson}`,
    `৳${r.wifiPerPerson}`, `৳${r.bariVara}`, `৳${r.totalPayable}`
  ]);

  doc.autoTable({ head, body, startY: 40, theme: "grid" });
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
