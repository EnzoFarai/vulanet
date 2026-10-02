// src/js/daily-goal.js
// ============================================================
// VULANET DAILY-GOAL HELPER
// ============================================================
//
// Single source of truth for reading, writing, and evaluating
// the user's daily learning goal (5 / 10 / 15 / 20 minutes).
//
// Design rules (see spec §4.4):
//
//   • The goal itself is stored canonically in
//     profiles.daily_goal_minutes for logged-in users, and in
//     localStorage.guest_daily_goal for guests. Both paths go
//     through supabase.js's getDailyGoal / setDailyGoal — this
//     file does not talk to the DB directly.
//
//   • "Today's accumulated learning time" comes from
//     daily_progress.minutes_learned, keyed by the user's LOCAL
//     date (which the caller must supply — see date-utils.js's
//     getLocalDateString).
//
//   • The daily-goal reward fires AT MOST ONCE per local day,
//     gated by daily_progress.daily_goal_reward_claimed. The
//     flag is flipped BEFORE coins are granted, so a mid-modal
//     refresh cannot double-credit.
//
//   • Failure mode: if flipping the flag fails, we DO NOT grant
//     coins. The caller checks the boolean return value.
//
//   • Reward tiers (spec §4.4.6):
//       > goal and <= 2*goal      →  50 coins
//       > 2*goal and <= 3*goal    → 100 coins
//       > 3*goal                  → 150 coins
//
// Exports:
//   DAILY_GOAL_OPTIONS                — [5, 10, 15, 20]
//   DAILY_GOAL_DEFAULT                — 5
//   getDailyGoal()                    — minutes (number)
//   setDailyGoal(minutes)             — persists + returns stored value
//   calculateDailyGoalReward(goal, minutesLearned)  — pure
//   getDailyGoalProgress(localDate)   — combined read
//   shouldFireDailyGoalReward(localDate)
//   markDailyGoalRewardClaimed(localDate)
//   clearDailyGoalCache()             — call on login/logout
// ============================================================

import {
  getDailyGoal as sbGetDailyGoal,
  setDailyGoal as sbSetDailyGoal,
  getDailyProgress,
  updateDailyProgress
} from './supabase.js';

export const DAILY_GOAL_OPTIONS = [5, 10, 15, 20];
export const DAILY_GOAL_DEFAULT = 5;

// ─────────────────────────────────────────────────────────────
// Page-load cache
// ─────────────────────────────────────────────────────────────
//
// Supabase.js's getDailyGoal makes three round trips per call
// (isLoggedIn + getCurrentUserId + profiles read). The quest
// engine will call this after every lesson, so we cache the
// value for the lifetime of the page load. setDailyGoal and the
// explicit clear function update the cache.
//
// No cross-tab invalidation. A login or logout already triggers
// a full page navigation, so the cache is safe for its scope.
// ─────────────────────────────────────────────────────────────
let _goalCache = null;

// ─────────────────────────────────────────────────────────────
// GOAL READ / WRITE
// ─────────────────────────────────────────────────────────────

/**
 * The user's daily goal in minutes. Falls back to the default
 * (5) when unset. Never returns 0 or a non-canonical value.
 */
export async function getDailyGoal() {
  if (_goalCache !== null) return _goalCache;

  const raw = await sbGetDailyGoal();
  const safe = DAILY_GOAL_OPTIONS.includes(raw) ? raw : DAILY_GOAL_DEFAULT;
  _goalCache = safe;
  return safe;
}

/**
 * Persist the daily goal. Non-canonical values are coerced to the
 * default. Returns the value that was actually stored.
 */
export async function setDailyGoal(minutes) {
  const safe = DAILY_GOAL_OPTIONS.includes(minutes) ? minutes : DAILY_GOAL_DEFAULT;
  const stored = await sbSetDailyGoal(safe);
  _goalCache = stored;
  return stored;
}

/**
 * Invalidate the page-load cache. Call after login / logout /
 * account switch, or after any operation that could have changed
 * the goal outside this module (e.g. onboarding-completion
 * handlers that write profiles.daily_goal_minutes directly).
 */
export function clearDailyGoalCache() {
  _goalCache = null;
}

// ─────────────────────────────────────────────────────────────
// REWARD CALCULATION — pure
// ─────────────────────────────────────────────────────────────

