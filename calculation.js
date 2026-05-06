// ============================================================
// calculation.js
// Core calculation logic for meal costs and shared expenses
// ============================================================

export const DEFAULT_MEAL_PERCENTAGES = Object.freeze({
  morning: 0,
  lunch: 100,
  dinner: 60
});

/**
 * Calculate base meal rate: totalBazar / raw meal count across all users
 * @param {Array} allMeals  - Array of meal docs for the month
 * @param {Array} allBazar  - Array of bazar docs for the month
 * @returns {number} mealRate
 */
export function calcMealRate(allMeals, allBazar) {
  const totalMeals = calcMealBreakdown(allMeals).total;
  const totalBazar = allBazar.reduce((sum, b) => sum + (b.amount || 0), 0);
  if (totalMeals === 0) return 0;
  return totalBazar / totalMeals;
}

export function getMealPercentages(monthCosts = {}) {
  const percentages = {
    morning: parsePercent(monthCosts.morningMealPercent, DEFAULT_MEAL_PERCENTAGES.morning),
    lunch: parsePercent(monthCosts.lunchMealPercent, DEFAULT_MEAL_PERCENTAGES.lunch),
    dinner: parsePercent(monthCosts.dinnerMealPercent, DEFAULT_MEAL_PERCENTAGES.dinner)
  };
  return percentages;
}

/**
 * Calculate meal breakdown by type.
 * Firestore meal docs store morning, lunch, dinner, and totalMeal separately.
 * @param {Array} meals - Meal docs
 * @returns {{morning: number, lunch: number, dinner: number, total: number}}
 */
export function calcMealBreakdown(meals) {
  return meals.reduce((sum, meal) => {
    const morning = meal.morning || 0;
    const lunch = meal.lunch || 0;
    const dinner = meal.dinner || 0;
    const total = Number.isFinite(meal.totalMeal) ? meal.totalMeal : morning + lunch + dinner;

    return {
      morning: sum.morning + morning,
      lunch: sum.lunch + lunch,
      dinner: sum.dinner + dinner,
      total: sum.total + total
    };
  }, { morning: 0, lunch: 0, dinner: 0, total: 0 });
}

export function calcMealTypeRates(mealBreakdown, totalBazar, mealPercentages = getMealPercentages()) {
  const baseRate = mealBreakdown.total === 0 ? 0 : totalBazar / mealBreakdown.total;
  const morningRate = baseRate * mealPercentages.morning / 100;
  const dinnerRate = baseRate * mealPercentages.dinner / 100;
  const lunchPercent = mealPercentages.lunch + Math.max(0, 100 - mealPercentages.dinner);
  const lunchRate = baseRate * lunchPercent / 100;

  return {
    base: baseRate,
    morning: morningRate,
    lunch: lunchRate,
    dinner: dinnerRate,
    percentages: {
      morning: ratePercent(morningRate, baseRate),
      lunch: lunchPercent,
      dinner: ratePercent(dinnerRate, baseRate)
    }
  };
}

export function calcMealCost(mealBreakdown, mealRates) {
  return (mealBreakdown.morning * mealRates.morning) +
    (mealBreakdown.lunch * mealRates.lunch) +
    (mealBreakdown.dinner * mealRates.dinner);
}

/**
 * Calculate total meals for a single user
 * @param {Array} userMeals - Meal docs for one user
 * @returns {number}
 */
