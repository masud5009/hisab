// ============================================================
// user.js
// User Dashboard logic: add bazar, add meals, view summary
// ============================================================

import { auth, db } from "./firebase-config.js";
import { requireAuth, logout } from "./auth.js";
import { calcMealRate, calcUserTotalMeals, calcUserTotalBazar } from "./calculation.js";
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let currentUser = null;
let selectedMonth = getCurrentMonth();

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  currentUser = await requireAuth("user", "user-login.html");
  document.getElementById("userName").textContent = currentUser.name;
  document.getElementById("userUsername").textContent = "@" + currentUser.username;

  initMonthSelector();
  loadSummary();
  loadBazarHistory();
  loadMealHistory();

  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
  document.getElementById("bazarForm").addEventListener("submit", handleAddBazar);
  document.getElementById("mealForm").addEventListener("submit", handleAddMeal);
  document.getElementById("monthSelector").addEventListener("change", onMonthChange);

  // Live total meal counter
  document.getElementById("mealMorning").addEventListener("input", updateMealTotal);
  document.getElementById("mealLunch").addEventListener("input", updateMealTotal);
  document.getElementById("mealDinner").addEventListener("input", updateMealTotal);
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
  loadSummary();
  loadBazarHistory();
  loadMealHistory();
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
    loadBazarHistory();
  } catch (err) {
    showAlert("bazarAlert", err.message, "danger");
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
    // Check if entry exists for this date
    const existing = await getDocs(query(
      collection(db, "meals"),
      where("userId", "==", currentUser.uid),
      where("date", "==", date)
    ));

    if (!existing.empty) {
      showAlert("mealAlert", "Meal entry for this date already exists. Delete it first.", "warning");
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
    loadMealHistory();
  } catch (err) {
    showAlert("mealAlert", err.message, "danger");
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
  // User's data
  const mealsSnap = await getDocs(query(
    collection(db, "meals"),
    where("userId", "==", currentUser.uid),
    where("month", "==", selectedMonth)
  ));
  const bazarSnap = await getDocs(query(
    collection(db, "bazar"),
    where("userId", "==", currentUser.uid),
    where("month", "==", selectedMonth)
  ));

  const userMeals = mealsSnap.docs.map((d) => d.data());
  const userBazar = bazarSnap.docs.map((d) => d.data());

  const totalMeals = calcUserTotalMeals(userMeals);
  const totalBazar = calcUserTotalBazar(userBazar);

  // All meals + bazar for meal rate
  const allMealsSnap = await getDocs(query(collection(db, "meals"), where("month", "==", selectedMonth)));
  const allBazarSnap = await getDocs(query(collection(db, "bazar"), where("month", "==", selectedMonth)));
  const allMeals = allMealsSnap.docs.map((d) => d.data());
  const allBazar = allBazarSnap.docs.map((d) => d.data());

  const mealRate = calcMealRate(allMeals, allBazar);
  const mealCost = round2(totalMeals * mealRate);

  // Month costs
  const monthSnap = await getDoc(doc(db, "months", selectedMonth));
  const monthCosts = monthSnap.exists() ? monthSnap.data() : {};

  // Active users count for per-person split
  const usersSnap = await getDocs(query(collection(db, "users"), where("role", "==", "user")));
  const userCount = usersSnap.size;

  const khalaPerPerson = round2((monthCosts.khalaTotal || 0) / (userCount || 1));
  const gasPerPerson = round2((monthCosts.gasTotal || 0) / (userCount || 1));
  const electricityPerPerson = round2((monthCosts.electricityTotal || 0) / (userCount || 1));
  const wifiPerPerson = round2((monthCosts.wifiTotal || 0) / (userCount || 1));

  // Bari vara: check locked split
  const rentSnap = await getDocs(query(
    collection(db, "rentSplits"),
    where("userId", "==", currentUser.uid),
    where("month", "==", selectedMonth)
  ));
  const rentSplit = rentSnap.docs[0]?.data();
  const bariVara = rentSplit ? rentSplit.amount : round2((monthCosts.bariVaraTotal || 0) / (userCount || 1));

  const totalPayable = round2(mealCost + khalaPerPerson + gasPerPerson + electricityPerPerson + wifiPerPerson + bariVara);

  // Update UI
  document.getElementById("summTotalMeals").textContent = totalMeals;
  document.getElementById("summTotalBazar").textContent = `৳${round2(totalBazar)}`;
  document.getElementById("summMealRate").textContent = `৳${round2(mealRate)}`;
  document.getElementById("summMealCost").textContent = `৳${mealCost}`;
  document.getElementById("summKhala").textContent = `৳${khalaPerPerson}`;
  document.getElementById("summGas").textContent = `৳${gasPerPerson}`;
  document.getElementById("summElectricity").textContent = `৳${electricityPerPerson}`;
  document.getElementById("summWifi").textContent = `৳${wifiPerPerson}`;
  document.getElementById("summBariVara").textContent = `৳${bariVara}`;
  document.getElementById("summTotalPayable").textContent = `৳${totalPayable}`;
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
  let total = 0;
  const rows = snap.docs
    .map((d) => d.data())
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  rows.forEach((b) => {
    total += b.amount;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${b.date}</td><td>${b.description}</td><td>৳${b.amount}</td>`;
    tbody.appendChild(tr);
  });
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No bazar entries</td></tr>`;
  }
}

// ─────────────────────────────────────────────
// Meal History
// ─────────────────────────────────────────────
async function loadMealHistory() {
  const snap = await getDocs(query(
    collection(db, "meals"),
    where("userId", "==", currentUser.uid),
    where("month", "==", selectedMonth)
  ));
  const tbody = document.getElementById("mealHistoryBody");
  tbody.innerHTML = "";
  const rows = snap.docs
    .map((d) => d.data())
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  rows.forEach((m) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${m.date}</td><td>${m.morning}</td><td>${m.lunch}</td><td>${m.dinner}</td><td><strong>${m.totalMeal}</strong></td>`;
    tbody.appendChild(tr);
  });
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No meal entries</td></tr>`;
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

function showAlert(id, msg, type) {
  const el = document.getElementById(id);
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove("d-none");
  setTimeout(() => el.classList.add("d-none"), 4000);
}
