// ============================================================
// admin.js
// Admin Dashboard logic: user management, monthly costs,
// calculation table, lock/remove, PDF export
// ============================================================

import { auth, db, firebaseConfig } from "./firebase-config.js";
import { requireAuth, logout } from "./auth.js";
import { DEFAULT_MEAL_PERCENTAGES, buildCalculationTable, getMealPercentages } from "./calculation.js";
import { t, getLanguage, toggleLanguage, applyTranslations } from "./i18n.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  doc,
  addDoc,
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
let adminBazarAllRows = [];
let adminBazarRows = [];
let bazarCurrentPage = 1;
let bazarPageSize = 10;
let bazarMemberMap = new Map();
let adminMealAllRows = [];
let adminMealRows = [];
let mealCurrentPage = 1;
let mealPageSize = 10;
let mealMemberMap = new Map();
let adminAdditionalCosts = [];
const ADMIN_SECTION_IDS = [
  "section-calc",
  "section-costs",
  "section-bazar-history",
  "section-meal-history",
  "section-additional-costs",
  "section-users",
  "section-add-user"
];

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  applyTranslations();
  initDashboardTabs(ADMIN_SECTION_IDS);
  initMonthSelector();

  // Event bindings
  bindIfExists("langToggleBtn", "click", () => {
    toggleLanguage();
    applyTranslations();
    if (calcData) {
      renderCalcTable(calcData, document.getElementById("calcTableWrap"));
    }
  });
  bindIfExists("logoutBtn", "click", handleLogout);
  bindIfExists("mobileLogoutBtn", "click", handleLogout);
  bindIfExists("drawerLogoutBtn", "click", handleLogout);
  bindIfExists("mobileMoreBtn", "click", openAdminMoreDrawer);
  bindIfExists("adminMoreDrawerClose", "click", closeAdminMoreDrawer);
  bindIfExists("adminMoreDrawerBackdrop", "click", closeAdminMoreDrawer);
  document.getElementById("addUserForm").addEventListener("submit", handleAddUser);
  document.getElementById("editMemberForm").addEventListener("submit", handleEditMember);
  document.getElementById("monthCostForm").addEventListener("submit", handleSaveMonthCosts);
  document.getElementById("saveRoomRentsBtn").addEventListener("click", handleSaveRoomRents);
  document.getElementById("recalculateBtn").addEventListener("click", loadCalculation);
  bindIfExists("mealReminderBtn", "click", openMealReminderModal);
  bindIfExists("shareGroupMealReminderBtn", "click", shareGroupMealReminderWa);
  bindIfExists("shareMessSummaryBtn", "click", shareMessSummaryWa);
  bindIfExists("editBazarForm", "submit", handleEditBazar);
  bindIfExists("refreshBazarHistoryBtn", "click", loadAdminBazarHistory);
  bindIfExists("bulkDeleteBazarBtn", "click", handleBulkDeleteBazar);
  bindIfExists("bazarHistoryDateSearch", "input", handleBazarDateSearch);
  bindIfExists("bazarHistoryClearSearch", "click", clearBazarDateSearch);
  bindIfExists("selectAllBazarRows", "change", handleSelectAllBazarRows);
  bindIfExists("bazarPageSize", "change", handleBazarPageSizeChange);
  bindIfExists("bazarPrevPageBtn", "click", () => changeBazarPage(-1));
  bindIfExists("bazarNextPageBtn", "click", () => changeBazarPage(1));
  bindIfExists("editMealForm", "submit", handleEditMeal);
  bindIfExists("refreshMealHistoryBtn", "click", loadAdminMealHistory);
  bindIfExists("bulkDeleteMealBtn", "click", handleBulkDeleteMeal);
  bindIfExists("mealHistoryDateSearch", "input", handleMealDateSearch);
  bindIfExists("mealHistoryClearSearch", "click", clearMealDateSearch);
  bindIfExists("selectAllMealRows", "change", handleSelectAllMealRows);
  bindIfExists("mealPageSize", "change", handleMealPageSizeChange);
  bindIfExists("mealPrevPageBtn", "click", () => changeMealPage(-1));
  bindIfExists("mealNextPageBtn", "click", () => changeMealPage(1));
  bindMealTotalPreview();
  bindIfExists("additionalCostForm", "submit", handleAddAdditionalCost);
  bindIfExists("selectAllCostMembersBtn", "click", handleSelectAllCostMembers);
  bindIfExists("clearAllCostMembersBtn", "click", handleClearAllCostMembers);
  bindIfExists("addCostAmount", "input", updateAdditionalCostPreview);
  document.getElementById("monthSelector").addEventListener("change", onMonthChange);
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => hideModal(btn.dataset.closeModal));
  });
  document.querySelectorAll(".app-modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) hideModal(modal.id);
    });
  });

  currentAdmin = await requireAuth("admin", "admin-login.html");
  const adminNameEl = document.getElementById("adminName");
  if (adminNameEl) adminNameEl.textContent = currentAdmin.name;
  const adminNameDrawerEl = document.getElementById("adminNameDrawer");
  if (adminNameDrawerEl) adminNameDrawerEl.textContent = currentAdmin.name;

  updateHistoryDateSearchRanges();
  loadUsersPanel();
  loadMonthCosts();
  loadCalculation();
  loadAdminBazarHistory();
  loadAdminMealHistory();
  loadAdminAdditionalCosts();
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
  updateHistoryDateSearchRanges();
  loadMonthCosts();
  loadCalculation();
  loadAdminBazarHistory();
  loadAdminMealHistory();
  loadAdminAdditionalCosts();
}

function updateHistoryDateSearchRanges() {
  setHistoryDateSearchRange("bazarHistoryDateSearch");
  setHistoryDateSearchRange("mealHistoryDateSearch");
}

function setHistoryDateSearchRange(id) {
  const input = document.getElementById(id);
  if (!input) return;
  const [year, month] = selectedMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  input.min = `${selectedMonth}-01`;
  input.max = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;
  if (input.value && !input.value.startsWith(selectedMonth)) input.value = "";
}

