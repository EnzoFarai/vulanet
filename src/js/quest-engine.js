// src/js/quest-engine.js
// ============================================================
// VULANET QUEST ENGINE
// ============================================================
//
// The single writer of daily_progress and daily_quests rows.
// quests.html, daily-quest.html, and the quiz pipeline all call
// into this module.
//
// Design rules (see spec §4, §7, §8, §9):
//
//   • One call per lesson carries every counter that changed.
//   • Every counter lives on today's daily_progress row, keyed by
//     the user's LOCAL date.
//   • Quest selection is stable for (user, local date, tier).
//   • The updateDailyProgress { ok, row, error } contract is
//     enforced throughout.
//   • Coins are never granted inside the engine. Claim functions
//     mark the row as claimed and return the amount; the caller
//     opens coins-reward.html which credits through supabase.js.
//   • Claim ordering (spec §9): mark → credit → modal.
//     unmarkPendingQuestsClaimed reverses the mark if the credit
//     step fails, so the reward is retried on the next load.
//     unmarkDailyGoalClaimed is the same pattern for the
//     daily-goal reward.
//   • getPendingQuests() spans ALL dates, not just today.
//   • Achievement counters (user_stats columns) are bumped here
//     because this module is the single writer for lesson-scoped
//     progress and quest chest claims. Bumps go through the
//     increment_user_stat RPC added by migration 0008 so
//     concurrent calls do not lose updates. A lost bump only
//     delays the corresponding achievement — it never corrupts
//     progress — so failures are logged and swallowed.
//
// ─────────────────────────────────────────────────────────────
// CALLER CONTRACT
// ─────────────────────────────────────────────────────────────
//
// recordLessonCompletion(stats) expects exactly this shape:
//
//   courseId          string
//   lessonId          string
//   timeSeconds       number   — wall-clock lesson duration, SECONDS
//   xpEarned          number   — final XP from lesson-complete.html
//   accuracy          number   — RATIO IN [0, 1], NOT a percentage
//   perfectLesson     boolean
//   hadAnswerStreak5  boolean
//   isReview          boolean
//   isMastery         boolean
//   isChapterReview   boolean
//   localDate         string?  — defaults to engine timezone
//   localHour         number?  — defaults to engine timezone
//
// ─────────────────────────────────────────────────────────────
// GUEST MODE
// ─────────────────────────────────────────────────────────────
//
// Guests receive NO daily quests. Reads return empty; claim
// functions are no-ops.
//
// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────
//   initQuestEngine()
//   clearQuestEngineContext()
//   getTodayCounters(localDate?)
//   getTodayQuests(localDate?)
//   getQuestDisplayState(localDate?)
//   getPendingQuests()
//   recordLessonCompletion(stats)
//   claimQuestChest(tier, localDate?)
//   markPendingQuestsClaimed(pendingList)
//   unmarkPendingQuestsClaimed(pendingList)
//   getDailyGoalProgress(localDate?)
//   checkDailyGoalReward(localDate?)
//   markDailyGoalClaimed(localDate?)
//   unmarkDailyGoalClaimed(localDate?)
//   getDailyGoalValue()
//
// ============================================================

import {
  supabase,
  getCurrentUserProfile,
  getStreakState,
  getDailyProgress,
  updateDailyProgress,
  getDailyQuests,
  getOrCreateDailyQuests,
  updateQuestProgress,
  claimQuestReward,
  unclaimQuestReward,
  incrementAchievementCounter
} from './supabase.js';

import {
  getLocalDateString,
  getLocalHour
} from './date-utils.js';

import {
  selectDailyQuests,
  findQuestDefById,
  QUEST_TIERS
} from './quest-defs.js';

import {
  getDailyGoalProgress as dgGetProgress,
  shouldFireDailyGoalReward as dgShouldFire,
  markDailyGoalRewardClaimed as dgMarkClaimed,
  getDailyGoal
} from './daily-goal.js';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const TIERS = [QUEST_TIERS.BRONZE, QUEST_TIERS.SILVER, QUEST_TIERS.GOLD];

const CHEST_REWARD = Object.freeze({
  [QUEST_TIERS.BRONZE]: 50,
  [QUEST_TIERS.SILVER]: 75,
  [QUEST_TIERS.GOLD]:   100
});

