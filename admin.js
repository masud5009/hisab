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
  const handleLangToggle = () => {
    toggleLanguage();
    applyTranslations();
    populateMealHistoryUserSearch();
    populateBazarHistoryUserSearch();
    if (calcData) {
      renderCalcTable(calcData, document.getElementById("calcTableWrap"));
    }
  };
  bindIfExists("langToggleBtn", "click", handleLangToggle);
  bindIfExists("drawerLangToggleBtn", "click", handleLangToggle);
  bindIfExists("logoutBtn", "click", handleLogout);
  bindIfExists("drawerLogoutBtn", "click", handleLogout);
  bindIfExists("mobileMoreBtn", "click", openAdminMoreDrawer);
  bindIfExists("adminMoreDrawerClose", "click", closeAdminMoreDrawer);
  bindIfExists("adminMoreDrawerBackdrop", "click", closeAdminMoreDrawer);
  document.getElementById("addUserForm").addEventListener("submit", handleAddUser);
  document.getElementById("editMemberForm").addEventListener("submit", handleEditMember);
  document.getElementById("monthCostForm").addEventListener("submit", handleSaveMonthCosts);
  bindIfExists("pushSettingsForm", "submit", handleSavePushSettings);
  bindIfExists("testPushBtn", "click", handleTestPush);
  bindIfExists("refreshPushStatusBtn", "click", loadMemberPushStatusList);
  bindIfExists("saveGithubPatBtn", "click", saveGithubPat);
  bindIfExists("dispatchIndivPushBtn", "click", handleDispatchIndividualPush);
  bindIfExists("copyIndivPushCmdBtn", "click", copyIndivPushCmd);
  document.getElementById("saveRoomRentsBtn").addEventListener("click", handleSaveRoomRents);
  document.getElementById("recalculateBtn").addEventListener("click", loadCalculation);
  bindIfExists("editBazarForm", "submit", handleEditBazar);
  bindIfExists("refreshBazarHistoryBtn", "click", loadAdminBazarHistory);
  bindIfExists("bulkDeleteBazarBtn", "click", handleBulkDeleteBazar);
  bindIfExists("bazarHistoryDateSearch", "input", handleBazarDateSearch);
  bindIfExists("bazarHistoryUserSearch", "change", handleBazarDateSearch);
  bindIfExists("bazarHistoryClearSearch", "click", clearBazarDateSearch);
  bindIfExists("selectAllBazarRows", "change", handleSelectAllBazarRows);
  bindIfExists("bazarPageSize", "change", handleBazarPageSizeChange);
  bindIfExists("bazarPrevPageBtn", "click", () => changeBazarPage(-1));
  bindIfExists("bazarNextPageBtn", "click", () => changeBazarPage(1));
  bindIfExists("openAddMealModalBtn", "click", () => openAdminAddMealModal());
  bindIfExists("openAddMealFromHistoryBtn", "click", () => openAdminAddMealModal());
  bindIfExists("drawerAddMealBtn", "click", () => {
    closeAdminMoreDrawer();
    openAdminAddMealModal();
  });
  bindIfExists("adminAddMealForm", "submit", handleAddMealByAdmin);
  bindAdminMealTotalPreview();
  bindIfExists("editMealForm", "submit", handleEditMeal);
  bindIfExists("refreshMealHistoryBtn", "click", loadAdminMealHistory);
  bindIfExists("bulkDeleteMealBtn", "click", handleBulkDeleteMeal);
  bindIfExists("mealHistoryDateSearch", "input", handleMealDateSearch);
  bindIfExists("mealHistoryUserSearch", "change", handleMealDateSearch);
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
  loadNotificationSettings();
  loadPushSubscribersCount();
  loadMemberPushStatusList();
  initGithubPat();
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

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  showAlert("addUserAlert", "Creating user...", "info", false);
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
  } finally {
    if (submitBtn) submitBtn.disabled = false;
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
    populateBazarHistoryUserSearch();
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
    const searchUser = document.getElementById("bazarHistoryUserSearch")?.value || "";
    let message = "No bazar entries found for this month.";
    if (searchDate && searchUser) {
      const member = bazarMemberMap.get(searchUser);
      const name = member ? member.name : "selected member";
      message = `No bazar entries found for ${name} on ${searchDate}.`;
    } else if (searchUser) {
      const member = bazarMemberMap.get(searchUser);
      const name = member ? member.name : "selected member";
      message = `No bazar entries found for ${name}.`;
    } else if (searchDate) {
      message = `No bazar entries found for ${searchDate}.`;
    }
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">${escapeHtml(message)}</td></tr>`;
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

function populateBazarHistoryUserSearch() {
  const select = document.getElementById("bazarHistoryUserSearch");
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = `<option value="">${t("all_members") || "All Members"}</option>`;
  bazarMemberMap.forEach((member, uid) => {
    const opt = document.createElement("option");
    opt.value = uid;
    opt.textContent = `${member.name || "Unknown"} (@${member.username || ""})`;
    if (uid === currentVal) opt.selected = true;
    select.appendChild(opt);
  });
}

function clearBazarDateSearch() {
  const dateInput = document.getElementById("bazarHistoryDateSearch");
  if (dateInput) dateInput.value = "";
  const userSelect = document.getElementById("bazarHistoryUserSearch");
  if (userSelect) userSelect.value = "";
  handleBazarDateSearch();
}

function applyBazarHistoryDateFilter() {
  const searchDate = getHistoryDateSearchValue("bazarHistoryDateSearch");
  const searchUser = document.getElementById("bazarHistoryUserSearch")?.value || "";

  adminBazarRows = adminBazarAllRows.filter((row) => {
    if (searchDate && row.date !== searchDate) return false;
    if (searchUser && row.userId !== searchUser) return false;
    return true;
  });
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
    populateMealHistoryUserSearch();
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
    const searchUser = document.getElementById("mealHistoryUserSearch")?.value || "";
    let message = "No meal entries found for this month.";
    if (searchDate && searchUser) {
      const member = mealMemberMap.get(searchUser);
      const name = member ? member.name : "selected member";
      message = `No meal entries found for ${name} on ${searchDate}.`;
    } else if (searchUser) {
      const member = mealMemberMap.get(searchUser);
      const name = member ? member.name : "selected member";
      message = `No meal entries found for ${name}.`;
    } else if (searchDate) {
      message = `No meal entries found for ${searchDate}.`;
    }
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">${escapeHtml(message)}</td></tr>`;
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

function populateMealHistoryUserSearch() {
  const select = document.getElementById("mealHistoryUserSearch");
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = `<option value="">${t("all_members") || "All Members"}</option>`;
  mealMemberMap.forEach((member, uid) => {
    const opt = document.createElement("option");
    opt.value = uid;
    opt.textContent = `${member.name || "Unknown"} (@${member.username || ""})`;
    if (uid === currentVal) opt.selected = true;
    select.appendChild(opt);
  });
}

function clearMealDateSearch() {
  const dateInput = document.getElementById("mealHistoryDateSearch");
  if (dateInput) dateInput.value = "";
  const userSelect = document.getElementById("mealHistoryUserSearch");
  if (userSelect) userSelect.value = "";
  handleMealDateSearch();
}

function applyMealHistoryDateFilter() {
  const searchDate = getHistoryDateSearchValue("mealHistoryDateSearch");
  const searchUser = document.getElementById("mealHistoryUserSearch")?.value || "";

  adminMealRows = adminMealAllRows.filter((row) => {
    if (searchDate && row.date !== searchDate) return false;
    if (searchUser && row.userId !== searchUser) return false;
    return true;
  });
}

async function openEditMealModal(id) {
  let meal = adminMealRows.find((row) => row.id === id);
  if (!meal) {
    const mealDoc = await getDoc(doc(db, "meals", id));
    if (mealDoc.exists()) {
      meal = { id: mealDoc.id, ...mealDoc.data() };
      adminMealRows.push(meal);
    }
  }
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
  let meal = adminMealRows.find((row) => row.id === id);
  if (!meal) {
    const mealDoc = await getDoc(doc(db, "meals", id));
    if (mealDoc.exists()) {
      meal = { id: mealDoc.id, ...mealDoc.data() };
      adminMealRows.push(meal);
    }
  }

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

function getTodayDateString() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function populateMealUserSelect(selectedUid = "") {
  const select = document.getElementById("adminMealUserId");
  if (!select) return;
  const memberMap = await getMemberMap();
  const defaultText = t("select_member") || "Select Member";

  select.innerHTML = `<option value="">-- ${defaultText} --</option>`;
  memberMap.forEach((member, uid) => {
    const opt = document.createElement("option");
    opt.value = uid;
    opt.textContent = `${member.name || "Unknown"} (@${member.username || ""})`;
    if (uid === selectedUid) opt.selected = true;
    select.appendChild(opt);
  });
}

function bindAdminMealTotalPreview() {
  const form = document.getElementById("adminAddMealForm");
  if (!form) return;
  ["morning", "lunch", "dinner"].forEach((name) => {
    form.elements[name]?.addEventListener("input", updateAdminMealTotalPreview);
  });
}

function updateAdminMealTotalPreview() {
  const form = document.getElementById("adminAddMealForm");
  if (!form) return;
  const morning = parseFloat(form.elements.morning.value) || 0;
  const lunch = parseFloat(form.elements.lunch.value) || 0;
  const dinner = parseFloat(form.elements.dinner.value) || 0;
  form.elements.total.value = round2(morning + lunch + dinner);
}

async function openAdminAddMealModal(preselectedUid = "", preselectedDate = "") {
  const form = document.getElementById("adminAddMealForm");
  if (!form) return;
  form.reset();
  hideAlert("adminAddMealAlert");

  await populateMealUserSelect(preselectedUid);

  const dateInput = form.elements.date;
  if (dateInput) {
    if (preselectedDate) {
      dateInput.value = preselectedDate;
    } else {
      const today = getTodayDateString();
      if (today.startsWith(selectedMonth)) {
        dateInput.value = today;
      } else {
        dateInput.value = `${selectedMonth}-01`;
      }
    }
  }

  if (form.elements.morning) form.elements.morning.value = 0;
  if (form.elements.lunch) form.elements.lunch.value = 0;
  if (form.elements.dinner) form.elements.dinner.value = 1;
  updateAdminMealTotalPreview();

  showModal("adminAddMealModal");
}

async function handleAddMealByAdmin(e) {
  e.preventDefault();
  const form = e.target;
  const userId = form.elements.userId.value;
  const date = form.elements.date.value;
  const morning = parseFloat(form.elements.morning.value);
  const lunch = parseFloat(form.elements.lunch.value);
  const dinner = parseFloat(form.elements.dinner.value);

  if (!userId) {
    showAlert("adminAddMealAlert", t("select_member") || "Please select a member.", "danger", false);
    return;
  }
  if (!date) {
    showAlert("adminAddMealAlert", "Please select a date.", "danger", false);
    return;
  }
  if (!isValidMealCount(morning) || !isValidMealCount(lunch) || !isValidMealCount(dinner)) {
    showAlert("adminAddMealAlert", "Please enter valid meal numbers (0 or greater).", "danger", false);
    return;
  }

  const totalMeal = round2(morning + lunch + dinner);

  try {
    setButtonLoading("adminAddMealSubmitBtn", "adminAddMealSpinner", true);

    // Duplicate check for this user and date
    const duplicate = await getDocs(query(
      collection(db, "meals"),
      where("userId", "==", userId),
      where("date", "==", date)
    ));

    if (!duplicate.empty) {
      const existingId = duplicate.docs[0].id;
      const alertEl = document.getElementById("adminAddMealAlert");
      if (alertEl) {
        alertEl.className = "alert alert-warning";
        alertEl.innerHTML = `
          <div>${escapeHtml(t("msg_meal_exists") || "A meal entry for this member and date already exists.")}</div>
          <button type="button" class="btn btn-sm btn-outline-warning mt-2" id="openExistingMealFromAlertBtn">
            <i class="bi bi-pencil-square me-1"></i>${escapeHtml(t("btn_edit") || "Edit Existing Entry")}
          </button>
        `;
        alertEl.classList.remove("d-none");
        document.getElementById("openExistingMealFromAlertBtn")?.addEventListener("click", () => {
          hideModal("adminAddMealModal");
          openEditMealModal(existingId);
        });
      }
      return;
    }

    const mealMonth = date.substring(0, 7);

    await addDoc(collection(db, "meals"), {
      userId,
      date,
      morning,
      lunch,
      dinner,
      totalMeal,
      month: mealMonth,
      createdBy: "admin",
      createdAt: serverTimestamp()
    });

    hideModal("adminAddMealModal");
    showAlert("calcAlert", t("msg_meal_added") || "Meal entry added successfully!", "success");
    showAlert("mealHistoryAlert", t("msg_meal_added") || "Meal entry added successfully!", "success");

    if (mealMonth === selectedMonth) {
      await loadCalculation();
      await loadAdminMealHistory();
    }
  } catch (err) {
    showAlert("adminAddMealAlert", err.message, "danger", false);
  } finally {
    setButtonLoading("adminAddMealSubmitBtn", "adminAddMealSpinner", false);
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

function setButtonLoading(btnId, spinnerId, isLoading, loadingText = null, defaultTextKey = null) {
  const btn = typeof btnId === "string" ? document.getElementById(btnId) : btnId;
  const spinner = typeof spinnerId === "string" ? document.getElementById(spinnerId) : spinnerId;
  if (!btn) return;

  btn.disabled = isLoading;
  if (spinner) {
    if (isLoading) {
      spinner.classList.remove("d-none");
    } else {
      spinner.classList.add("d-none");
    }
  }

  const textEl = btn.querySelector("[data-i18n]") || btn.querySelector(".btn-text");
  if (textEl) {
    if (isLoading && loadingText) {
      textEl.textContent = loadingText;
    } else if (!isLoading && defaultTextKey) {
      textEl.textContent = t(defaultTextKey);
    }
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
    setButtonLoading("saveMonthCostBtn", "saveMonthCostSpinner", true, t("btn_saving"), "btn_save");
    showAlert("monthCostAlert", t("alert_saving_costs"), "info", false);

    await setDoc(doc(db, "months", selectedMonth), data, { merge: true });
    await loadCalculation();
    showAlert("monthCostAlert", t("alert_costs_saved"), "success");
  } catch (err) {
    showAlert("monthCostAlert", err.message, "danger");
  } finally {
    setButtonLoading("saveMonthCostBtn", "saveMonthCostSpinner", false, null, "btn_save");
  }
}

// ─────────────────────────────────────────────
// Automatic Meal Reminder Settings (Push Notifications)
// ─────────────────────────────────────────────
async function loadNotificationSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "notifications"));
    if (snap.exists()) {
      const d = snap.data();
      const toggle = document.getElementById("reminderEnabledToggle");
      const timeInput = document.getElementById("reminderTimeInput");
      const titleInput = document.getElementById("reminderTitleInput");
      const bodyInput = document.getElementById("reminderBodyInput");

      if (toggle) toggle.checked = d.enabled !== false;
      if (timeInput && d.time) timeInput.value = d.time;
      if (titleInput && d.title) titleInput.value = d.title;
      if (bodyInput && d.body) bodyInput.value = d.body;
    }
  } catch (err) {
    console.warn("Could not load notification settings:", err);
  }
}

async function handleSavePushSettings(e) {
  e.preventDefault();
  const toggle = document.getElementById("reminderEnabledToggle");
  const timeInput = document.getElementById("reminderTimeInput");
  const titleInput = document.getElementById("reminderTitleInput");
  const bodyInput = document.getElementById("reminderBodyInput");

  const data = {
    enabled: toggle ? toggle.checked : true,
    time: timeInput ? timeInput.value.trim() : "20:00",
    title: titleInput ? titleInput.value.trim() : "হিসাব - মিল রিমাইন্ডার 🍽️",
    body: bodyInput ? bodyInput.value.trim() : "আজকের মিল এন্ট্রি এখনো দেননি! অনুগ্রহ করে অ্যাপে গিয়ে আজকের মিল যোগ করুন।",
    updatedAt: serverTimestamp()
  };

  try {
    setButtonLoading("savePushSettingsBtn", "savePushSpinner", true, t("btn_saving"), "push_save_btn");
    await setDoc(doc(db, "settings", "notifications"), data, { merge: true });
    showAlert("pushSettingsAlert", t("push_settings_saved"), "success");
  } catch (err) {
    showAlert("pushSettingsAlert", err.message, "danger");
  } finally {
    setButtonLoading("savePushSettingsBtn", "savePushSpinner", false, null, "push_save_btn");
  }
}

async function loadPushSubscribersCount() {
  const badgeEl = document.getElementById("subscribersCountText");
  if (!badgeEl) return;
  try {
    const snap = await getDocs(collection(db, "pushSubscriptions"));
    const activeSubs = snap.docs.filter((d) => d.data().enabled !== false);
    badgeEl.textContent = `${activeSubs.length} জন সক্রিয়`;
  } catch (err) {
    console.warn("Could not count push subscribers:", err);
    badgeEl.textContent = "0 জন";
  }
}

async function handleTestPush() {
  const statusEl = document.getElementById("pushTestStatus");
  const title = (document.getElementById("reminderTitleInput")?.value || "হিসাব - মিল রিমাইন্ডার 🍽️").trim();
  const body = (document.getElementById("reminderBodyInput")?.value || "আজকের মিল এন্ট্রি এখনো দেননি!").trim();

  if (statusEl) statusEl.textContent = "যাচাই করা হচ্ছে...";

  if ("Notification" in window) {
    if (Notification.permission === "granted") {
      try {
        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.ready;
          await reg.showNotification(title, {
            body: body,
            icon: "./pwa-icon-192.png",
            badge: "./favicon.svg",
            tag: "meal-reminder-test",
            vibrate: [200, 100, 200]
          });
        } else {
          new Notification(title, { body, icon: "./pwa-icon-192.png" });
        }
        if (statusEl) statusEl.textContent = "✅ এই ডিভাইসে টেস্ট নোটিফিকেশন পাঠানো হয়েছে!";
        showAlert("pushSettingsAlert", "✅ আপনার ডিভাইসে টেস্ট নোটিফিকেশন প্রদর্শিত হয়েছে। প্রতিদিন নির্ধারিত সময়ে ক্লাউড রানার সব মেম্বারকে স্বয়ংক্রিয়ভাবে পুশ করবে।", "success");
        setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 5000);
        return;
      } catch (e) {
        console.warn("Local notification preview error:", e);
      }
    } else {
      const p = await Notification.requestPermission();
      if (p === "granted") {
        return handleTestPush();
      }
    }
  }

  showAlert("pushSettingsAlert", "নোটিফিকেশন পারমিশন দেওয়া নেই। তবে ক্লাউড রানারের শিডিউল সেটিংস সক্রিয় রয়েছে।", "info");
  if (statusEl) statusEl.textContent = "";
}