function getHistoryDateSearchValue(id) {
  const value = document.getElementById(id)?.value || "";
  return value.startsWith(selectedMonth) ? value : "";
}

function openAdminMoreDrawer() {
  const drawer = document.getElementById("adminMoreDrawer");
  const backdrop = document.getElementById("adminMoreDrawerBackdrop");
  if (drawer && backdrop) {
    backdrop.classList.remove("d-none");
    requestAnimationFrame(() => {
      drawer.classList.add("show");
      backdrop.classList.add("show");
    });
  }
}

function closeAdminMoreDrawer() {
  const drawer = document.getElementById("adminMoreDrawer");
  const backdrop = document.getElementById("adminMoreDrawerBackdrop");
  if (drawer && backdrop) {
    drawer.classList.remove("show");
    backdrop.classList.remove("show");
    setTimeout(() => {
      if (!backdrop.classList.contains("show")) {
        backdrop.classList.add("d-none");
      }
    }, 250);
  }
}

function initDashboardTabs(sectionIds) {
  const tabLinks = getDashboardTabLinks(sectionIds);
  const tabSet = new Set(sectionIds);

  document.querySelector("aside nav")?.setAttribute("role", "tablist");
  sectionIds.forEach((id) => {
    const panel = document.getElementById(id);
    if (!panel) return;
    panel.classList.add("dashboard-tab-panel");
    panel.setAttribute("role", "tabpanel");
  });

  tabLinks.forEach((link) => {
    link.setAttribute("role", "tab");
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = link.getAttribute("href").slice(1);
      closeAdminMoreDrawer();
      showDashboardTab(sectionIds, targetId, true);
    });
  });

  const initialId = tabSet.has(window.location.hash.slice(1)) ? window.location.hash.slice(1) : sectionIds[0];
  showDashboardTab(sectionIds, initialId, false);
  window.addEventListener("popstate", () => {
    const targetId = tabSet.has(window.location.hash.slice(1)) ? window.location.hash.slice(1) : sectionIds[0];
    showDashboardTab(sectionIds, targetId, false);
  });
}