// ─────────────────────────────────────────────────────────────
// Module context
// ─────────────────────────────────────────────────────────────

let _context = null;
let _initPromise = null;

function ensureContext() {
  if (!_context) {
    throw new Error(
      'quest-engine: initQuestEngine() must be awaited before any other call'
    );
  }
}

export async function initQuestEngine() {
  if (_context) return _context;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    let userId = 'guest';
    let timezone = 'UTC';
    let isLoggedIn = false;

    try {
      const profile = await getCurrentUserProfile();
      if (profile && profile.user) {
        userId = profile.user.id;
        isLoggedIn = true;
        timezone = (profile.profile && profile.profile.timezone) || 'UTC';
      } else {
        timezone = localStorage.getItem('userTimezone') || 'UTC';
      }
    } catch (e) {
      console.warn('quest-engine: could not load user profile', e);
      timezone = localStorage.getItem('userTimezone') || 'UTC';
    }

    _context = { userId, timezone, isLoggedIn };
    return _context;
  })().catch((err) => {
    _initPromise = null;
    throw err;
  });

  return _initPromise;
}

export function clearQuestEngineContext() {
  _context = null;
  _initPromise = null;
}

// ─────────────────────────────────────────────────────────────
// Achievement counter bumps
// ─────────────────────────────────────────────────────────────
//
// Lifetime achievement counters live on user_stats. They are
// distinct from the daily_progress counters (which reset each
// local day). Each bump is best-effort: a failure logs but never
// blocks the caller, because a lost increment only delays the
// corresponding achievement.
//
// The increment_user_stat RPC performs the arithmetic atomically
// on the DB side; we never read-modify-write the counter in JS.

async function bumpLessonAchievementCounters(stats, localHour) {
  const bumps = [];

  const xpEarned = Math.max(0, Math.round(stats.xpEarned || 0));
  if (xpEarned > 0) {
    bumps.push(incrementAchievementCounter('total_xp', xpEarned));
  }

  if (stats.perfectLesson) {
    bumps.push(incrementAchievementCounter('perfect_lessons', 1));
  }

  if (stats.isMastery) {
    bumps.push(incrementAchievementCounter('master_challenges_completed', 1));
  }

  // Night Owl: 00:00 – 02:59 local. Early Bird: 06:00 – 08:59 local.
  // The hour is the wall-clock hour in the user's timezone, already
  // resolved upstream. If localHour is unavailable, skip both.
  if (typeof localHour === 'number' && Number.isFinite(localHour)) {
    if (localHour >= 0 && localHour < 3) {
      bumps.push(incrementAchievementCounter('night_owl_lessons', 1));
    } else if (localHour >= 6 && localHour < 9) {
      bumps.push(incrementAchievementCounter('early_bird_lessons', 1));
    }
  }

  if (bumps.length === 0) return;

  try {
    // Promise.all is safe here: incrementAchievementCounter never
    // throws — it logs and returns null on failure. If the
    // underlying RPC is missing (migration not applied) every bump
    // resolves to null and we simply move on.
    await Promise.all(bumps);
  } catch (e) {
    console.error('quest-engine: lesson counter batch failed', e);
  }
}

async function bumpQuestsCompleted(delta) {
  if (!Number.isFinite(delta) || delta === 0) return;
  try {
    await incrementAchievementCounter('quests_completed', delta);
  } catch (e) {
    console.error('quest-engine: quests_completed bump failed', e);
  }
}

// ─────────────────────────────────────────────────────────────
// Internal: first-day detection
// ─────────────────────────────────────────────────────────────

async function detectIsFirstDay(today) {
  try {
    const { longestStreak, lastLessonDate } = await getStreakState();
    if (!longestStreak || longestStreak === 0) return true;
    if (longestStreak === 1 && lastLessonDate === today) return true;
    return false;
  } catch (e) {
    return false;
  }
}

async function getSelectedDefs(localDate) {
  ensureContext();
  const isFirstDay = await detectIsFirstDay(localDate);
  return selectDailyQuests({
    userId: _context.userId,
    localDate,
    isFirstDay
  });
}

