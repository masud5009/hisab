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
  onSnapshot,
  deleteDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let currentUser = null;
let selectedMonth = getCurrentMonth();
let editBazarModal = null;
let editMealModal = null;

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
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  rows.forEach((b) => {
    total += b.amount;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${b.date}</td>
      <td>${b.description}</td>
      <td>৳${b.amount}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary me-1 bazar-edit" data-id="${b.id}">Edit</button>
        <button class="btn btn-sm btn-outline-danger bazar-delete" data-id="${b.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
    const delBtn = tr.querySelector('.bazar-delete');
    const editBtn = tr.querySelector('.bazar-edit');
    if (delBtn) delBtn.addEventListener('click', () => handleDeleteBazar(b.id));
    if (editBtn) editBtn.addEventListener('click', () => openEditModal(b.id, b));
  });
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No bazar entries</td></tr>`;
  }
}

// Delete bazar entry
async function handleDeleteBazar(bazarId) {
  if (!confirm('Are you sure you want to delete this bazar entry?')) return;
  try {
    await deleteDoc(doc(db, 'bazar', bazarId));
    showAlert('bazarAlert', 'Bazar entry deleted.', 'success');
    loadSummary();
    loadBazarHistory();
  } catch (err) {
    showAlert('bazarAlert', err.message, 'danger');
  }
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
  const snap = await getDocs(query(
    collection(db, "meals"),
    where("userId", "==", currentUser.uid),
    where("month", "==", selectedMonth)
  ));
  const tbody = document.getElementById("mealHistoryBody");
  tbody.innerHTML = "";
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  rows.forEach((m) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${m.date}</td>
      <td>${m.morning}</td>
      <td>${m.lunch}</td>
      <td>${m.dinner}</td>
      <td><strong>${m.totalMeal}</strong></td>
      <td>
        <button class="btn btn-sm btn-outline-primary me-1 meal-edit" data-id="${m.id}">Edit</button>
        <button class="btn btn-sm btn-outline-danger meal-delete" data-id="${m.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
    const delBtn = tr.querySelector('.meal-delete');
    const editBtn = tr.querySelector('.meal-edit');
    if (delBtn) delBtn.addEventListener('click', () => handleDeleteMeal(m.id));
    if (editBtn) editBtn.addEventListener('click', () => openEditMealModal(m.id, m));
  });
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No meal entries</td></tr>`;
  }
}

// Delete meal entry
async function handleDeleteMeal(mealId) {
  if (!confirm('Are you sure you want to delete this meal entry?')) return;
  try {
    await deleteDoc(doc(db, 'meals', mealId));
    showAlert('mealAlert', 'Meal entry deleted.', 'success');
    loadSummary();
    loadMealHistory();
  } catch (err) {
    showAlert('mealAlert', err.message, 'danger');
  }
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

function showAlert(id, msg, type) {
  const el = document.getElementById(id);
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove("d-none");
  setTimeout(() => el.classList.add("d-none"), 4000);
}
