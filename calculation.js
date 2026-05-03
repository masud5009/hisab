// ============================================================
// calculation.js
// Core calculation logic for meal costs and shared expenses
// ============================================================

/**
 * Calculate meal rate: totalBazar / totalMeals across all users
 * @param {Array} allMeals  - Array of meal docs for the month
 * @param {Array} allBazar  - Array of bazar docs for the month
 * @returns {number} mealRate
 */
export function calcMealRate(allMeals, allBazar) {
  const totalMeals = allMeals.reduce((sum, m) => sum + (m.totalMeal || 0), 0);
  const totalBazar = allBazar.reduce((sum, b) => sum + (b.amount || 0), 0);
  if (totalMeals === 0) return 0;
  return totalBazar / totalMeals;
}

/**
 * Calculate total meals for a single user
 * @param {Array} userMeals - Meal docs for one user
 * @returns {number}
 */
export function calcUserTotalMeals(userMeals) {
  return userMeals.reduce((sum, m) => sum + (m.totalMeal || 0), 0);
}

/**
 * Calculate total bazar for a single user
 * @param {Array} userBazar - Bazar docs for one user
 * @returns {number}
 */
export function calcUserTotalBazar(userBazar) {
  return userBazar.reduce((sum, b) => sum + (b.amount || 0), 0);
}

/**
 * Calculate per-person shared cost
 * @param {number} total      - Total cost (e.g. khalaTotal)
 * @param {number} userCount  - Number of active users
 * @returns {number}
 */
export function calcPerPerson(total, userCount) {
  if (userCount === 0) return 0;
  return total / userCount;
}

/**
 * Calculate total payable for one user
 * @param {object} params
 * @param {number} params.userMeals       - User's total meals
 * @param {number} params.mealRate        - Calculated meal rate
 * @param {number} params.khalaPerPerson
 * @param {number} params.gasPerPerson
 * @param {number} params.electricityPerPerson
 * @param {number} params.wifiPerPerson
 * @param {number} params.bariVara        - User's bari vara (individual or shared)
 * @param {number} params.userBazar       - User's total bazar (deducted if prepaid)
 * @returns {object} breakdown + totalPayable
 */
export function calcUserPayable({
  userMeals,
  mealRate,
  khalaPerPerson,
  gasPerPerson,
  electricityPerPerson,
  wifiPerPerson,
  bariVara,
  userBazar
}) {
  const mealCost = userMeals * mealRate;
  const totalPayable =
    mealCost + khalaPerPerson + gasPerPerson + electricityPerPerson + wifiPerPerson + bariVara;

  return {
    mealCost: round2(mealCost),
    khalaPerPerson: round2(khalaPerPerson),
    gasPerPerson: round2(gasPerPerson),
    electricityPerPerson: round2(electricityPerPerson),
    wifiPerPerson: round2(wifiPerPerson),
    bariVara: round2(bariVara),
    totalPayable: round2(totalPayable)
  };
}

/**
 * Build complete calculation table for all users in a month
 * @param {Array}  users       - User profile docs (active in this month)
 * @param {Array}  allMeals    - All meal docs for the month
 * @param {Array}  allBazar    - All bazar docs for the month
 * @param {object} monthCosts  - { khalaTotal, gasTotal, electricityTotal, wifiTotal, bariVaraTotal }
 * @param {Array}  rentSplits  - rentSplits docs for the month (locked bari vara per user)
 * @returns {Array} rows with full calculation per user
 */
export function buildCalculationTable(users, allMeals, allBazar, monthCosts, rentSplits) {
  const userCount = users.length;
  const mealRate = calcMealRate(allMeals, allBazar);

  const khalaPerPerson = calcPerPerson(monthCosts.khalaTotal || 0, userCount);
  const gasPerPerson = calcPerPerson(monthCosts.gasTotal || 0, userCount);
  const electricityPerPerson = calcPerPerson(monthCosts.electricityTotal || 0, userCount);
  const wifiPerPerson = calcPerPerson(monthCosts.wifiTotal || 0, userCount);

  // Total bazar across all users for reference
  const totalBazar = allBazar.reduce((s, b) => s + (b.amount || 0), 0);
  const totalMeals = allMeals.reduce((s, m) => s + (m.totalMeal || 0), 0);

  const rows = users.map((user) => {
    const userMeals = allMeals.filter((m) => m.userId === user.uid);
    const userBazar = allBazar.filter((b) => b.userId === user.uid);

    const userTotalMeals = calcUserTotalMeals(userMeals);
    const userTotalBazar = calcUserTotalBazar(userBazar);

    // Bari vara: check if user has a locked rent split, else use equal share
    const rentSplit = rentSplits.find((r) => r.userId === user.uid);
    const bariVara = rentSplit ? rentSplit.amount : calcPerPerson(monthCosts.bariVaraTotal || 0, userCount);

    const calc = calcUserPayable({
      userMeals: userTotalMeals,
      mealRate,
      khalaPerPerson,
      gasPerPerson,
      electricityPerPerson,
      wifiPerPerson,
      bariVara,
      userBazar: userTotalBazar
    });

    return {
      uid: user.uid,
      name: user.name,
      username: user.username,
      totalMeals: userTotalMeals,
      totalBazar: round2(userTotalBazar),
      mealRate: round2(mealRate),
      locked: rentSplit?.locked || false,
      ...calc
    };
  });

  return {
    rows,
    summary: {
      totalMeals,
      totalBazar: round2(totalBazar),
      mealRate: round2(mealRate),
      userCount
    }
  };
}

// Helper: round to 2 decimal places
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