function resolveDefsFromRow(row) {
  return {
    bronze: row.bronze_quest ? findQuestDefById(row.bronze_quest) : null,
    silver: row.silver_quest ? findQuestDefById(row.silver_quest) : null,
    gold:   row.gold_quest   ? findQuestDefById(row.gold_quest)   : null
  };
}

// ─────────────────────────────────────────────────────────────
// Public reads
// ─────────────────────────────────────────────────────────────

export async function getTodayCounters(localDate) {
  ensureContext();
  const date = localDate || getLocalDateString(_context.timezone);
  return await getDailyProgress(date);
}

export async function getTodayQuests(localDate) {
  ensureContext();
  if (!_context.isLoggedIn) return null;

  const date = localDate || getLocalDateString(_context.timezone);

  const defs = await getSelectedDefs(date);
  const defsForSupabase = {
    bronze: defs.bronze ? { quest: defs.bronze.id, total: defs.bronze.target } : null,
    silver: defs.silver ? { quest: defs.silver.id, total: defs.silver.target } : null,
    gold:   defs.gold   ? { quest: defs.gold.id,   total: defs.gold.target }   : null
  };
  const row = await getOrCreateDailyQuests(date, defsForSupabase);
  if (!row) return null;

  const resolved = resolveDefsFromRow(row);
  return buildQuestView(row, resolved);
}

export async function getQuestDisplayState(localDate) {
  ensureContext();
  if (!_context.isLoggedIn) return null;

  const date = localDate || getLocalDateString(_context.timezone);
  const row = await getDailyQuests(date);
  if (!row) return null;

  const resolved = resolveDefsFromRow(row);
  return buildQuestView(row, resolved);
}

function buildQuestView(row, defs) {
  const tiers = TIERS.map(tier => {
    const def = defs[tier];
    const current = row[`${tier}_current`] || 0;
    const total   = row[`${tier}_total`]   || (def ? def.target : 1);
    const claimed = !!row[`${tier}_claimed`];
    const complete = current >= total;

    return {
      tier,
      id: def ? def.id : row[`${tier}_quest`],
      title: def ? def.title : null,
      eventSource: def ? def.eventSource : null,
      disabled: def ? !!def.disabled : true,
      current,
      total,
      claimed,
      complete,
      reward: CHEST_REWARD[tier]
    };
  });

  return {
    date: row.quest_date,
    row,
    defs,
    tiers
  };
}

// ─────────────────────────────────────────────────────────────
// Pending quests (spans all dates)
// ─────────────────────────────────────────────────────────────

export async function getPendingQuests() {
  ensureContext();
  if (!_context.isLoggedIn) return [];

  const { data, error } = await supabase
    .from('daily_quests')
    .select(
      'quest_date,' +
      'bronze_quest, bronze_current, bronze_total, bronze_claimed,' +
      'silver_quest, silver_current, silver_total, silver_claimed,' +
      'gold_quest, gold_current, gold_total, gold_claimed'
    )
    .eq('user_id', _context.userId)
    .order('quest_date', { ascending: true });

  if (error || !data) {
    if (error) console.error('getPendingQuests: fetch failed', error);
    return [];
  }

  const pending = [];
  for (const row of data) {
    for (const tier of TIERS) {
      const quest   = row[`${tier}_quest`];
      if (!quest) continue;
      const current = row[`${tier}_current`] || 0;
      const total   = row[`${tier}_total`] || 1;
      const claimed = !!row[`${tier}_claimed`];
      if (claimed) continue;
      if (current < total) continue;
      pending.push({
        date: row.quest_date,
        tier,
        amount: CHEST_REWARD[tier]
      });
    }
  }
  return pending;
}

// ─────────────────────────────────────────────────────────────
// Public: lesson completion event
// ─────────────────────────────────────────────────────────────