function showDashboardTab(sectionIds, activeId, updateHash) {
  if (!sectionIds.includes(activeId)) activeId = sectionIds[0];

  sectionIds.forEach((id) => {
    const panel = document.getElementById(id);
    if (panel) panel.hidden = id !== activeId;
  });

  getDashboardTabLinks(sectionIds).forEach((link) => {
    const isActive = link.getAttribute("href") === `#${activeId}`;
    link.classList.toggle("active", isActive);
    link.setAttribute("aria-selected", String(isActive));
  });

  const moreSubSectionIds = ["section-bazar-history", "section-meal-history", "section-additional-costs", "section-users"];
  const moreBtn = document.getElementById("mobileMoreBtn");
  if (moreBtn) {
    moreBtn.classList.toggle("active", moreSubSectionIds.includes(activeId));
  }

  // Update topbar heading based on active tab
  const headingMap = {
    "section-calc": { label: "Dashboard", icon: "bi-grid-1x2" },
    "section-costs": { label: "Settings", icon: "bi-cash-stack" },
    "section-bazar-history": { label: "Bazar History", icon: "bi-basket" },
    "section-meal-history": { label: "Meal History", icon: "bi-egg-fried" },
    "section-additional-costs": { label: "Additional Costs", icon: "bi-wallet2" },
    "section-users": { label: "Members", icon: "bi-people" },
    "section-add-user": { label: "Add Member", icon: "bi-person-plus" },
  };
  const heading = document.getElementById("topbarHeading");
  if (heading && headingMap[activeId]) {
    const { label, icon } = headingMap[activeId];
    heading.innerHTML = `<i class="bi ${icon} me-2" style="color:var(--clr-primary)"></i>${label}`;
  }

  if (updateHash && window.location.hash !== `#${activeId}`) {
    window.history.pushState(null, "", `#${activeId}`);
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

function getDashboardTabLinks(sectionIds) {
  return Array.from(document.querySelectorAll('aside.sidebar nav a[href^="#section-"], #adminMoreDrawer a[href^="#section-"]'))
    .filter((link) => sectionIds.includes(link.getAttribute("href").slice(1)));
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
    loadAdminMealHistory();
    loadAdminAdditionalCosts();
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
    loadAdminMealHistory();
    loadAdminAdditionalCosts();
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
    loadAdminMealHistory();
    loadAdminAdditionalCosts();
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
    adminBazarAllRows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    bazarCurrentPage = 1;
    applyBazarHistoryDateFilter();
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
    const searchDate = getHistoryDateSearchValue("bazarHistoryDateSearch");
    const message = searchDate ? `No bazar entries found for ${searchDate}.` : "No bazar entries found for this month.";
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">${message}</td></tr>`;
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

function handleBazarDateSearch() {
  bazarCurrentPage = 1;
  applyBazarHistoryDateFilter();
  renderAdminBazarHistory();
}

function clearBazarDateSearch() {
  const input = document.getElementById("bazarHistoryDateSearch");
  if (input) input.value = "";
  handleBazarDateSearch();
}

function applyBazarHistoryDateFilter() {
  const searchDate = getHistoryDateSearchValue("bazarHistoryDateSearch");
  adminBazarRows = searchDate
    ? adminBazarAllRows.filter((row) => row.date === searchDate)
    : [...adminBazarAllRows];
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
  bazarPageSize = parseInt(e.target.value, 10) || 10;
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

// Admin Meal History
// ─────────────────────────────────────────────
async function loadAdminMealHistory() {
  const tbody = document.getElementById("adminMealHistoryBody");
  if (!tbody) return;
  const selectAll = document.getElementById("selectAllMealRows");
  const bulkBtn = document.getElementById("bulkDeleteMealBtn");
  tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">Loading meal history...</td></tr>`;
  if (selectAll) selectAll.checked = false;
  if (bulkBtn) bulkBtn.disabled = true;

  try {
    mealMemberMap = await getMemberMap();
    const snap = await getDocs(query(collection(db, "meals"), where("month", "==", selectedMonth)));
    adminMealAllRows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    mealCurrentPage = 1;
    applyMealHistoryDateFilter();
    renderAdminMealHistory();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderAdminMealHistory() {
  const tbody = document.getElementById("adminMealHistoryBody");

  if (adminMealRows.length === 0) {
    const searchDate = getHistoryDateSearchValue("mealHistoryDateSearch");
    const message = searchDate ? `No meal entries found for ${searchDate}.` : "No meal entries found for this month.";
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">${message}</td></tr>`;
    renderMealPagination();
    updateBulkDeleteMealState();
    return;
  }

  normalizeMealPage();
  const pageRows = getVisibleMealRows();

  tbody.innerHTML = pageRows.map((meal) => {
    const member = mealMemberMap.get(meal.userId);
    const memberName = member?.name || "Unknown member";
    const username = member?.username ? `@${member.username}` : meal.userId || "";
    const morning = Number(meal.morning) || 0;
    const lunch = Number(meal.lunch) || 0;
    const dinner = Number(meal.dinner) || 0;
    const storedTotal = Number(meal.totalMeal);
    const total = Number.isFinite(storedTotal) ? storedTotal : morning + lunch + dinner;

    return `
      <tr>
        <td><input type="checkbox" class="meal-row-check" value="${meal.id}" aria-label="Select meal row"/></td>
        <td>${escapeHtml(meal.date || "")}</td>
        <td><strong>${escapeHtml(memberName)}</strong><br><small class="text-muted">${escapeHtml(username)}</small></td>
        <td>${round2(morning)}</td>
        <td>${round2(lunch)}</td>
        <td>${round2(dinner)}</td>
        <td><strong>${round2(total)}</strong></td>
        <td class="text-end">
          <div class="d-inline-flex gap-2">
            <button type="button" class="btn-icon edit-meal-btn" data-id="${meal.id}" title="Edit meal">
              <i class="bi bi-pencil-square"></i>
            </button>
            <button type="button" class="btn-icon danger delete-meal-btn" data-id="${meal.id}" title="Delete meal">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join("");

  tbody.querySelectorAll(".meal-row-check").forEach((check) => {
    check.addEventListener("change", updateBulkDeleteMealState);
  });
  tbody.querySelectorAll(".edit-meal-btn").forEach((btn) => {
    btn.addEventListener("click", () => openEditMealModal(btn.dataset.id));
  });
  tbody.querySelectorAll(".delete-meal-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteMeal(btn.dataset.id));
  });
  renderMealPagination();
  updateBulkDeleteMealState();
}

function handleMealDateSearch() {
  mealCurrentPage = 1;
  applyMealHistoryDateFilter();
  renderAdminMealHistory();
}

function clearMealDateSearch() {
  const input = document.getElementById("mealHistoryDateSearch");
  if (input) input.value = "";
  handleMealDateSearch();
}

function applyMealHistoryDateFilter() {
  const searchDate = getHistoryDateSearchValue("mealHistoryDateSearch");
  adminMealRows = searchDate
    ? adminMealAllRows.filter((row) => row.date === searchDate)
    : [...adminMealAllRows];
}

async function openEditMealModal(id) {
  const meal = adminMealRows.find((row) => row.id === id);
  if (!meal) return;

  const member = mealMemberMap.get(meal.userId) || (await getMemberMap()).get(meal.userId);
  const form = document.getElementById("editMealForm");
  form.elements.id.value = meal.id;
  form.elements.member.value = member ? `${member.name || ""} (@${member.username || ""})` : meal.userId || "Unknown member";
  form.elements.date.value = meal.date || "";
  form.elements.morning.value = meal.morning || 0;
  form.elements.lunch.value = meal.lunch || 0;
  form.elements.dinner.value = meal.dinner || 0;
  updateEditMealTotalPreview();
  hideAlert("editMealAlert");
  showModal("editMealModal");
}

async function handleEditMeal(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.elements.id.value;
  const date = form.elements.date.value;
  const morning = parseFloat(form.elements.morning.value);
  const lunch = parseFloat(form.elements.lunch.value);
  const dinner = parseFloat(form.elements.dinner.value);
  const meal = adminMealRows.find((row) => row.id === id);

  if (!id || !meal || !date || !isValidMealCount(morning) || !isValidMealCount(lunch) || !isValidMealCount(dinner)) {
    showAlert("editMealAlert", "Please fill all meal fields correctly.", "danger", false);
    return;
  }

  try {
    const duplicate = await getDocs(query(
      collection(db, "meals"),
      where("userId", "==", meal.userId),
      where("date", "==", date)
    ));
    if (duplicate.docs.some((d) => d.id !== id)) {
      showAlert("editMealAlert", "This member already has a meal entry for this date.", "warning", false);
      return;
    }

    const totalMeal = round2(morning + lunch + dinner);
    await updateDoc(doc(db, "meals", id), {
      date,
      morning,
      lunch,
      dinner,
      totalMeal,
      month: date.substring(0, 7),
      updatedAt: serverTimestamp()
    });
    hideModal("editMealModal");
    showAlert("mealHistoryAlert", "Meal entry updated.", "success");
    await loadAdminMealHistory();
    await loadCalculation();
  } catch (err) {
    showAlert("editMealAlert", err.message, "danger", false);
  }
}

async function handleDeleteMeal(id) {
  const meal = adminMealRows.find((row) => row.id === id);
  const label = meal ? `${meal.date || ""} meal entry` : "this meal entry";
  if (!confirm(`Delete ${label}?`)) return;

  try {
    await deleteDoc(doc(db, "meals", id));
    showAlert("mealHistoryAlert", "Meal entry deleted.", "success");
    await loadAdminMealHistory();
    await loadCalculation();
  } catch (err) {
    showAlert("mealHistoryAlert", err.message, "danger");
  }
}

function handleSelectAllMealRows(e) {
  document.querySelectorAll(".meal-row-check").forEach((check) => {
    check.checked = e.target.checked;
  });
  updateBulkDeleteMealState();
}

function handleMealPageSizeChange(e) {
  mealPageSize = parseInt(e.target.value, 10) || 10;
  mealCurrentPage = 1;
  renderAdminMealHistory();
}

function changeMealPage(delta) {
  mealCurrentPage += delta;
  normalizeMealPage();
  renderAdminMealHistory();
}

function getMealPageCount() {
  return Math.max(1, Math.ceil(adminMealRows.length / mealPageSize));
}

function normalizeMealPage() {
  const pageCount = getMealPageCount();
  if (mealCurrentPage < 1) mealCurrentPage = 1;
  if (mealCurrentPage > pageCount) mealCurrentPage = pageCount;
}

function getVisibleMealRows() {
  const start = (mealCurrentPage - 1) * mealPageSize;
  return adminMealRows.slice(start, start + mealPageSize);
}

function renderMealPagination() {
  const total = adminMealRows.length;
  const pageCount = getMealPageCount();
  const start = total === 0 ? 0 : (mealCurrentPage - 1) * mealPageSize + 1;
  const end = Math.min(total, mealCurrentPage * mealPageSize);
  const info = document.getElementById("mealPaginationInfo");
  const indicator = document.getElementById("mealPageIndicator");
  const prevBtn = document.getElementById("mealPrevPageBtn");
  const nextBtn = document.getElementById("mealNextPageBtn");

  if (info) info.textContent = total === 0 ? "Showing 0 entries" : `Showing ${start}-${end} of ${total} entries`;
  if (indicator) indicator.textContent = `Page ${mealCurrentPage} of ${pageCount}`;
  if (prevBtn) prevBtn.disabled = mealCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = mealCurrentPage >= pageCount;
}

function getSelectedMealIds() {
  return Array.from(document.querySelectorAll(".meal-row-check:checked")).map((check) => check.value);
}

function updateBulkDeleteMealState() {
  const selectedCount = getSelectedMealIds().length;
  const bulkBtn = document.getElementById("bulkDeleteMealBtn");
  const selectAll = document.getElementById("selectAllMealRows");
  if (bulkBtn) {
    bulkBtn.disabled = selectedCount === 0;
    bulkBtn.innerHTML = `<i class="bi bi-trash me-1"></i>Delete Selected${selectedCount ? ` (${selectedCount})` : ""}`;
  }
  if (selectAll) {
    const checks = Array.from(document.querySelectorAll(".meal-row-check"));
    selectAll.checked = checks.length > 0 && checks.every((check) => check.checked);
    selectAll.indeterminate = selectedCount > 0 && selectedCount < checks.length;
  }
}

async function handleBulkDeleteMeal() {
  const selectedIds = getSelectedMealIds();
  if (selectedIds.length === 0) return;
  if (!confirm(`Delete ${selectedIds.length} selected meal entries?`)) return;

  try {
    await deleteDocsInBatches("meals", selectedIds);
    showAlert("mealHistoryAlert", `${selectedIds.length} meal entries deleted.`, "success");
    await loadAdminMealHistory();
    await loadCalculation();
  } catch (err) {
    showAlert("mealHistoryAlert", err.message, "danger");
  }
}

function bindMealTotalPreview() {
  const form = document.getElementById("editMealForm");
  if (!form) return;
  ["morning", "lunch", "dinner"].forEach((name) => {
    form.elements[name]?.addEventListener("input", updateEditMealTotalPreview);
  });
}

function updateEditMealTotalPreview() {
  const form = document.getElementById("editMealForm");
  if (!form) return;
  const morning = parseFloat(form.elements.morning.value) || 0;
  const lunch = parseFloat(form.elements.lunch.value) || 0;
  const dinner = parseFloat(form.elements.dinner.value) || 0;
  form.elements.total.value = round2(morning + lunch + dinner);
}

function isValidMealCount(value) {
  return Number.isFinite(value) && value >= 0;
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
    await loadCalculation();
    showAlert("monthCostAlert", "Monthly costs and rates saved!", "success");
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

    // Fetch additional costs
    const addCostsSnap = await getDocs(query(collection(db, "additionalCosts"), where("month", "==", selectedMonth)));
    const additionalCosts = addCostsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Build table
    const result = buildCalculationTable(users, allMeals, allBazar, monthCosts, rentSplits, additionalCosts);
    calcData = result;
    renderCalcTable(result, tableWrap);
    await cacheCalculationSummary(result.summary);
  } catch (err) {
    tableWrap.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
  }
}

async function cacheCalculationSummary(summary) {
  try {
    await setDoc(doc(db, "months", selectedMonth), {
      mealRate: summary.mealRate,
      dinnerRate: summary.mealRates.dinner,
      lunchRate: summary.mealRates.lunch,
      calculationSummary: {
        totalMeals: summary.totalMeals,
        totalMealUnits: summary.totalMealUnits,
        totalBazar: summary.totalBazar,
        mealRate: summary.mealRate,
        mealRates: summary.mealRates,
        mealUnits: summary.mealUnits,
        mealPercentages: summary.mealPercentages,
        perPersonCosts: summary.perPersonCosts,
        userCount: summary.userCount,
        updatedAt: serverTimestamp()
      }
    }, { merge: true });
  } catch (err) {
    console.warn("Failed to cache calculation summary:", err);
  }
}

function renderCalcTable({ rows, summary }, container) {
  const widgetContainer = document.getElementById("calcSummaryWidgets");

  if (rows.length === 0) {
    container.innerHTML = `<div class="alert alert-info">${t("no_data")}</div>`;
    if (widgetContainer) widgetContainer.innerHTML = "";
    return;
  }

  updateAdminAnalytics(summary);

  // Summary widget cards (rendered outside the card)
  if (widgetContainer) {
    const widgets = [
      { label: t("total_meals"), value: summary.totalMeals, icon: "bi-clipboard-data", variant: "primary" },
      { label: t("morning"), value: summary.totalMorningMeals, icon: "bi-sunrise", variant: "orange" },
      { label: t("lunch"), value: summary.totalLunchMeals, icon: "bi-sun", variant: "warning" },
      { label: t("dinner"), value: summary.totalDinnerMeals, icon: "bi-moon-stars", variant: "purple" },
      { label: t("total_unit"), value: summary.totalMealUnits, icon: "bi-calculator", variant: "primary" },
      { label: t("total_bazar"), value: `৳${summary.totalBazar}`, icon: "bi-cart-check", variant: "success" },
      { label: t("room_rent"), value: `৳${summary.totalBariVara}`, icon: "bi-house", variant: "secondary" },
      ...(summary.totalAdditionalCosts > 0 ? [{ label: t("additional_cost"), value: `৳${summary.totalAdditionalCosts}`, icon: "bi-wallet2", variant: "orange" }] : []),
      { label: t("base_rate"), value: `৳${summary.mealRate}`, icon: "bi-tag", variant: "warning" },
      { label: t("dinner_rate"), value: `৳${summary.mealRates.dinner}`, icon: "bi-moon", variant: "purple" },
      { label: t("lunch_rate"), value: `৳${summary.mealRates.lunch}`, icon: "bi-brightness-high", variant: "info" },
      { label: t("morning_rate"), value: `৳${summary.mealRates.morning}`, icon: "bi-sunrise", variant: "orange" },
      { label: t("rate_percent"), value: `M ${summary.mealPercentages.morning}% / L ${summary.mealPercentages.lunch}% / D ${summary.mealPercentages.dinner}%`, icon: "bi-percent", variant: "secondary" },
      { label: t("members"), value: summary.userCount, icon: "bi-people", variant: "info" },
    ];

    widgetContainer.innerHTML = widgets.map(w => `
      <div class="summary-widget widget--${w.variant}">
        <div class="widget-icon"><i class="bi ${w.icon}"></i></div>
        <div class="widget-info">
          <span class="widget-label">${w.label}</span>
          <span class="widget-value">${w.value}</span>
        </div>
      </div>
    `).join("");
  }

  const thead = `
    <thead>
      <tr>
        <th>${t("th_name")}</th>
        <th>${t("th_morning")}</th>
        <th>${t("th_lunch")}</th>
        <th>${t("th_dinner")}</th>
        <th>${t("th_total_meals")}</th>
        <th>${t("th_bazar")}</th>
        <th>${t("th_base_rate")}</th>
        <th>${t("th_dinner_rate")}</th>
        <th>${t("th_lunch_rate")}</th>
        <th>${t("th_meal_cost")}</th>
        <th>${t("th_khala")}</th>
        <th>${t("th_gas")}</th>
        <th>${t("th_electricity")}</th>
        <th>${t("th_wifi")}</th>
        <th>${t("th_bari_vara")}</th>
        <th>${t("th_additional")}</th>
        <th>${t("th_due")}</th>
        <th>${t("th_pay")}</th>
        <th>${t("th_share")}</th>
        <th>Action</th>
      </tr>
    </thead>`;

  const tbody = rows.map((row) => {
    const balance = getBalanceParts(row.totalPayable);
    return `
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
      <td><strong>৳${row.additionalCost || 0}</strong></td>
      <td><strong class="text-danger due-value" data-base-payable="${basePayable(row)}">${formatBalanceAmount(balance.due)}</strong></td>
      <td><strong class="text-success pay-value">${formatBalanceAmount(balance.pay)}</strong></td>
      <td>
        <button class="btn btn-sm btn-outline-success share-member-wa-btn" data-uid="${row.uid}" title="Share / Copy WhatsApp Statement">
          <i class="bi bi-whatsapp"></i>
        </button>
      </td>
      <td>
        <button class="btn btn-sm ${row.locked ? "btn-warning" : "btn-outline-warning"} lock-btn"
          data-uid="${row.uid}" data-locked="${row.locked}">
          ${row.locked ? "🔒 " + t("btn_locked") : "🔓 " + t("btn_lock")}
        </button>
      </td>
    </tr>`;
  }).join("");

  container.innerHTML = `
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
  container.querySelectorAll(".share-member-wa-btn").forEach((btn) => {
    btn.addEventListener("click", () => shareMemberStatementWa(btn.dataset.uid));
  });
  container.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleRemoveFromCalc(btn.dataset.uid, btn.dataset.name));
  });
  container.querySelectorAll(".bari-vara-input").forEach((input) => {
    input.addEventListener("input", () => updateRentPreview(input));
  });
}

function updateAdminAnalytics(summary) {
  if (!summary) return;
  const totalMeals = summary.totalMeals || 0;
  const morning = summary.totalMorningMeals || 0;
  const lunch = summary.totalLunchMeals || 0;
  const dinner = summary.totalDinnerMeals || 0;

  const totalMealsBadge = document.getElementById("analyticsTotalMealsBadge");
  if (totalMealsBadge) totalMealsBadge.textContent = `${totalMeals} ${t("total_meals")}`;

  const mPct = totalMeals > 0 ? (morning / totalMeals) * 100 : 0;
  const lPct = totalMeals > 0 ? (lunch / totalMeals) * 100 : 0;
  const dPct = totalMeals > 0 ? (dinner / totalMeals) * 100 : 0;

  const barM = document.getElementById("mealBarMorning");
  const barL = document.getElementById("mealBarLunch");
  const barD = document.getElementById("mealBarDinner");
  if (barM) barM.style.width = `${mPct}%`;
  if (barL) barL.style.width = `${lPct}%`;
  if (barD) barD.style.width = `${dPct}%`;

  const valM = document.getElementById("analyticsMorningVal");
  const valL = document.getElementById("analyticsLunchVal");
  const valD = document.getElementById("analyticsDinnerVal");
  if (valM) valM.textContent = `${morning} (${Math.round(mPct)}%)`;
  if (valL) valL.textContent = `${lunch} (${Math.round(lPct)}%)`;
  if (valD) valD.textContent = `${dinner} (${Math.round(dPct)}%)`;

  const totalBazar = summary.totalBazar || 0;
  const totalRent = summary.totalBariVara || 0;
  const userCount = summary.userCount || 1;
  const perPersonCosts = summary.perPersonCosts || {};
  const totalUtilities = (
    (perPersonCosts.khala || 0) +
    (perPersonCosts.gas || 0) +
    (perPersonCosts.electricity || 0) +
    (perPersonCosts.wifi || 0)
  ) * userCount;
  const totalExpense = totalBazar + totalRent + totalUtilities;

  const totalExpenseBadge = document.getElementById("analyticsTotalExpenseBadge");
  if (totalExpenseBadge) totalExpenseBadge.textContent = `৳${round2(totalExpense)} Total`;

  const bPct = totalExpense > 0 ? (totalBazar / totalExpense) * 100 : 0;
  const rPct = totalExpense > 0 ? (totalRent / totalExpense) * 100 : 0;
  const uPct = totalExpense > 0 ? (totalUtilities / totalExpense) * 100 : 0;

  const barB = document.getElementById("expenseBarBazar");
  const barR = document.getElementById("expenseBarRent");
  const barU = document.getElementById("expenseBarUtilities");
  if (barB) barB.style.width = `${bPct}%`;
  if (barR) barR.style.width = `${rPct}%`;
  if (barU) barU.style.width = `${uPct}%`;

  const valB = document.getElementById("analyticsBazarVal");
  const valR = document.getElementById("analyticsRentVal");
  const valU = document.getElementById("analyticsUtilitiesVal");
  if (valB) valB.textContent = `৳${totalBazar} (${Math.round(bPct)}%)`;
  if (valR) valR.textContent = `৳${totalRent} (${Math.round(rPct)}%)`;
  if (valU) valU.textContent = `৳${round2(totalUtilities)} (${Math.round(uPct)}%)`;
}


function formatMonthYear(monthStr) {
  if (!monthStr) return "";
  const [year, month] = monthStr.split("-").map(Number);
  if (!year || !month) return monthStr;
  const date = new Date(year, month - 1, 1);
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function cleanWhatsAppPhone(phone) {
  if (!phone) return "";
  let digits = String(phone).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("01")) {
    digits = "88" + digits;
  }
  return digits;
}

function shareMemberStatementWa(uid) {
  if (!calcData || !calcData.rows) return;
  const row = calcData.rows.find((r) => r.uid === uid);
  if (!row) return;

  const balance = getBalanceParts(row.totalPayable);
  const balanceText = balance.due !== null 
    ? `বকেয়া (Due): ৳${balance.due}` 
    : `পাওনা/অতিরিক্ত (Pay): ৳${balance.pay}`;

  const userAddCosts = (adminAdditionalCosts || []).filter((c) => Array.isArray(c.userIds) && c.userIds.includes(uid));
  const addCostNotes = userAddCosts.map((c) => c.note).filter(Boolean).join(", ");
  const addCostLine = row.additionalCost > 0
    ? `\n• অতিরিক্ত খরচ: ৳${row.additionalCost}${addCostNotes ? ` (${addCostNotes})` : ""}`
    : "";

  const message = 
`🏠 *মেস হিসাব — ${formatMonthYear(selectedMonth)}*
👤 *সদস্য:* ${row.name}
━━━━━━━━━━━━━━━━━━━━━
🍽️ *মিল বিবরণী:*
• সকাল: ${row.morningMeals} | দুপুর: ${row.lunchMeals} | রাত: ${row.dinnerMeals}
• মোট মিল: ${row.totalMeals} টি
• মিল রেট: ৳${row.mealRate} (দুপুর: ৳${row.lunchRate}, রাত: ৳${row.dinnerRate})
• মোট মিল খরচ: ৳${row.mealCost}

🏢 *স্থির ও শেয়ার্ড খরচ:*
• খালা বিল: ৳${row.khalaPerPerson}
• গ্যাস বিল: ৳${row.gasPerPerson}
• বিদ্যুৎ বিল: ৳${row.electricityPerPerson}
• ওয়াইফাই বিল: ৳${row.wifiPerPerson}
• ঘর ভাড়া: ৳${row.bariVara}${addCostLine}
━━━━━━━━━━━━━━━━━━━━━
🛒 *বাজার জমা:* ৳${row.totalBazar}
💰 *সর্বমোট ব্যালেন্স:* *${balanceText}*
━━━━━━━━━━━━━━━━━━━━━
📱 হিসাব অ্যাপ থেকে প্রেরিত`;

  copyToClipboardAndShare(message, row.phone);
}

function shareMessSummaryWa() {
  if (!calcData || !calcData.rows || calcData.rows.length === 0) {
    alert(t("no_data"));
    return;
  }
  const s = calcData.summary;
  const memberSummaries = calcData.rows.map((r) => {
    const balance = getBalanceParts(r.totalPayable);
    const balStr = balance.due !== null ? `বকেয়া ৳${balance.due}` : `পাওনা ৳${balance.pay}`;
    return `• ${r.name}: মিল ${r.totalMeals} | বাজার ৳${r.totalBazar} ➔ ${balStr}`;
  }).join("\n");

  const message = 
`🏠 *মেস হিসাবের সারাংশ — ${formatMonthYear(selectedMonth)}*
━━━━━━━━━━━━━━━━━━━━━
📊 *সার্বিক অবস্থা:*
• মোট মিল: ${s.totalMeals} (সকাল: ${s.totalMorningMeals}, দুপুর: ${s.totalLunchMeals}, রাত: ${s.totalDinnerMeals})
• মোট বাজার: ৳${s.totalBazar}
• বেস মিল রেট: ৳${s.mealRate}
• মোট ঘর ভাড়া: ৳${s.totalBariVara}${s.totalAdditionalCosts > 0 ? `\n• মোট অতিরিক্ত খরচ: ৳${s.totalAdditionalCosts}` : ""}
• সদস্য সংখ্যা: ${s.userCount} জন

👥 *সদস্যদের হিসাব বিবরণী:*
${memberSummaries}
━━━━━━━━━━━━━━━━━━━━━
📱 হিসাব অ্যাপ থেকে প্রেরিত`;

  copyToClipboardAndShare(message);
}

function copyToClipboardAndShare(message, phone = "") {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(message).then(() => {
      showAlert("calcAlert", t("copied_to_clipboard"), "success", true);
    }).catch(() => {});
  }
  const cleanPhone = cleanWhatsAppPhone(phone);
  const waUrl = cleanPhone 
    ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
  window.open(waUrl, "_blank");
}

// ─────────────────────────────────────────────
// Meal Reminder for missing today's meals
// ─────────────────────────────────────────────
let missingMealMembers = [];
let todayDateStr = "";

async function openMealReminderModal() {
  showModal("mealReminderModal");
  const container = document.getElementById("mealReminderBody");
  const groupBtn = document.getElementById("shareGroupMealReminderBtn");
  const dateText = document.getElementById("mealReminderDateText");
  if (groupBtn) groupBtn.classList.add("d-none");

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  todayDateStr = `${yyyy}-${mm}-${dd}`;

  if (dateText) dateText.textContent = `তারিখ: ${todayDateStr}`;

  if (container) {
    container.innerHTML = `
      <div class="text-center py-4 text-muted">
        <div class="spinner-border text-warning mb-2"></div>
        <div>যাচাই করা হচ্ছে...</div>
      </div>
    `;
  }

  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const allMembers = usersSnap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .filter((u) => u.role !== "admin");

    const mealsSnap = await getDocs(query(
      collection(db, "meals"),
      where("date", "==", todayDateStr)
    ));
    const submittedUserIds = new Set(mealsSnap.docs.map((d) => d.data().userId));

    missingMealMembers = allMembers.filter((u) => !submittedUserIds.has(u.uid));

    if (missingMealMembers.length === 0) {
      container.innerHTML = `
        <div class="text-center py-4 text-success">
          <i class="bi bi-check-circle-fill fs-1 d-block mb-2 text-success"></i>
          <div class="fw-bold fs-6">${t("all_meals_added_today")}</div>
        </div>
      `;
      if (groupBtn) groupBtn.classList.add("d-none");
      return;
    }

    if (groupBtn) groupBtn.classList.remove("d-none");

    container.innerHTML = `
      <div class="alert alert-warning py-2 mb-3 small d-flex align-items-center justify-content-between">
        <span>⚠️ <strong>${missingMealMembers.length}</strong> ${t("lbl_missing_meal_count")}</span>
      </div>
      <div class="list-group">
        ${missingMealMembers.map((m) => `
          <div class="list-group-item d-flex align-items-center justify-content-between p-2">
            <div>
              <div class="fw-semibold text-dark">${escapeHtml(m.name || "Unknown")}</div>
              <div class="small text-muted">${escapeHtml(m.phone || "ফোন নম্বর নেই")}</div>
            </div>
            <button type="button" class="btn btn-sm btn-outline-success d-flex align-items-center gap-1 send-indiv-wa-btn" data-uid="${m.uid}">
              <i class="bi bi-whatsapp"></i> <span>${t("btn_send_wa")}</span>
            </button>
          </div>
        `).join("")}
      </div>
    `;

    container.querySelectorAll(".send-indiv-wa-btn").forEach((btn) => {
      btn.addEventListener("click", () => sendIndividualMealReminder(btn.dataset.uid));
    });

  } catch (err) {
    console.error(err);
    if (container) {
      container.innerHTML = `<div class="alert alert-danger mb-0">Error: ${escapeHtml(err.message)}</div>`;
    }
  }
}

function sendIndividualMealReminder(uid) {
  const member = missingMealMembers.find((m) => m.uid === uid);
  if (!member) return;

  const message = 
`আসসালামু আলাইকুম ${member.name},
আজকের (${todayDateStr}) মিল হিসাব এখনও অ্যাপে যুক্ত করা হয়নি। অনুগ্রহ করে দ্রুত হিসাব অ্যাপে আপনার মিল এন্ট্রি দিন।

📱 হিসাব অ্যাপ`;

  copyToClipboardAndShare(message, member.phone);
}

function shareGroupMealReminderWa() {
  if (!missingMealMembers || missingMealMembers.length === 0) return;

  const memberList = missingMealMembers.map((m) => `• ${m.name}`).join("\n");
  const message = 
`📢 *মিল রিমাইন্ডার — ${todayDateStr}*
━━━━━━━━━━━━━━━━━━━━━
⚠️ আজকে যারা এখনও মিল এন্ট্রি দেননি:
${memberList}

অনুগ্রহ করে দ্রুত হিসাব অ্যাপে আজকের মিল এন্ট্রি সম্পন্ন করুন।
━━━━━━━━━━━━━━━━━━━━━
📱 হিসাব অ্যাপ থেকে প্রেরিত`;

  copyToClipboardAndShare(message);
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
  const dueEl = row?.querySelector(".due-value");
  const payEl = row?.querySelector(".pay-value");
  const basePayableAmount = parseFloat(dueEl?.dataset.basePayable) || 0;
  const balance = getBalanceParts(basePayableAmount + amount);
  if (dueEl) dueEl.textContent = formatBalanceAmount(balance.due);
  if (payEl) payEl.textContent = formatBalanceAmount(balance.pay);
}

function basePayable(row) {
  return round2(
    row.mealCost +
    row.khalaPerPerson +
    row.gasPerPerson +
    row.electricityPerPerson +
    row.wifiPerPerson +
    (row.additionalCost || 0) -
    row.totalBazar
  );
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function getBalanceParts(balance) {
  const amount = round2(parseFloat(balance) || 0);
  return {
    due: amount > 0 ? amount : 0,
    pay: amount < 0 ? Math.abs(amount) : 0
  };
}

function formatBalanceAmount(amount) {
  return amount > 0 ? `৳${round2(amount)}` : "—";
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
// Additional Costs (Shared Extra Expense)
// ─────────────────────────────────────────────
async function loadAdminAdditionalCosts() {
  const tbody = document.getElementById("additionalCostsTableBody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Loading additional costs...</td></tr>`;

  try {
    const [usersSnap, costsSnap] = await Promise.all([
      getDocs(query(collection(db, "users"), where("role", "==", "user"))),
      getDocs(query(collection(db, "additionalCosts"), where("month", "==", selectedMonth)))
    ]);

    const users = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    renderCostMemberCheckboxes(users);

    adminAdditionalCosts = costsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.date || b.createdAt || "").localeCompare(String(a.date || a.createdAt || "")));

    renderAdminAdditionalCostsTable(users);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderCostMemberCheckboxes(users = []) {
  const container = document.getElementById("costMemberCheckboxes");
  if (!container) return;

  if (users.length === 0) {
    container.innerHTML = `<span class="text-muted small">No members available.</span>`;
    return;
  }

  container.innerHTML = users.map((u) => `
    <div class="form-check me-2">
      <input class="form-check-input cost-member-check" type="checkbox" value="${u.uid}" id="costMember_${u.uid}" checked>
      <label class="form-check-label" for="costMember_${u.uid}">
        <strong>${escapeHtml(u.name || "")}</strong> <small class="text-muted">(@${escapeHtml(u.username || "")})</small>
      </label>
    </div>
  `).join("");

  container.querySelectorAll(".cost-member-check").forEach((cb) => {
    cb.addEventListener("change", updateAdditionalCostPreview);
  });
  updateAdditionalCostPreview();
}

function updateAdditionalCostPreview() {
  const preview = document.getElementById("addCostSplitPreview");
  if (!preview) return;

  const amount = parseFloat(document.getElementById("addCostAmount")?.value) || 0;
  const selectedChecks = document.querySelectorAll(".cost-member-check:checked");
  const count = selectedChecks.length;
  const perPerson = count > 0 ? round2(amount / count) : 0;

  preview.innerHTML = `<i class="bi bi-calculator me-1"></i> ৳${round2(amount)} ÷ ${count} members = <strong>৳${perPerson} / person</strong>`;
}

function handleSelectAllCostMembers() {
  document.querySelectorAll(".cost-member-check").forEach((cb) => { cb.checked = true; });
  updateAdditionalCostPreview();
}

function handleClearAllCostMembers() {
  document.querySelectorAll(".cost-member-check").forEach((cb) => { cb.checked = false; });
  updateAdditionalCostPreview();
}

async function handleAddAdditionalCost(e) {
  e.preventDefault();
  const amountInput = document.getElementById("addCostAmount");
  const noteInput = document.getElementById("addCostNote");
  const amount = parseFloat(amountInput.value);
  const note = noteInput.value.trim();

  const selectedChecks = Array.from(document.querySelectorAll(".cost-member-check:checked"));
  const userIds = selectedChecks.map((cb) => cb.value);

  if (!Number.isFinite(amount) || amount <= 0) {
    showAlert("additionalCostAlert", "Please enter a valid positive amount.", "warning", false);
    return;
  }
  if (!note) {
    showAlert("additionalCostAlert", "Please enter a note / description.", "warning", false);
    return;
  }
  if (userIds.length === 0) {
    showAlert("additionalCostAlert", "Please select at least one member to divide this amount.", "warning", false);
    return;
  }

  const perPersonAmount = round2(amount / userIds.length);
  const saveBtn = document.getElementById("saveAdditionalCostBtn");

  try {
    if (saveBtn) saveBtn.disabled = true;
    const today = new Date().toISOString().slice(0, 10);
    await addDoc(collection(db, "additionalCosts"), {
      month: selectedMonth,
      date: today,
      amount: round2(amount),
      note,
      userIds,
      perPersonAmount,
      createdAt: serverTimestamp()
    });

    showAlert("additionalCostAlert", "Additional cost added and divided successfully.", "success");
    amountInput.value = "";
    noteInput.value = "";
    handleSelectAllCostMembers();
    await loadAdminAdditionalCosts();
    await loadCalculation();
  } catch (err) {
    showAlert("additionalCostAlert", err.message, "danger", false);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function renderAdminAdditionalCostsTable(users = []) {
  const tbody = document.getElementById("additionalCostsTableBody");
  if (!tbody) return;

  if (adminAdditionalCosts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No additional costs for ${selectedMonth}.</td></tr>`;
    return;
  }

  const userMap = new Map(users.map((u) => [u.uid, u.name || u.username]));

  tbody.innerHTML = adminAdditionalCosts.map((item) => {
    const memberNames = (item.userIds || [])
      .map((uid) => userMap.get(uid) || "Member")
      .join(", ");

    return `
      <tr>
        <td>${escapeHtml(item.date || "")}</td>
        <td><strong>${escapeHtml(item.note || "—")}</strong></td>
        <td><strong class="text-primary">৳${item.amount || 0}</strong></td>
        <td><span class="badge bg-light text-dark border" title="${escapeHtml(memberNames)}">${item.userIds?.length || 0} members</span> <small class="text-muted d-block" style="max-width:220px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(memberNames)}</small></td>
        <td><strong>৳${item.perPersonAmount || 0}</strong></td>
        <td class="text-end">
          <button type="button" class="btn-icon danger delete-cost-btn" data-id="${item.id}" title="Delete entry">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".delete-cost-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteAdditionalCost(btn.dataset.id));
  });
}

async function handleDeleteAdditionalCost(id) {
  if (!confirm("Delete this additional cost entry? This will recalculate member balances.")) return;
  try {
    await deleteDoc(doc(db, "additionalCosts", id));
    showAlert("additionalCostAlert", "Additional cost entry removed.", "success");
    await loadAdminAdditionalCosts();
    await loadCalculation();
  } catch (err) {
    showAlert("additionalCostAlert", err.message, "danger");
  }
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