// ─────────────────────────────────────────────
// Member Push Status List & Individual Trigger
// ─────────────────────────────────────────────
let currentPushTargetMember = null;
let currentPushTargetSubscription = null;

async function loadMemberPushStatusList() {
  const container = document.getElementById("memberPushStatusList");
  if (!container) return;

  container.innerHTML = `
    <div class="text-center py-3 text-muted">
      <div class="spinner-border spinner-border-sm text-primary mb-1"></div>
      <div>লোড হচ্ছে...</div>
    </div>
  `;

  try {
    const usersSnap = await getDocs(query(collection(db, "users"), where("role", "==", "user")));
    const members = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));

    const subsSnap = await getDocs(collection(db, "pushSubscriptions"));
    const subsMap = new Map();
    subsSnap.docs.forEach((d) => {
      subsMap.set(d.id, d.data());
    });

    if (members.length === 0) {
      container.innerHTML = `<div class="p-3 text-muted small text-center">কোনো সাধারণ মেম্বার পাওয়া যায়নি।</div>`;
      return;
    }

    container.innerHTML = members
      .map((m) => {
        const subData = subsMap.get(m.uid);
        const isSubscribed = subData && subData.enabled !== false && subData.subscription;
        let deviceLabel = "ডিভাইস তথ্য নেই";
        if (subData && subData.userAgent) {
          if (subData.userAgent.includes("Android")) deviceLabel = "Android Phone";
          else if (subData.userAgent.includes("iPhone") || subData.userAgent.includes("iPad")) deviceLabel = "iOS Device";
          else if (subData.userAgent.includes("Windows")) deviceLabel = "Windows PC";
          else deviceLabel = "Web Browser";
        }

        return `
          <div class="list-group-item d-flex align-items-center justify-content-between p-3 flex-wrap gap-2">
            <div class="d-flex align-items-center gap-3">
              <div class="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold" style="width:38px; height:38px; background:var(--clr-primary);">
                ${(m.name || "U").charAt(0).toUpperCase()}
              </div>
              <div>
                <div class="fw-semibold text-dark">${escapeHtml(m.name || "")} <small class="text-muted">(@${escapeHtml(m.username || "")})</small></div>
                <div class="small mt-1">
                  ${
                    isSubscribed
                      ? `<span class="badge bg-success-subtle text-success border border-success-subtle"><i class="bi bi-check-circle-fill me-1"></i> পুশ সক্রিয় (${deviceLabel})</span>`
                      : `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle"><i class="bi bi-x-circle me-1"></i> এখনও পারমিশন দেয়নি</span>`
                  }
                </div>
              </div>
            </div>
            <div>
              <button type="button" class="btn btn-sm btn-outline-primary d-flex align-items-center gap-1 member-test-push-btn" data-uid="${m.uid}">
                <i class="bi bi-bell-fill"></i> <span>পুশ পাঠান</span>
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    container.querySelectorAll(".member-test-push-btn").forEach((btn) => {
      btn.addEventListener("click", () => openIndividualPushModal(btn.dataset.uid));
    });
  } catch (err) {
    console.warn("Could not load member push status:", err);
    container.innerHTML = `<div class="alert alert-danger py-2 small mb-0">স্ট্যাটাস লোড করা যায়নি: ${escapeHtml(err.message)}</div>`;
  }
}