export function calcUserTotalMeals(userMeals) {
  return calcMealBreakdown(userMeals).total;
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
 * @param {number} params.userMealCost    - User's calculated type-rate meal cost
 * @param {number} params.khalaPerPerson
 * @param {number} params.gasPerPerson
 * @param {number} params.electricityPerPerson
 * @param {number} params.wifiPerPerson
 * @param {number} params.bariVara        - User's bari vara (individual or shared)
 * @param {number} params.userBazar       - User's total bazar (deducted if prepaid)
 * @returns {object} breakdown + totalPayable
 */
export function calcUserPayable({
  userMealCost,
  khalaPerPerson,
  gasPerPerson,
  electricityPerPerson,
  wifiPerPerson,
  bariVara,
  userBazar
}) {
  const mealCost = Number.isFinite(userMealCost) ? userMealCost : 0;
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
 * @param {object} monthCosts  - { khalaTotal, gasTotal, electricityTotal, wifiTotal, morningMealPercent, lunchMealPercent, dinnerMealPercent }
 * @param {Array}  rentSplits  - rentSplits docs for the month (locked bari vara per user)
 * @returns {Array} rows with full calculation per user
 */
export function buildCalculationTable(users, allMeals, allBazar, monthCosts, rentSplits) {
  const userCount = users.length;
  const mealPercentages = getMealPercentages(monthCosts);

  const khalaPerPerson = calcPerPerson(monthCosts.khalaTotal || 0, userCount);
  const gasPerPerson = calcPerPerson(monthCosts.gasTotal || 0, userCount);
  const electricityPerPerson = calcPerPerson(monthCosts.electricityTotal || 0, userCount);
  const wifiPerPerson = calcPerPerson(monthCosts.wifiTotal || 0, userCount);

  // Total bazar across all users for reference
  const totalBazar = allBazar.reduce((s, b) => s + (b.amount || 0), 0);
  const mealBreakdown = calcMealBreakdown(allMeals);
  const mealRates = calcMealTypeRates(mealBreakdown, totalBazar, mealPercentages);
  const mealRate = mealRates.base;
  const totalMeals = mealBreakdown.total;

  const rows = users.map((user) => {
    const userMeals = allMeals.filter((m) => m.userId === user.uid);
    const userBazar = allBazar.filter((b) => b.userId === user.uid);

    const userMealBreakdown = calcMealBreakdown(userMeals);
    const userTotalMeals = userMealBreakdown.total;
    const userMealCost = calcMealCost(userMealBreakdown, mealRates);
    const userTotalBazar = calcUserTotalBazar(userBazar);

    // Bari vara is entered person-wise by admin. Unsaved rows start at 0.
    const rentSplit = rentSplits.find((r) => r.userId === user.uid);
    const bariVara = rentSplit ? rentSplit.amount : 0;

    const calc = calcUserPayable({
      userMealCost,
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
      morningMeals: round2(userMealBreakdown.morning),
      lunchMeals: round2(userMealBreakdown.lunch),
      dinnerMeals: round2(userMealBreakdown.dinner),
      totalBazar: round2(userTotalBazar),
      mealRate: round2(mealRate),
      dinnerRate: round2(mealRates.dinner),
      lunchRate: round2(mealRates.lunch),
      locked: rentSplit?.locked || false,
      ...calc
    };
  });
  const totalBariVara = rows.reduce((sum, row) => sum + (row.bariVara || 0), 0);

  return {
    rows,
    summary: {
      totalMeals,
      totalMorningMeals: round2(mealBreakdown.morning),
      totalLunchMeals: round2(mealBreakdown.lunch),
      totalDinnerMeals: round2(mealBreakdown.dinner),
      mealPercentages: {
        morning: round2(mealRates.percentages.morning),
        lunch: round2(mealRates.percentages.lunch),
        dinner: round2(mealRates.percentages.dinner)
      },
      configuredMealPercentages: mealPercentages,
      totalBazar: round2(totalBazar),
      totalBariVara: round2(totalBariVara),
      mealRates: {
        morning: round2(mealRates.morning),
        lunch: round2(mealRates.lunch),
        dinner: round2(mealRates.dinner)
      },
      mealRate: round2(mealRate),
      userCount
    }
  };
}

// Helper: round to 2 decimal places
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function parsePercent(value, fallback) {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function ratePercent(rate, baseRate) {
  if (baseRate === 0) return 0;
  return rate / baseRate * 100;
}
