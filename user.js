// ============================================================
// user.js
// User Dashboard logic: add bazar, add meals, view summary
// ============================================================

import { auth, db } from "./firebase-config.js";
import { requireAuth, logout } from "./auth.js";
import {
  calcMealBreakdown,
  calcMealCost,
  calcPerPerson,
  calcUserTotalBazar,
  calcUserTotalMeals,
  calcUserPayable
} from "./calculation.js";
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let currentUser = null;
let selectedMonth = getCurrentMonth();
let editBazarModal = null;
let editMealModal = null;
let editMilkModal = null;
const HISTORY_PAGE_SIZE = 5;
let bazarHistoryRows = [];
let mealHistoryRows = [];
let milkHistoryRows = [];
let bazarHistoryPage = 1;
let mealHistoryPage = 1;
let milkHistoryPage = 1;
const USER_SECTION_IDS = [
  "section-summary",
  "section-bazar",
  "section-meals",
  "section-milk",
  "section-history"
];

// Helper: toggle button spinner and disabled state
function setButtonLoading(btnId, spinnerId, isLoading) {
  const btn = document.getElementById(btnId);
  const spinner = document.getElementById(spinnerId);
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    if (spinner) spinner.classList.remove('d-none');
  } else {
    btn.disabled = false;
    if (spinner) spinner.classList.add('d-none');
  }
}

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
function bindIfExists(id, eventName, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(eventName, handler);
}

document.addEventListener("DOMContentLoaded", async () => {
  currentUser = await requireAuth("user", "user-login.html");
  document.getElementById("userName").textContent = currentUser.name;
  document.getElementById("userUsername").textContent = "@" + currentUser.username;

  initMonthSelector();
  initDashboardTabs(USER_SECTION_IDS);
  loadSummary();
  loadBazarHistory();
  loadMealHistory();
  loadMilkHistory();
  updateMealHistorySearchRange();
  updateMilkHistorySearchRange();

  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
  document.getElementById("bazarForm").addEventListener("submit", handleAddBazar);
  document.getElementById("mealForm").addEventListener("submit", handleAddMeal);
  document.getElementById("milkForm").addEventListener("submit", handleAddMilk);
  document.getElementById("monthSelector").addEventListener("change", onMonthChange);
  document.getElementById("mealHistoryDateSearch").addEventListener("input", loadMealHistory);
  document.getElementById("mealHistoryClearSearch").addEventListener("click", clearMealHistorySearch);
  document.getElementById("milkHistoryDateSearch").addEventListener("input", loadMilkHistory);
  document.getElementById("milkHistoryClearSearch").addEventListener("click", clearMilkHistorySearch);
  bindIfExists("bazarHistoryPrev", "click", () => changeBazarHistoryPage(-1));
  bindIfExists("bazarHistoryNext", "click", () => changeBazarHistoryPage(1));
  bindIfExists("mealHistoryPrev", "click", () => changeMealHistoryPage(-1));
  bindIfExists("mealHistoryNext", "click", () => changeMealHistoryPage(1));
  bindIfExists("milkHistoryPrev", "click", () => changeMilkHistoryPage(-1));
  bindIfExists("milkHistoryNext", "click", () => changeMilkHistoryPage(1));

  // Live total meal counter
  document.getElementById("mealMorning").addEventListener("input", updateMealTotal);
  document.getElementById("mealLunch").addEventListener("input", updateMealTotal);
  document.getElementById("mealDinner").addEventListener("input", updateMealTotal);

  // Edit modal setup
  const editModalEl = document.getElementById('editBazarModal');
  if (editModalEl && window.bootstrap) {
    editBazarModal = new bootstrap.Modal(editModalEl);
    document.getElementById('editBazarForm').addEventListener('submit', submitEditBazar);
  }
  // Edit meal modal setup
  const editMealEl = document.getElementById('editMealModal');
  if (editMealEl && window.bootstrap) {
    editMealModal = new bootstrap.Modal(editMealEl);
    document.getElementById('editMealForm').addEventListener('submit', submitEditMeal);
    // live preview inside modal
    const ids = ['editMealMorning','editMealLunch','editMealDinner'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => {
        const m = parseFloat(document.getElementById('editMealMorning').value) || 0;
        const l = parseFloat(document.getElementById('editMealLunch').value) || 0;
        const d = parseFloat(document.getElementById('editMealDinner').value) || 0;
        document.getElementById('editMealTotalPreview').textContent = m + l + d;
      });
    });
  }

  // Edit milk modal setup
  const editMilkEl = document.getElementById('editMilkModal');
  if (editMilkEl && window.bootstrap) {
    editMilkModal = new bootstrap.Modal(editMilkEl);
    document.getElementById('editMilkForm').addEventListener('submit', submitEditMilk);
  }
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
  bazarHistoryPage = 1;
  mealHistoryPage = 1;
  milkHistoryPage = 1;
  updateMealHistorySearchRange();
  updateMilkHistorySearchRange();
  loadSummary();
  loadBazarHistory();
  loadMealHistory();
  loadMilkHistory();
}