/**
 * Compute the coin reward for the given goal and accumulated
 * minutes today. Returns 0 when the goal has not been exceeded.
 *
 * @param {number} goalMinutes
 * @param {number} minutesLearned
 * @returns {number} 0 | 50 | 100 | 150
 */
export function calculateDailyGoalReward(goalMinutes, minutesLearned) {
  if (!goalMinutes || goalMinutes <= 0) return 0;
  if (!Number.isFinite(minutesLearned) || minutesLearned <= 0) return 0;
  if (minutesLearned <= goalMinutes) return 0;

  if (minutesLearned <= goalMinutes * 2) return 50;
  if (minutesLearned <= goalMinutes * 3) return 100;
  return 150;
}

// ─────────────────────────────────────────────────────────────
// COMBINED READ
// ─────────────────────────────────────────────────────────────

/**
 * Everything a caller needs to render the daily-goal UI in one
 * round trip.
 *
 * @param {string} localDate  YYYY-MM-DD in the user's local zone
 * @returns {Promise<{
 *   goal: number,
 *   minutesLearned: number,
 *   minutesRemaining: number,
 *   percentComplete: number,
 *   exceeded: boolean,
 *   rewardAmount: number,
 *   rewardAlreadyClaimed: boolean
 * }>}
 */
export async function getDailyGoalProgress(localDate) {
  const [goal, progress] = await Promise.all([
    getDailyGoal(),
    getDailyProgress(localDate)
  ]);

  const minutesLearned = (progress && Number(progress.minutes_learned)) || 0;
  const rewardAlreadyClaimed = !!(progress && progress.daily_goal_reward_claimed);

  const exceeded = minutesLearned > goal;
  const minutesRemaining = Math.max(0, goal - minutesLearned);
  const percentComplete = goal > 0
    ? Math.min(100, Math.round((minutesLearned / goal) * 100))
    : 0;

  const rewardAmount = rewardAlreadyClaimed
    ? 0
    : calculateDailyGoalReward(goal, minutesLearned);

  return {
    goal,
    minutesLearned,
    minutesRemaining,
    percentComplete,
    exceeded,
    rewardAmount,
    rewardAlreadyClaimed
  };
}

// ─────────────────────────────────────────────────────────────
// REWARD GATING
// ─────────────────────────────────────────────────────────────

/**
 * Decide whether the daily-goal coin reward should fire right now.
 *
 * @param {string} localDate  YYYY-MM-DD in the user's local zone
 * @returns {Promise<{ should: boolean, amount: number, reason: string }>}
 *
 * reason values:
 *   'crossed-threshold'  — should fire, amount > 0
 *   'already-claimed'    — already fired today
 *   'not-yet'            — goal not exceeded yet
 *   'no-goal'            — goal unavailable / zero
 */
export async function shouldFireDailyGoalReward(localDate) {
  const progress = await getDailyGoalProgress(localDate);

  if (progress.goal <= 0) {
    return { should: false, amount: 0, reason: 'no-goal' };
  }
  if (progress.rewardAlreadyClaimed) {
    return { should: false, amount: 0, reason: 'already-claimed' };
  }
  if (!progress.exceeded) {
    return { should: false, amount: 0, reason: 'not-yet' };
  }

  const amount = calculateDailyGoalReward(progress.goal, progress.minutesLearned);
  if (amount <= 0) {
    return { should: false, amount: 0, reason: 'not-yet' };
  }
  return { should: true, amount, reason: 'crossed-threshold' };
}

/**
 * Flip the daily-goal reward flag for the given local date.
 *
 * This does NOT grant coins. Granting is the caller's job (they
 * open the coin modal, which credits through supabase.js's
 * incrementCoins).
 *
 * Returns TRUE only when Supabase (or guest localStorage) actually
 * persisted the flag. On failure, returns FALSE — the caller MUST
 * NOT grant coins, otherwise the reward could fire twice.
 */
export async function markDailyGoalRewardClaimed(localDate) {
  const result = await updateDailyProgress(localDate, {
    daily_goal_reward_claimed: true
  });

  // Fail-closed: skip the reward when the write didn't stick.
  if (!result || !result.ok) {
    console.error(
      'markDailyGoalRewardClaimed failed:',
      result ? result.error : 'no result'
    );
    return false;
  }

  // Belt-and-braces: confirm the flag came back from the DB.
  return !!(result.row && result.row.daily_goal_reward_claimed);
}