export async function recordLessonCompletion(stats) {
  ensureContext();

  const localDate = stats.localDate || getLocalDateString(_context.timezone);
  const localHour = stats.localHour !== undefined
    ? stats.localHour
    : getLocalHour(_context.timezone);

  const deltas = computeDeltas(stats);

  const writeResult = await updateDailyProgress(localDate, deltas);
  if (!writeResult.ok) {
    console.error(
      'quest-engine: daily_progress write failed',
      writeResult.error
    );
    return {
      ok: false,
      error: writeResult.error,
      counters: writeResult.row,
      quests: null,
      dailyGoal: null
    };
  }

  // Bump lifetime achievement counters. Failure here does not fail
  // the overall lesson completion — those counters are decorative
  // for the achievement system and will simply re-fire later.
  try {
    await bumpLessonAchievementCounters(stats, localHour);
  } catch (e) {
    console.error('quest-engine: bumpLessonAchievementCounters threw', e);
  }

  let quests = null;
  try {
    quests = await evaluateAndPersistQuests(localDate, writeResult.row);
  } catch (e) {
    console.error('quest-engine: quest evaluation failed', e);
  }

  let dailyGoal = null;
  try {
    dailyGoal = await dgShouldFire(localDate);
  } catch (e) {
    console.error('quest-engine: daily-goal check failed', e);
  }

  return {
    ok: true,
    error: null,
    counters: writeResult.row,
    quests,
    dailyGoal
  };
}

function computeDeltas(stats) {
  const deltas = {
    lessons_completed: 1,
    xp_earned: Math.max(0, Math.round(stats.xpEarned || 0)),
    minutes_learned: secondsToMinutes(stats.timeSeconds)
  };

  const acc = Number(stats.accuracy);
  if (Number.isFinite(acc)) {
    if (acc >= 0.8) deltas.high_accuracy_lessons = 1;
    if (acc >= 0.9) deltas.high_accuracy_90_lessons = 1;
  }

  if (stats.perfectLesson)      deltas.perfect_lessons = 1;
  if (stats.isMastery)          deltas.mastered_lessons = 1;
  if (stats.hadAnswerStreak5)   deltas.answer_streak_5_lessons = 1;
  if (stats.isReview)           deltas.reviewed_lessons = 1;
  if (stats.isChapterReview)    deltas.chapter_reviews = 1;

  return deltas;
}

function secondsToMinutes(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds / 60);
}

async function evaluateAndPersistQuests(localDate, counters) {
  if (!_context.isLoggedIn) return null;

  const view = await getTodayQuests(localDate);
  if (!view) return null;

  const updates = [];

  for (const tierInfo of view.tiers) {
    if (!tierInfo.id) continue;
    const def = view.defs[tierInfo.tier];
    if (!def || def.disabled) continue;

    const raw = Number(counters[def.eventSource]) || 0;
    const clamped = Math.min(raw, def.target);

    if (clamped !== tierInfo.current) {
      updates.push({ tier: tierInfo.tier, value: clamped });
    }
  }

  if (updates.length === 0) return view;

  for (const u of updates) {
    const ok = await updateQuestProgress(localDate, u.tier, u.value);
    if (!ok) {
      console.warn(
        `quest-engine: failed to update ${u.tier} progress to ${u.value}`
      );
    }
  }

  return await getTodayQuests(localDate);
}

// ─────────────────────────────────────────────────────────────
// Public: claim (single, today)
// ─────────────────────────────────────────────────────────────

export async function claimQuestChest(tier, localDate) {
  ensureContext();
  if (!TIERS.includes(tier)) {
    return { ok: false, amount: 0, tier, error: 'invalid-tier' };
  }
  if (!_context.isLoggedIn) {
    return { ok: false, amount: 0, tier, error: 'guest' };
  }

  const date = localDate || getLocalDateString(_context.timezone);

  const view = await getTodayQuests(date);
  if (!view) {
    return { ok: false, amount: 0, tier, error: 'no-quests' };
  }
  const tierInfo = view.tiers.find(t => t.tier === tier);
  if (!tierInfo) {
    return { ok: false, amount: 0, tier, error: 'invalid-tier' };
  }
  if (!tierInfo.complete) {
    return { ok: false, amount: 0, tier, error: 'not-complete' };
  }
  if (tierInfo.claimed) {
    return { ok: false, amount: 0, tier, error: 'already-claimed' };
  }

  const marked = await claimQuestReward(date, tier);
  if (!marked) {
    return { ok: false, amount: 0, tier, error: 'claim-failed' };
  }

  // Bump the lifetime quests_completed counter. Symmetric with
  // the unmark path in unmarkPendingQuestsClaimed, so a credit
  // failure does not leave a phantom +1.
  await bumpQuestsCompleted(1);

  return {
    ok: true,
    amount: CHEST_REWARD[tier],
    tier,
    error: null
  };
}