function updateMealHistorySearchRange() {
  const input = document.getElementById("mealHistoryDateSearch");
  if (!input) return;
  const [year, month] = selectedMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  input.min = `${selectedMonth}-01`;
  input.max = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;
  if (input.value && !input.value.startsWith(selectedMonth)) input.value = "";
}

function updateMilkHistorySearchRange() {
  const input = document.getElementById("milkHistoryDateSearch");
  if (!input) return;
  const [year, month] = selectedMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  input.min = `${selectedMonth}-01`;
  input.max = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;
  if (input.value && !input.value.startsWith(selectedMonth)) input.value = "";
}

function clearMealHistorySearch() {
  document.getElementById("mealHistoryDateSearch").value = "";
  mealHistoryPage = 1;
  loadMealHistory();
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

  // Update topbar heading based on active tab
  const headingMap = {
    "section-summary": { label: "My Dashboard", icon: "bi-pie-chart" },
    "section-bazar": { label: "Add Bazar", icon: "bi-basket" },
    "section-meals": { label: "Add Meals", icon: "bi-egg-fried" },
    "section-milk": { label: "Add Milk", icon: "bi-cup-straw" },
    "section-history": { label: "History", icon: "bi-clock-history" },
  };
  const heading = document.getElementById("topbarHeading");
  if (heading && headingMap[activeId]) {
    const { label, icon } = headingMap[activeId];
    heading.innerHTML = `<i class="bi ${icon} me-2" style="color:var(--clr-user)"></i>${label}`;
  }

  if (updateHash && window.location.hash !== `#${activeId}`) {
    window.history.pushState(null, "", `#${activeId}`);
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

function getDashboardTabLinks(sectionIds) {
  return Array.from(document.querySelectorAll('aside nav a[href^="#section-"]'))
    .filter((link) => sectionIds.includes(link.getAttribute("href").slice(1)));
}

// ─────────────────────────────────────────────
// Add Bazar
// ─────────────────────────────────────────────
async function handleAddBazar(e) {
  e.preventDefault();
  const form = e.target;
  const date = form.bazarDate.value;
  const description = form.bazarDesc.value.trim();
  const amount = parseFloat(form.bazarAmount.value);

  if (!date || !description || isNaN(amount) || amount <= 0) {
    showAlert("bazarAlert", "Please fill all fields correctly.", "warning");
    return;
  }

  try {
    setButtonLoading('bazarAddBtn', 'bazarAddSpinner', true);
    await addDoc(collection(db, "bazar"), {
      userId: currentUser.uid,
      date,
      description,
      amount,
      month: date.substring(0, 7), // e.g. "2025-05"
      createdAt: serverTimestamp()
    });
    showAlert("bazarAlert", "Bazar added!", "success");
    form.reset();
    loadSummary();
    bazarHistoryPage = 1;
    loadBazarHistory();
  } catch (err) {
    showAlert("bazarAlert", err.message, "danger");
  } finally {
    setButtonLoading('bazarAddBtn', 'bazarAddSpinner', false);
  }
}

// ─────────────────────────────────────────────
// Add Meal
// ─────────────────────────────────────────────
async function handleAddMeal(e) {
  e.preventDefault();
  const form = e.target;
  const date = form.mealDate.value;
  const morning = parseFloat(form.mealMorning.value) || 0;
  const lunch = parseFloat(form.mealLunch.value) || 0;
  const dinner = parseFloat(form.mealDinner.value) || 0;
  const totalMeal = morning + lunch + dinner;

  if (!date) {
    showAlert("mealAlert", "Please select a date.", "warning");
    return;
  }

  try {
    setButtonLoading('mealAddBtn', 'mealAddSpinner', true);
    // Check if entry exists for this date
    const existing = await getDocs(query(
      collection(db, "meals"),
      where("userId", "==", currentUser.uid),
      where("date", "==", date)
    ));

    if (!existing.empty) {
      showAlert("mealAlert", "Meal entry for this date already exists. Edit it from Meal History.", "warning");
      return;
    }

    await addDoc(collection(db, "meals"), {
      userId: currentUser.uid,
      date,
      morning,
      lunch,
      dinner,
      totalMeal,
      month: date.substring(0, 7),
      createdAt: serverTimestamp()
    });
    showAlert("mealAlert", "Meal added!", "success");
    form.reset();
    document.getElementById("mealTotalPreview").textContent = "0";
    loadSummary();
    mealHistoryPage = 1;
    loadMealHistory();
  } catch (err) {
    showAlert("mealAlert", err.message, "danger");
  } finally {
    setButtonLoading('mealAddBtn', 'mealAddSpinner', false);
  }
}

// ─────────────────────────────────────────────
// Add Milk
// ─────────────────────────────────────────────
async function handleAddMilk(e) {
  e.preventDefault();
  const form = e.target;
  const date = form.milkDate.value;
  const hasMilk = form.milkCheck.checked;

  if (!date) {
    showAlert("milkAlert", "Please select a date.", "warning");
    return;
  }

  if (!hasMilk) {
    showAlert("milkAlert", "Please check the box if you had milk.", "warning");
    return;
  }

  try {
    setButtonLoading('milkAddBtn', 'milkAddSpinner', true);
    await addDoc(collection(db, "milk"), {
      userId: currentUser.uid,
      date,
      hasMilk,
      month: date.substring(0, 7),
      createdAt: serverTimestamp()
    });
    showAlert("milkAlert", "Milk entry added!", "success");
    form.reset();
    loadSummary();
    milkHistoryPage = 1;
    loadMilkHistory();
  } catch (err) {
    showAlert("milkAlert", err.message, "danger");
  } finally {
    setButtonLoading('milkAddBtn', 'milkAddSpinner', false);
  }
}

function updateMealTotal() {
  const m = parseFloat(document.getElementById("mealMorning").value) || 0;
  const l = parseFloat(document.getElementById("mealLunch").value) || 0;
  const d = parseFloat(document.getElementById("mealDinner").value) || 0;
  document.getElementById("mealTotalPreview").textContent = m + l + d;
}

// ─────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────
async function loadSummary() {
  try {
    const [mealsSnap, bazarSnap, milkSnap, monthSnap] = await Promise.all([
      getDocs(query(
        collection(db, "meals"),
        where("userId", "==", currentUser.uid),
        where("month", "==", selectedMonth)
      )),
      getDocs(query(
        collection(db, "bazar"),
        where("userId", "==", currentUser.uid),
        where("month", "==", selectedMonth)
      )),
      getDocs(query(
        collection(db, "milk"),
        where("userId", "==", currentUser.uid),
        where("month", "==", selectedMonth)
      )),
      getDoc(doc(db, "months", selectedMonth))
    ]);

    const userMeals = mealsSnap.docs.map((d) => d.data());
    const userBazar = bazarSnap.docs.map((d) => d.data());
    const userMilk = milkSnap.docs.map((d) => d.data());
    const totalMilk = userMilk.filter(m => m.hasMilk).length;
    const monthData = monthSnap.exists() ? monthSnap.data() : {};
    const calculationSummary = monthData.calculationSummary || {};
    const rates = calculationSummary.mealRates || {};
    const baseRate = calculationSummary.mealRate ?? monthData.mealRate;
    const mealRates = {
      morning: getFiniteNumber(rates.morning ?? monthData.morningRate ?? 0),
      lunch: getFiniteNumber(rates.lunch ?? monthData.lunchRate),
      dinner: getFiniteNumber(rates.dinner ?? monthData.dinnerRate)
    };
    const totalMeals = calcUserTotalMeals(userMeals);
    const totalBazar = calcUserTotalBazar(userBazar);
    const due = await calculateUserDue(userMeals, totalBazar, monthData, mealRates);

    document.getElementById("summTotalBazar").textContent = `৳${round2(totalBazar)}`;
    document.getElementById("summTotalMeals").textContent = round2(totalMeals);
    document.getElementById("summTotalMilk").textContent = totalMilk;
    document.getElementById("summDue").textContent = formatCurrencyOrDash(due);
    document.getElementById("summBaseRate").textContent = formatCurrencyOrDash(baseRate);
    document.getElementById("summDinnerRate").textContent = formatCurrencyOrDash(mealRates.dinner);
    document.getElementById("summLunchRate").textContent = formatCurrencyOrDash(mealRates.lunch);
  } catch (err) {
    console.warn("Failed to load user summary:", err);
    document.getElementById("summDue").textContent = "—";
    document.getElementById("summBaseRate").textContent = "—";
    document.getElementById("summDinnerRate").textContent = "—";
    document.getElementById("summLunchRate").textContent = "—";
  }
}

async function calculateUserDue(userMeals, totalBazar, monthData, mealRates) {
  const mealBreakdown = calcMealBreakdown(userMeals);
  const hasRequiredRates =
    (mealBreakdown.morning === 0 || Number.isFinite(mealRates.morning)) &&
    (mealBreakdown.lunch === 0 || Number.isFinite(mealRates.lunch)) &&
    (mealBreakdown.dinner === 0 || Number.isFinite(mealRates.dinner));
  if (!hasRequiredRates) return null;

  const sharedCosts = await getPerPersonCostsForDue(monthData);
  const rentSplit = await getCurrentUserRentSplit();
  const userMealCost = calcMealCost(mealBreakdown, mealRates);
  const payable = calcUserPayable({
    userMealCost,
    khalaPerPerson: sharedCosts.khala,
    gasPerPerson: sharedCosts.gas,
    electricityPerPerson: sharedCosts.electricity,
    wifiPerPerson: sharedCosts.wifi,
    bariVara: rentSplit?.amount || 0,
    userBazar: totalBazar
  });
  return payable.totalPayable;
}

async function getPerPersonCostsForDue(monthData) {
  const cachedCosts = monthData.calculationSummary?.perPersonCosts;
  if (cachedCosts) {
    return {
      khala: getFiniteNumber(cachedCosts.khala) ?? 0,
      gas: getFiniteNumber(cachedCosts.gas) ?? 0,
      electricity: getFiniteNumber(cachedCosts.electricity) ?? 0,
      wifi: getFiniteNumber(cachedCosts.wifi) ?? 0
    };
  }

  const userCount = await getUserCountForDue(monthData);
  return {
    khala: calcPerPerson(monthData.khalaTotal || 0, userCount),
    gas: calcPerPerson(monthData.gasTotal || 0, userCount),
    electricity: calcPerPerson(monthData.electricityTotal || 0, userCount),
    wifi: calcPerPerson(monthData.wifiTotal || 0, userCount)
  };
}

async function getUserCountForDue(monthData) {
  const cachedUserCount = parseInt(monthData.calculationSummary?.userCount, 10);
  if (Number.isFinite(cachedUserCount) && cachedUserCount > 0) return cachedUserCount;

  try {
    const snap = await getDocs(query(collection(db, "users"), where("role", "==", "user")));
    return snap.size;
  } catch {
    return 0;
  }
}

async function getCurrentUserRentSplit() {
  try {
    const snap = await getDocs(query(
      collection(db, "rentSplits"),
      where("userId", "==", currentUser.uid),
      where("month", "==", selectedMonth)
    ));
    return snap.docs[0]?.data() || null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// Bazar History
// ─────────────────────────────────────────────
async function loadBazarHistory() {
  const snap = await getDocs(query(
    collection(db, "bazar"),
    where("userId", "==", currentUser.uid),
    where("month", "==", selectedMonth)
  ));
  const tbody = document.getElementById("bazarHistoryBody");
  tbody.innerHTML = "";
  bazarHistoryRows = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  renderBazarHistoryPage();
}

function renderBazarHistoryPage() {
  const tbody = document.getElementById("bazarHistoryBody");
  tbody.innerHTML = "";
  normalizeHistoryPage("bazar");
  const rows = getHistoryPageRows(bazarHistoryRows, bazarHistoryPage);

  rows.forEach((b) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Date">${b.date}</td>
      <td data-label="Description">${b.description}</td>
      <td data-label="Amount">৳${b.amount}</td>
      <td data-label="Actions">
        <button class="btn btn-sm btn-outline-primary bazar-edit" data-id="${b.id}">Edit</button>
      </td>
    `;
    tbody.appendChild(tr);
    const editBtn = tr.querySelector('.bazar-edit');
    if (editBtn) editBtn.addEventListener('click', () => openEditModal(b.id, b));
  });
  if (bazarHistoryRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No bazar entries</td></tr>`;
  }
  renderHistoryPagination("bazar");
}

// Open edit modal and prefill values
function openEditModal(bazarId, bazarData) {
  if (!editBazarModal) return;
  document.getElementById('editBazarId').value = bazarId;
  document.getElementById('editBazarDate').value = bazarData.date || '';
  document.getElementById('editBazarDesc').value = bazarData.description || '';
  document.getElementById('editBazarAmount').value = bazarData.amount || '';
  editBazarModal.show();
}

// Submit edit modal
async function submitEditBazar(e) {
  e.preventDefault();
  const id = document.getElementById('editBazarId').value;
  const date = document.getElementById('editBazarDate').value;
  const description = document.getElementById('editBazarDesc').value.trim();
  const amount = parseFloat(document.getElementById('editBazarAmount').value);
  if (!id || !date || !description || isNaN(amount) || amount <= 0) {
    showAlert('bazarAlert', 'Please fill all fields correctly.', 'warning');
    return;
  }
  try {
    setButtonLoading('editBazarSaveBtn', 'editBazarSpinner', true);
    await updateDoc(doc(db, 'bazar', id), {
      date,
      description,
      amount,
      month: date.substring(0,7)
    });
    showAlert('bazarAlert', 'Bazar entry updated.', 'success');
    editBazarModal.hide();
    loadSummary();
    bazarHistoryPage = 1;
    loadBazarHistory();
  } catch (err) {
    showAlert('bazarAlert', err.message, 'danger');
  }
  finally {
    setButtonLoading('editBazarSaveBtn', 'editBazarSpinner', false);
  }
}

// ─────────────────────────────────────────────
// Meal History
// ─────────────────────────────────────────────
async function loadMealHistory() {
  mealHistoryPage = 1;
  const searchDate = document.getElementById("mealHistoryDateSearch")?.value || "";
  const snap = await getDocs(query(
    collection(db, "meals"),
    where("userId", "==", currentUser.uid),
    where("month", "==", selectedMonth)
  ));
  const tbody = document.getElementById("mealHistoryBody");
  tbody.innerHTML = "";
  mealHistoryRows = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => !searchDate || m.date === searchDate)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  renderMealHistoryPage(searchDate);
}

function renderMealHistoryPage(searchDate = document.getElementById("mealHistoryDateSearch")?.value || "") {
  const tbody = document.getElementById("mealHistoryBody");
  tbody.innerHTML = "";
  normalizeHistoryPage("meal");
  const rows = getHistoryPageRows(mealHistoryRows, mealHistoryPage);

  rows.forEach((m) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Date">${m.date}</td>
      <td data-label="Morning">${m.morning}</td>
      <td data-label="Lunch">${m.lunch}</td>
      <td data-label="Dinner">${m.dinner}</td>
      <td data-label="Total"><strong>${m.totalMeal}</strong></td>
      <td data-label="Actions">
        <button class="btn btn-sm btn-outline-primary meal-edit" data-id="${m.id}">Edit</button>
      </td>
    `;
    tbody.appendChild(tr);
    const editBtn = tr.querySelector('.meal-edit');
    if (editBtn) editBtn.addEventListener('click', () => openEditMealModal(m.id, m));
  });
  if (mealHistoryRows.length === 0) {
    const message = searchDate ? `No meal entry found for ${searchDate}` : "No meal entries";
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">${message}</td></tr>`;
  }
  renderHistoryPagination("meal");
}

function changeBazarHistoryPage(delta) {
  bazarHistoryPage += delta;
  renderBazarHistoryPage();
}

function changeMealHistoryPage(delta) {
  mealHistoryPage += delta;
  renderMealHistoryPage();
}

function getHistoryPageRows(rows, page) {
  const start = (page - 1) * HISTORY_PAGE_SIZE;
  return rows.slice(start, start + HISTORY_PAGE_SIZE);
}

function getHistoryPageCount(type) {
  let total;
  if (type === "bazar") total = bazarHistoryRows.length;
  else if (type === "milk") total = milkHistoryRows.length;
  else total = mealHistoryRows.length;
  return Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
}

function normalizeHistoryPage(type) {
  const pageCount = getHistoryPageCount(type);
  if (type === "bazar") {
    if (bazarHistoryPage < 1) bazarHistoryPage = 1;
    if (bazarHistoryPage > pageCount) bazarHistoryPage = pageCount;
  } else if (type === "milk") {
    if (milkHistoryPage < 1) milkHistoryPage = 1;
    if (milkHistoryPage > pageCount) milkHistoryPage = pageCount;
  } else {
    if (mealHistoryPage < 1) mealHistoryPage = 1;
    if (mealHistoryPage > pageCount) mealHistoryPage = pageCount;
  }
}

function renderHistoryPagination(type) {
  let rows, page, prefix;
  if (type === "bazar") { rows = bazarHistoryRows; page = bazarHistoryPage; prefix = "bazarHistory"; }
  else if (type === "milk") { rows = milkHistoryRows; page = milkHistoryPage; prefix = "milkHistory"; }
  else { rows = mealHistoryRows; page = mealHistoryPage; prefix = "mealHistory"; }
  const pageCount = getHistoryPageCount(type);
  const total = rows.length;
  const start = total === 0 ? 0 : (page - 1) * HISTORY_PAGE_SIZE + 1;
  const end = Math.min(total, page * HISTORY_PAGE_SIZE);
  const info = document.getElementById(`${prefix}PageInfo`);
  const label = document.getElementById(`${prefix}PageLabel`);
  const prev = document.getElementById(`${prefix}Prev`);
  const next = document.getElementById(`${prefix}Next`);

  if (info) info.textContent = total === 0 ? "Showing 0 entries" : `Showing ${start}-${end} of ${total}`;
  if (label) label.textContent = `Page ${page} of ${pageCount}`;
  if (prev) prev.disabled = page <= 1;
  if (next) next.disabled = page >= pageCount;
}

// Open meal edit modal
function openEditMealModal(mealId, mealData) {
  if (!editMealModal) return;
  document.getElementById('editMealId').value = mealId;
  document.getElementById('editMealDate').value = mealData.date || '';
  document.getElementById('editMealMorning').value = mealData.morning || 0;
  document.getElementById('editMealLunch').value = mealData.lunch || 0;
  document.getElementById('editMealDinner').value = mealData.dinner || 0;
  document.getElementById('editMealTotalPreview').textContent = mealData.totalMeal || 0;
  editMealModal.show();
}

// Submit meal edit
async function submitEditMeal(e) {
  e.preventDefault();
  const id = document.getElementById('editMealId').value;
  const date = document.getElementById('editMealDate').value;
  const morning = parseFloat(document.getElementById('editMealMorning').value) || 0;
  const lunch = parseFloat(document.getElementById('editMealLunch').value) || 0;
  const dinner = parseFloat(document.getElementById('editMealDinner').value) || 0;
  const totalMeal = morning + lunch + dinner;
  if (!id || !date) {
    showAlert('mealAlert', 'Please fill all fields correctly.', 'warning');
    return;
  }
  try {
    setButtonLoading('editMealSaveBtn', 'editMealSpinner', true);
    await updateDoc(doc(db, 'meals', id), {
      date,
      morning,
      lunch,
      dinner,
      totalMeal,
      month: date.substring(0,7)
    });
    showAlert('mealAlert', 'Meal entry updated.', 'success');
    editMealModal.hide();
    loadSummary();
    mealHistoryPage = 1;
    loadMealHistory();
  } catch (err) {
    showAlert('mealAlert', err.message, 'danger');
  } finally {
    setButtonLoading('editMealSaveBtn', 'editMealSpinner', false);
  }
}

// ─────────────────────────────────────────────
// Milk History
// ─────────────────────────────────────────────
async function loadMilkHistory() {
  milkHistoryPage = 1;
  const searchDate = document.getElementById("milkHistoryDateSearch")?.value || "";
  const snap = await getDocs(query(
    collection(db, "milk"),
    where("userId", "==", currentUser.uid),
    where("month", "==", selectedMonth)
  ));
  const tbody = document.getElementById("milkHistoryBody");
  tbody.innerHTML = "";
  milkHistoryRows = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => !searchDate || m.date === searchDate)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  renderMilkHistoryPage(searchDate);
}

function renderMilkHistoryPage(searchDate = document.getElementById("milkHistoryDateSearch")?.value || "") {
  const tbody = document.getElementById("milkHistoryBody");
  tbody.innerHTML = "";
  normalizeHistoryPage("milk");
  const rows = getHistoryPageRows(milkHistoryRows, milkHistoryPage);

  rows.forEach((m) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Date">${m.date}</td>
      <td data-label="Milk">${m.hasMilk ? '✅ Had Milk' : '❌ No Milk'}</td>
      <td data-label="Actions">
        <button class="btn btn-sm btn-outline-primary milk-edit" data-id="${m.id}">Edit</button>
      </td>
    `;
    tbody.appendChild(tr);
    const editBtn = tr.querySelector('.milk-edit');
    if (editBtn) editBtn.addEventListener('click', () => openEditMilkModal(m.id, m));
  });
  if (milkHistoryRows.length === 0) {
    const message = searchDate ? `No milk entry found for ${searchDate}` : "No milk entries";
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">${message}</td></tr>`;
  }
  renderHistoryPagination("milk");
}

function changeMilkHistoryPage(delta) {
  milkHistoryPage += delta;
  renderMilkHistoryPage();
}

function clearMilkHistorySearch() {
  document.getElementById("milkHistoryDateSearch").value = "";
  milkHistoryPage = 1;
  loadMilkHistory();
}

// ─────────────────────────────────────────────
// Edit Milk Modal
// ─────────────────────────────────────────────
function openEditMilkModal(milkId, milkData) {
  if (!editMilkModal) return;
  document.getElementById('editMilkId').value = milkId;
  document.getElementById('editMilkDate').value = milkData.date || '';
  document.getElementById('editMilkCheck').checked = milkData.hasMilk || false;
  editMilkModal.show();
}

async function submitEditMilk(e) {
  e.preventDefault();
  const id = document.getElementById('editMilkId').value;
  const date = document.getElementById('editMilkDate').value;
  const hasMilk = document.getElementById('editMilkCheck').checked;
  if (!id || !date) {
    showAlert('milkAlert', 'Please fill all fields correctly.', 'warning');
    return;
  }
  try {
    setButtonLoading('editMilkSaveBtn', 'editMilkSpinner', true);
    await updateDoc(doc(db, 'milk', id), {
      date,
      hasMilk,
      month: date.substring(0,7)
    });
    showAlert('milkAlert', 'Milk entry updated.', 'success');
    editMilkModal.hide();
    loadSummary();
    milkHistoryPage = 1;
    loadMilkHistory();
  } catch (err) {
    showAlert('milkAlert', err.message, 'danger');
  } finally {
    setButtonLoading('editMilkSaveBtn', 'editMilkSpinner', false);
  }
}

// ─────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────
async function handleLogout() {
  await logout();
  window.location.href = "index.html";
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function getFiniteNumber(value) {
  const amount = parseFloat(value);
  return Number.isFinite(amount) ? amount : null;
}

function formatCurrencyOrDash(value) {
  const amount = parseFloat(value);
  if (!Number.isFinite(amount)) return "—";
  const rounded = round2(amount);
  return rounded < 0 ? `-৳${Math.abs(rounded)}` : `৳${rounded}`;
}

function showAlert(id, msg, type) {
  const el = document.getElementById(id);
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove("d-none");
  setTimeout(() => el.classList.add("d-none"), 4000);
}
