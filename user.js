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
import { t, getLanguage, toggleLanguage, applyTranslations } from "./i18n.js";
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
const HISTORY_PAGE_SIZE = 5;
let bazarHistoryRows = [];
let mealHistoryRows = [];
let bazarHistoryPage = 1;
let mealHistoryPage = 1;
let lastUserSummaryData = {
  userMeals: [],
  userBazar: [],
  monthData: {},
  mealRates: {},
  payableData: null,
  totalMeals: 0,
  totalBazar: 0,
  due: null
};
const USER_SECTION_IDS = [
  "section-summary",
  "section-bazar",
  "section-meals",
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
  applyTranslations();
  initDashboardTabs(USER_SECTION_IDS);
  initMonthSelector();

  bindIfExists("langToggleBtn", "click", () => {
    toggleLanguage();
    applyTranslations();
    loadSummary();
  });
  bindIfExists("userShareWaBtn", "click", shareMyStatementWa);
  bindIfExists("userExportCsvBtn", "click", exportMyStatementCsv);
  bindIfExists("logoutBtn", "click", handleLogout);
  bindIfExists("mobileLogoutBtn", "click", handleLogout);
  bindIfExists("mobileMoreBtn", "click", openUserMoreDrawer);
  bindIfExists("userMoreDrawerClose", "click", closeUserMoreDrawer);
  bindIfExists("userMoreDrawerBackdrop", "click", closeUserMoreDrawer);
  document.getElementById("bazarForm").addEventListener("submit", handleAddBazar);
  document.getElementById("mealForm").addEventListener("submit", handleAddMeal);
  document.getElementById("monthSelector").addEventListener("change", onMonthChange);
  document.getElementById("mealHistoryDateSearch").addEventListener("input", loadMealHistory);
  document.getElementById("mealHistoryClearSearch").addEventListener("click", clearMealHistorySearch);
  bindIfExists("bazarHistoryPrev", "click", () => changeBazarHistoryPage(-1));
  bindIfExists("bazarHistoryNext", "click", () => changeBazarHistoryPage(1));
  bindIfExists("mealHistoryPrev", "click", () => changeMealHistoryPage(-1));
  bindIfExists("mealHistoryNext", "click", () => changeMealHistoryPage(1));

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
    const ids = ['editMealMorning', 'editMealLunch', 'editMealDinner'];
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

  currentUser = await requireAuth("user", "user-login.html");
  document.getElementById("userName").textContent = currentUser.name;
  document.getElementById("userUsername").textContent = "@" + currentUser.username;

  loadSummary();
  loadBazarHistory();
  loadMealHistory();
  updateMealHistorySearchRange();
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
  updateMealHistorySearchRange();
  loadSummary();
  loadBazarHistory();
  loadMealHistory();
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

function clearMealHistorySearch() {
  document.getElementById("mealHistoryDateSearch").value = "";
  mealHistoryPage = 1;
  loadMealHistory();
}

function openUserMoreDrawer() {
  const drawer = document.getElementById("userMoreDrawer");
  const backdrop = document.getElementById("userMoreDrawerBackdrop");
  if (drawer && backdrop) {
    backdrop.classList.remove("d-none");
    requestAnimationFrame(() => {
      drawer.classList.add("show");
      backdrop.classList.add("show");
    });
  }
}

function closeUserMoreDrawer() {
  const drawer = document.getElementById("userMoreDrawer");
  const backdrop = document.getElementById("userMoreDrawerBackdrop");
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
      closeUserMoreDrawer();
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

  const moreSubSectionIds = ["section-history"];
  const moreBtn = document.getElementById("mobileMoreBtn");
  if (moreBtn) {
    moreBtn.classList.toggle("active", moreSubSectionIds.includes(activeId));
  }

  // Update topbar heading based on active tab
  const headingMap = {
    "section-summary": { label: "Dashboard", icon: "bi-pie-chart" },
    "section-bazar": { label: "Add Bazar", icon: "bi-basket" },
    "section-meals": { label: "Add Meals", icon: "bi-egg-fried" },
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
  return Array.from(document.querySelectorAll('aside.sidebar nav a[href^="#section-"], #userMoreDrawer a[href^="#section-"]'))
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


function updateMealTotal() {
  const m = parseFloat(document.getElementById("mealMorning").value) || 0;
  const l = parseFloat(document.getElementById("mealLunch").value) || 0;
  const d = parseFloat(document.getElementById("mealDinner").value) || 0;
  document.getElementById("mealTotalPreview").textContent = m + l + d;
}

// ─────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────
function renderSummarySkeleton() {
  const configs = [
    { id: "summTotalBazar", width: "70px" },
    { id: "summTotalMeals", width: "50px" },
    { id: "summDue", width: "75px" },
    { id: "summBaseRate", width: "60px" },
    { id: "summDinnerRate", width: "60px" },
    { id: "summLunchRate", width: "60px" }
  ];
  configs.forEach(({ id, width }) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<span class="skeleton skeleton-value" style="width:${width};"></span>`;
  });
}

async function loadSummary() {
  renderSummarySkeleton();
  try {
    const [mealsSnap, bazarSnap, monthSnap] = await Promise.all([
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
      getDoc(doc(db, "months", selectedMonth))
    ]);

    const userMeals = mealsSnap.docs.map((d) => d.data());
    const userBazar = bazarSnap.docs.map((d) => d.data());
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
    const payableBreakdown = await calculateUserPayableBreakdown(userMeals, totalBazar, monthData, mealRates);
    const due = payableBreakdown ? payableBreakdown.totalPayable : null;

    lastUserSummaryData = {
      userMeals,
      userBazar,
      monthData,
      mealRates,
      baseRate,
      payableBreakdown,
      totalMeals,
      totalBazar,
      due
    };

    document.getElementById("summTotalBazar").textContent = `৳${round2(totalBazar)}`;
    document.getElementById("summTotalMeals").textContent = round2(totalMeals);
    document.getElementById("summDue").textContent = formatCurrencyOrDash(due);
    document.getElementById("summBaseRate").textContent = formatCurrencyOrDash(baseRate);
    document.getElementById("summDinnerRate").textContent = formatCurrencyOrDash(mealRates.dinner);
    document.getElementById("summLunchRate").textContent = formatCurrencyOrDash(mealRates.lunch);

    updateUserAnalytics(userMeals, totalBazar, payableBreakdown);
  } catch (err) {
    console.warn("Failed to load user summary:", err);
    document.getElementById("summDue").textContent = "—";
    document.getElementById("summBaseRate").textContent = "—";
    document.getElementById("summDinnerRate").textContent = "—";
    document.getElementById("summLunchRate").textContent = "—";
  }
}

async function calculateUserPayableBreakdown(userMeals, totalBazar, monthData, mealRates) {
  const mealBreakdown = calcMealBreakdown(userMeals);
  const hasRequiredRates =
    (mealBreakdown.morning === 0 || Number.isFinite(mealRates.morning)) &&
    (mealBreakdown.lunch === 0 || Number.isFinite(mealRates.lunch)) &&
    (mealBreakdown.dinner === 0 || Number.isFinite(mealRates.dinner));
  if (!hasRequiredRates) return null;

  const sharedCosts = await getPerPersonCostsForDue(monthData);
  const rentSplit = await getCurrentUserRentSplit();
  const userMealCost = calcMealCost(mealBreakdown, mealRates);
  return {
    mealBreakdown,
    userMealCost: round2(userMealCost),
    sharedCosts,
    bariVara: rentSplit?.amount || 0,
    ...calcUserPayable({
      userMealCost,
      khalaPerPerson: sharedCosts.khala,
      gasPerPerson: sharedCosts.gas,
      electricityPerPerson: sharedCosts.electricity,
      wifiPerPerson: sharedCosts.wifi,
      bariVara: rentSplit?.amount || 0,
      userBazar: totalBazar
    })
  };
}

function updateUserAnalytics(userMeals, totalBazar, payableBreakdown) {
  const mealBreakdown = calcMealBreakdown(userMeals);
  const totalMeals = mealBreakdown.total || 0;

  const totalMealsBadge = document.getElementById("userAnalyticsTotalMeals");
  if (totalMealsBadge) totalMealsBadge.textContent = `${totalMeals} ${t("total_meals")}`;

  const mPct = totalMeals > 0 ? (mealBreakdown.morning / totalMeals) * 100 : 0;
  const lPct = totalMeals > 0 ? (mealBreakdown.lunch / totalMeals) * 100 : 0;
  const dPct = totalMeals > 0 ? (mealBreakdown.dinner / totalMeals) * 100 : 0;

  const barM = document.getElementById("userBarMorning");
  const barL = document.getElementById("userBarLunch");
  const barD = document.getElementById("userBarDinner");
  if (barM) barM.style.width = `${mPct}%`;
  if (barL) barL.style.width = `${lPct}%`;
  if (barD) barD.style.width = `${dPct}%`;

  const valM = document.getElementById("userValMorning");
  const valL = document.getElementById("userValLunch");
  const valD = document.getElementById("userValDinner");
  if (valM) valM.textContent = `${mealBreakdown.morning} (${Math.round(mPct)}%)`;
  if (valL) valL.textContent = `${mealBreakdown.lunch} (${Math.round(lPct)}%)`;
  if (valD) valD.textContent = `${mealBreakdown.dinner} (${Math.round(dPct)}%)`;

  const statusBadge = document.getElementById("userAnalyticsStatusBadge");
  const barBazar = document.getElementById("userBarBazar");
  const barDue = document.getElementById("userBarDue");
  const valBazar = document.getElementById("userValBazar");
  const valDue = document.getElementById("userValDue");

  if (!payableBreakdown) {
    if (statusBadge) statusBadge.textContent = "Calculating...";
    return;
  }

  const totalExpense = (payableBreakdown.mealCost || 0) +
    (payableBreakdown.khalaPerPerson || 0) +
    (payableBreakdown.gasPerPerson || 0) +
    (payableBreakdown.electricityPerPerson || 0) +
    (payableBreakdown.wifiPerPerson || 0) +
    (payableBreakdown.bariVara || 0);

  const due = payableBreakdown.totalPayable;

  if (valBazar) valBazar.textContent = `৳${round2(totalBazar)}`;
  if (valDue) valDue.textContent = `৳${round2(totalExpense)}`;

  if (totalExpense > 0) {
    const bazarPct = Math.min(100, Math.round((totalBazar / totalExpense) * 100));
    const remainingPct = Math.max(0, 100 - bazarPct);
    if (barBazar) barBazar.style.width = `${bazarPct}%`;
    if (barDue) barDue.style.width = `${remainingPct}%`;
  } else {
    if (barBazar) barBazar.style.width = totalBazar > 0 ? "100%" : "0%";
    if (barDue) barDue.style.width = "0%";
  }

  if (statusBadge) {
    if (due > 0) {
      statusBadge.className = "badge bg-warning text-dark border";
      statusBadge.textContent = `বকেয়া: ৳${due}`;
    } else if (due < 0) {
      statusBadge.className = "badge bg-success text-white border";
      statusBadge.textContent = `পাওনা/অগ্রিম: ৳${Math.abs(due)}`;
    } else {
      statusBadge.className = "badge bg-info text-dark border";
      statusBadge.textContent = "পরিশোধিত (Clear)";
    }
  }
}

function shareMyStatementWa() {
  const p = lastUserSummaryData.payableBreakdown;
  const totalMeals = lastUserSummaryData.totalMeals || 0;
  const totalBazar = lastUserSummaryData.totalBazar || 0;
  const mb = p?.mealBreakdown || { morning: 0, lunch: 0, dinner: 0 };
  const rates = lastUserSummaryData.mealRates || {};

  const dueText = p 
    ? (p.totalPayable >= 0 ? `বকেয়া (Due): ৳${p.totalPayable}` : `পাওনা/অগ্রিম: ৳${Math.abs(p.totalPayable)}`)
    : "হিসাব প্রক্রিয়াধীন";

  const message = 
`🏠 *আমার মেস হিসাব — ${selectedMonth}*
👤 *সদস্য:* ${currentUser.name} (@${currentUser.username})
━━━━━━━━━━━━━━━━━━━━━
🍽️ *মিল বিবরণ:*
• সকাল: ${mb.morning} | দুপুর: ${mb.lunch} | রাত: ${mb.dinner}
• মোট মিল: ${totalMeals} টি
• মিল রেট: ৳${lastUserSummaryData.baseRate || "—"} (দুপুর: ৳${rates.lunch || "—"}, রাত: ৳${rates.dinner || "—"})
• মিল খরচ: ৳${p?.mealCost ?? "—"}

🏢 *অন্যান্য ও ঘর ভাড়া:*
• খালা বিল: ৳${p?.khalaPerPerson ?? 0}
• গ্যাস বিল: ৳${p?.gasPerPerson ?? 0}
• বিদ্যুৎ বিল: ৳${p?.electricityPerPerson ?? 0}
• ওয়াইফাই বিল: ৳${p?.wifiPerPerson ?? 0}
• ঘর ভাড়া: ৳${p?.bariVara ?? 0}

🛒 *আমার বাজার জমা:* ৳${totalBazar}
━━━━━━━━━━━━━━━━━━━━━
💰 *সর্বমোট ব্যালেন্স:* *${dueText}*
━━━━━━━━━━━━━━━━━━━━━
📱 হিসাব অ্যাপ থেকে প্রেরিত`;

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(message).catch(() => {});
  }
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
  window.open(waUrl, "_blank");
}

function exportMyStatementCsv() {
  const p = lastUserSummaryData.payableBreakdown;
  const totalMeals = lastUserSummaryData.totalMeals || 0;
  const totalBazar = lastUserSummaryData.totalBazar || 0;
  const mb = p?.mealBreakdown || { morning: 0, lunch: 0, dinner: 0 };

  const summaryHeaders = ["Field", "Value"];
  const summaryRows = [
    ["Member Name", `"${currentUser.name}"`],
    ["Username", `"${currentUser.username}"`],
    ["Month", `"${selectedMonth}"`],
    ["Morning Meals", mb.morning],
    ["Lunch Meals", mb.lunch],
    ["Dinner Meals", mb.dinner],
    ["Total Meals", totalMeals],
    ["Base Meal Rate", lastUserSummaryData.baseRate || 0],
    ["Meal Cost (TK)", p?.mealCost ?? 0],
    ["Khala Bill (TK)", p?.khalaPerPerson ?? 0],
    ["Gas Bill (TK)", p?.gasPerPerson ?? 0],
    ["Electricity Bill (TK)", p?.electricityPerPerson ?? 0],
    ["WiFi Bill (TK)", p?.wifiPerPerson ?? 0],
    ["Room Rent (TK)", p?.bariVara ?? 0],
    ["My Total Bazar (TK)", totalBazar],
    ["Net Due / Payable (TK)", p?.totalPayable ?? 0]
  ].map(r => r.join(","));

  const bazarHeaders = ["Date", "Description", "Amount (TK)"];
  const bazarRows = (lastUserSummaryData.userBazar || []).map(b => [
    `"${b.date || ""}"`,
    `"${(b.description || "").replaceAll('"', '""')}"`,
    b.amount || 0
  ].join(","));

  const csvContent = "\uFEFF" + [
    "=== MONTHLY SUMMARY ===",
    summaryHeaders.join(","),
    ...summaryRows,
    "",
    "=== MY BAZAR LOGS ===",
    bazarHeaders.join(","),
    ...bazarRows
  ].join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `my-statement-${selectedMonth}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
function renderBazarHistorySkeleton() {
  const tbody = document.getElementById("bazarHistoryBody");
  if (!tbody) return;
  setHistoryPaginationLoading("bazar");
  tbody.innerHTML = Array.from({ length: 5 }, () => `
    <tr class="skeleton-row">
      <td data-label="Date"><span class="skeleton skeleton-text" style="width: 85px;"></span></td>
      <td data-label="Description"><span class="skeleton skeleton-text" style="width: 130px;"></span></td>
      <td data-label="Amount"><span class="skeleton skeleton-text" style="width: 65px;"></span></td>
      <td data-label="Actions"><span class="skeleton skeleton-btn"></span></td>
    </tr>
  `).join("");
}

async function loadBazarHistory() {
  renderBazarHistorySkeleton();
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
      month: date.substring(0, 7)
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
function renderMealHistorySkeleton() {
  const tbody = document.getElementById("mealHistoryBody");
  if (!tbody) return;
  setHistoryPaginationLoading("meal");
  tbody.innerHTML = Array.from({ length: 5 }, () => `
    <tr class="skeleton-row">
      <td data-label="Date"><span class="skeleton skeleton-text" style="width: 85px;"></span></td>
      <td data-label="Morning"><span class="skeleton skeleton-text" style="width: 30px;"></span></td>
      <td data-label="Lunch"><span class="skeleton skeleton-text" style="width: 30px;"></span></td>
      <td data-label="Dinner"><span class="skeleton skeleton-text" style="width: 30px;"></span></td>
      <td data-label="Total"><span class="skeleton skeleton-text" style="width: 35px;"></span></td>
      <td data-label="Actions"><span class="skeleton skeleton-btn"></span></td>
    </tr>
  `).join("");
}

async function loadMealHistory() {
  renderMealHistorySkeleton();
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
  else total = mealHistoryRows.length;
  return Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
}

function normalizeHistoryPage(type) {
  const pageCount = getHistoryPageCount(type);
  if (type === "bazar") {
    if (bazarHistoryPage < 1) bazarHistoryPage = 1;
    if (bazarHistoryPage > pageCount) bazarHistoryPage = pageCount;
  } else {
    if (mealHistoryPage < 1) mealHistoryPage = 1;
    if (mealHistoryPage > pageCount) mealHistoryPage = pageCount;
  }
}

function setHistoryPaginationLoading(type) {
  let prefix;
  if (type === "bazar") prefix = "bazarHistory";
  else prefix = "mealHistory";
  const info = document.getElementById(`${prefix}PageInfo`);
  const label = document.getElementById(`${prefix}PageLabel`);
  const prev = document.getElementById(`${prefix}Prev`);
  const next = document.getElementById(`${prefix}Next`);
  if (info) info.textContent = "Loading entries...";
  if (label) label.textContent = "Page — of —";
  if (prev) prev.disabled = true;
  if (next) next.disabled = true;
}

function renderHistoryPagination(type) {
  let rows, page, prefix;
  if (type === "bazar") { rows = bazarHistoryRows; page = bazarHistoryPage; prefix = "bazarHistory"; }
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
      month: date.substring(0, 7)
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