function initGithubPat() {
  const patInput = document.getElementById("githubPatInput");
  if (!patInput) return;
  const saved = localStorage.getItem("hisab_github_pat");
  if (saved) patInput.value = saved;
}

function saveGithubPat() {
  const patInput = document.getElementById("githubPatInput");
  if (!patInput) return;
  const val = patInput.value.trim();
  if (val) {
    localStorage.setItem("hisab_github_pat", val);
    alert("GitHub Personal Access Token ব্রাউজারে সফলভাবে সংরক্ষিত হয়েছে!");
  } else {
    localStorage.removeItem("hisab_github_pat");
    alert("GitHub Token মুছে ফেলা হয়েছে।");
  }
}

async function openIndividualPushModal(uid) {
  currentPushTargetMember = null;
  currentPushTargetSubscription = null;

  showModal("individualPushModal");
  const nameEl = document.getElementById("indivPushMemberName");
  const userEl = document.getElementById("indivPushMemberUser");
  const badgeEl = document.getElementById("indivPushSubBadge");
  const alertEl = document.getElementById("indivPushStatusAlert");
  const cliCmdInput = document.getElementById("indivPushCliCmd");
  const dispatchBtn = document.getElementById("dispatchIndivPushBtn");

  if (alertEl) {
    alertEl.className = "alert d-none";
    alertEl.textContent = "";
  }
  if (nameEl) nameEl.textContent = "খোঁজা হচ্ছে...";
  if (userEl) userEl.textContent = "";
  if (badgeEl) {
    badgeEl.className = "badge bg-secondary";
    badgeEl.textContent = "যাচাই হচ্ছে...";
  }

  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (!userSnap.exists()) {
      if (alertEl) {
        alertEl.className = "alert alert-danger py-2 small";
        alertEl.textContent = "মেম্বার তথ্য পাওয়া যায়নি";
        alertEl.classList.remove("d-none");
      }
      return;
    }
    const member = { uid: userSnap.id, ...userSnap.data() };
    currentPushTargetMember = member;

    if (nameEl) nameEl.textContent = member.name || "Unknown";
    if (userEl) userEl.textContent = "@" + (member.username || "");

    const subSnap = await getDoc(doc(db, "pushSubscriptions", uid));
    const isSubscribed = subSnap.exists() && subSnap.data().enabled !== false && subSnap.data().subscription;
    currentPushTargetSubscription = isSubscribed ? subSnap.data().subscription : null;

    if (cliCmdInput) {
      cliCmdInput.value = `node scripts/send-reminders.mjs --user=${member.username || uid}`;
    }

    if (isSubscribed) {
      if (badgeEl) {
        badgeEl.className = "badge bg-success";
        badgeEl.textContent = "🟢 পুশ সক্রিয় (রেডি)";
      }
      if (dispatchBtn) dispatchBtn.disabled = false;
    } else {
      if (badgeEl) {
        badgeEl.className = "badge bg-secondary";
        badgeEl.textContent = "⚪ এখনও পারমিশন দেয়নি";
      }
      if (dispatchBtn) dispatchBtn.disabled = true;
      if (alertEl) {
        alertEl.className = "alert alert-warning py-2 small";
        alertEl.textContent = `⚠️ ${member.name} এখনও তার ফোনে PWA অ্যাপের নোটিফিকেশন চালু করেননি। তাকে একবার অ্যাপে লগইন করে উপরে আসা "নোটিফিকেশন চালু করুন" এ ক্লিক করতে বলুন।`;
        alertEl.classList.remove("d-none");
      }
    }
  } catch (err) {
    if (alertEl) {
      alertEl.className = "alert alert-danger py-2 small";
      alertEl.textContent = err.message;
      alertEl.classList.remove("d-none");
    }
  }
}