// ─────────────────────────────────────────────────────────────
// Public: batch mark/unmark
// ─────────────────────────────────────────────────────────────

/**
 * Mark a batch of pending quests as claimed.
 * Returns an array of { date, tier, ok } describing each attempt.
 *
 * Also bumps the lifetime quests_completed counter by the number
 * of successful marks in a single RPC call (rather than one call
 * per chest).
 */
export async function markPendingQuestsClaimed(pendingList) {
  ensureContext();
  if (!_context.isLoggedIn) return [];
  if (!Array.isArray(pendingList) || pendingList.length === 0) return [];

  const results = [];
  let successCount = 0;
  for (const p of pendingList) {
    const ok = await claimQuestReward(p.date, p.tier);
    results.push({ date: p.date, tier: p.tier, ok: !!ok });
    if (ok) successCount += 1;
  }

  if (successCount > 0) {
    await bumpQuestsCompleted(successCount);
  }

  return results;
}

/**
 * Reverse a batch mark. Used when the mark succeeded but the
 * subsequent credit failed — flips the _claimed flags back to
 * false so the reward is retried on the next load.
 *
 * Callers should pass only the rows that were successfully marked.
 * Returns an array of { date, tier, ok } describing each attempt.
 *
 * Symmetrically decrements quests_completed by the number of
 * successful unmarks, so the counter mirrors the DB state.
 */
export async function unmarkPendingQuestsClaimed(pendingList) {
  ensureContext();
  if (!_context.isLoggedIn) return [];
  if (!Array.isArray(pendingList) || pendingList.length === 0) return [];

  const results = [];
  let successCount = 0;
  for (const p of pendingList) {
    const ok = await unclaimQuestReward(p.date, p.tier);
    results.push({ date: p.date, tier: p.tier, ok: !!ok });
    if (ok) successCount += 1;
  }

  if (successCount > 0) {
    await bumpQuestsCompleted(-successCount);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// Public: daily-goal pass-throughs
// ─────────────────────────────────────────────────────────────

export async function getDailyGoalProgress(localDate) {
  ensureContext();
  const date = localDate || getLocalDateString(_context.timezone);
  return await dgGetProgress(date);
}

export async function checkDailyGoalReward(localDate) {
  ensureContext();
  const date = localDate || getLocalDateString(_context.timezone);
  return await dgShouldFire(date);
}

export async function markDailyGoalClaimed(localDate) {
  ensureContext();
  const date = localDate || getLocalDateString(_context.timezone);
  return await dgMarkClaimed(date);
}

/**
 * Reverse the daily-goal claim flag. Companion to
 * markDailyGoalClaimed, used by the quiz pipeline when the mark
 * succeeded but the subsequent coin credit failed.
 *
 * Flips daily_progress.daily_goal_reward_claimed back to false for
 * the given local date, so the reward is retried on the next
 * lesson completion.
 *
 * Returns TRUE only when Supabase confirmed the flag is now false.
 * Guests have no daily-goal reward, so this is a no-op that
 * returns false.
 *
 * Mirrors the mark→credit→unmark-on-failure pattern used for
 * quest chests (see unmarkPendingQuestsClaimed).
 */
export async function unmarkDailyGoalClaimed(localDate) {
  ensureContext();
  if (!_context.isLoggedIn) return false;

  const date = localDate || getLocalDateString(_context.timezone);

  const result = await updateDailyProgress(date, {
    daily_goal_reward_claimed: false
  });

  if (!result || !result.ok) {
    console.error(
      'unmarkDailyGoalClaimed failed:',
      result ? result.error : 'no result'
    );
    return false;
  }

  // Confirm the flag actually came back false.
  return !!(result.row && result.row.daily_goal_reward_claimed === false);
}

export async function getDailyGoalValue() {
  return await getDailyGoal();
}