async function handleDispatchIndividualPush() {
  if (!currentPushTargetMember) return;
  const alertEl = document.getElementById("indivPushStatusAlert");
  const spinner = document.getElementById("dispatchIndivPushSpinner");
  const btn = document.getElementById("dispatchIndivPushBtn");
  const customBody = document.getElementById("indivPushCustomBody")?.value || "";

  const githubToken = localStorage.getItem("hisab_github_pat") || document.getElementById("githubPatInput")?.value?.trim();

  if (githubToken) {
    if (btn) btn.disabled = true;
    if (spinner) spinner.classList.remove("d-none");
    if (alertEl) {
      alertEl.className = "alert alert-info py-2 small";
      alertEl.textContent = "🚀 GitHub Actions রানার শুরু করা হচ্ছে...";
      alertEl.classList.remove("d-none");
    }

    try {
      const res = await fetch("https://api.github.com/repos/masud5009/hisab/actions/workflows/meal-reminder.yml/dispatches", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${githubToken}`,
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ref: "v2",
          inputs: {
            target_user: currentPushTargetMember.username || currentPushTargetMember.uid,
            force: "true",
            subscription_json: currentPushTargetSubscription ? JSON.stringify(currentPushTargetSubscription) : "",
            custom_body: customBody ? customBody.trim() : ""
          }
        })
      });

      if (res.status === 204 || res.ok) {
        if (alertEl) {
          alertEl.className = "alert alert-success py-2 small";
          alertEl.textContent = `✅ সফল! GitHub Actions রানার চালু হয়েছে। ১০-১৫ সেকেন্ডের মধ্যে ${currentPushTargetMember.name}-এর ফোনে নোটিফিকেশন পৌঁছে যাবে!`;
          alertEl.classList.remove("d-none");
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `HTTP ${res.status}`);
      }
    } catch (err) {
      if (alertEl) {
        alertEl.className = "alert alert-danger py-2 small";
        alertEl.textContent = `GitHub ট্রিগার ব্যর্থ: ${err.message}। নিচের টার্মিনাল কমান্ড রান করুন।`;
        alertEl.classList.remove("d-none");
      }
    } finally {
      if (btn) btn.disabled = false;
      if (spinner) spinner.classList.add("d-none");
    }
  } else {
    // Guide user: run command in terminal or save token
    if (alertEl) {
      alertEl.className = "alert alert-info py-2 small";
      alertEl.innerHTML = `
        <div><strong>কমান্ড কপি করুন:</strong> ব্রাউজার থেকে সরাসরি পাঠাতে Settings-এ GitHub Token সেভ করুন, অথবা আপনার কম্পিউটারের টার্মিনালে নিচের কমান্ডটি রান করলেই <strong>১ সেকেন্ডে</strong> সরাসরি ${currentPushTargetMember.name}-এর ফোনে পুশ চলে যাবে!</div>
      `;
      alertEl.classList.remove("d-none");
    }
  }
}

function copyIndivPushCmd() {
  const input = document.getElementById("indivPushCliCmd");
  if (!input || !input.value) return;
  navigator.clipboard.writeText(input.value).then(() => {
    alert("কমান্ড ক্লিপবোর্ডে কপি হয়েছে!\n\nটার্মিনালে পেস্ট করে এন্টার দিন।");
  }).catch(() => {});
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
