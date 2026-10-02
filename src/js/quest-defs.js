// src/js/quest-defs.js
// ============================================================
// VULANET DAILY QUEST DEFINITIONS
// ============================================================
//
// Three tiers per day, one quest per tier. Pools are selected
// from deterministically so refreshing the page shows the same
// three quests for the same (user, local date).
//
// Quest shape:
//   id              stable string, used as the "quest" value
//                   written to daily_quests.<tier>_quest
//   title           display string
//   eventSource     the daily_progress column this quest reads
//   target          integer threshold; chest is complete when
//                   daily_progress[eventSource] >= target
//   disabled        true when the event source doesn't fire yet
//
// "disabled: true" quests are documented in the pool for future
// use but excluded from selection. They still appear here so that
// enabling them later is a one-line change.
//
// The eventSource values match the column names on
// daily_progress, so quest-engine.js can read them without an
// additional mapping:
//
//   minutes_learned            — cumulative lesson minutes today
//   xp_earned                  — cumulative lesson XP today
//   lessons_completed          — lesson count today
//   perfect_lessons            — perfect lessons today
//   mastered_lessons           — mastery attempts today
//   high_accuracy_lessons      — lessons scored >= 80% today
//   high_accuracy_90_lessons   — lessons scored >= 90% today
//   answer_streak_5_lessons    — lessons with >= 5 in a row correct
//   practice_lessons           — practice-hub lessons today
//   practice_minutes           — minutes spent in Practice today
//                                (COLUMN DOES NOT EXIST YET — add via
//                                a new migration when Practice ships)
//   timed_challenges           — timed-challenge completions today
//   reviewed_lessons           — lessons played as review today
//   chapter_reviews            — flag-node completions today
//
// ============================================================

export const QUEST_TIERS = Object.freeze({
  BRONZE: 'bronze',
  SILVER: 'silver',
  GOLD:   'gold'
});

// ─────────────────────────────────────────────────────────────
// FIRST-EVER DAY
// ─────────────────────────────────────────────────────────────
//
// Before the user's first completed lesson, the pools are
// bypassed entirely so a brand-new user always sees the same
// three approachable quests.
//
// IMPORTANT: these three quests are guaranteed ENABLED by
// design. selectDailyQuests() returns them unconditionally when
// isFirstDay is true, without checking their disabled flag. If
// any of them ever needs to be disabled, supply a fallback for
// the affected tier first — otherwise the caller would receive
// null for that tier.

export const FIRST_DAY_QUESTS = Object.freeze({
  bronze: Object.freeze({
    id: 'start-a-streak',
    title: 'Start a streak',
    eventSource: 'lessons_completed',
    target: 1,
    disabled: false
  }),
  silver: Object.freeze({
    id: 'score-80-in-3-first',
    title: 'Score 80% or higher in 3 lessons',
    eventSource: 'high_accuracy_lessons',
    target: 3,
    disabled: false
  }),
  gold: Object.freeze({
    id: 'complete-next-4-first',
    title: 'Complete your next 4 lessons',
    eventSource: 'lessons_completed',
    target: 4,
    disabled: false
  })
});

// ─────────────────────────────────────────────────────────────
// BRONZE POOL
// ─────────────────────────────────────────────────────────────

export const BRONZE_POOL = Object.freeze([
  Object.freeze({
    id: 'earn-25-xp',
    title: 'Earn 25 XP',
    eventSource: 'xp_earned',
    target: 25,
    disabled: false
  }),
  Object.freeze({
    id: 'earn-50-xp',
    title: 'Earn 50 XP',
    eventSource: 'xp_earned',
    target: 50,
    disabled: false
  }),
  Object.freeze({
    id: 'earn-100-xp',
    title: 'Earn 100 XP',
    eventSource: 'xp_earned',
    target: 100,
    disabled: false
  }),
  Object.freeze({
    id: 'complete-perfect-lesson',
    title: 'Complete a perfect lesson',
    eventSource: 'perfect_lessons',
    target: 1,
    disabled: false
  }),
  Object.freeze({
    id: 'review-a-lesson',
    title: 'Review a lesson',
    eventSource: 'reviewed_lessons',
    target: 1,
    // reviewed_lessons counter is only incremented by quiz-engine
    // (item 7). Until item 7 ships, the counter never moves and
    // this quest can't be completed. Re-enable then.
    disabled: true
  }),
  Object.freeze({
    id: 'complete-a-practice-lesson',
    title: 'Complete a Practice lesson',
    eventSource: 'practice_lessons',
    target: 1,
    // Practice mode doesn't exist yet (practice-hub.html fires
    // placeholder alerts). Re-enable when a real Practice event
    // source exists.
    disabled: true
  }),
  Object.freeze({
    id: 'master-a-lesson',
    title: 'Master a lesson',
    eventSource: 'mastered_lessons',
    target: 1,
    // mastered_lessons counter is only incremented by quiz-engine
    // (item 7). Re-enable then.
    disabled: true
  }),
  Object.freeze({
    id: 'complete-a-chapter-review',
    title: 'Complete a Chapter Review',
    eventSource: 'chapter_reviews',
    target: 1,
    // chapter_reviews counter is only incremented by quiz-engine
    // (item 7, flag-node completion). Re-enable then.
    disabled: true
  }),
  Object.freeze({
    id: 'complete-a-timed-challenge',
    title: 'Complete a timed challenge',
    eventSource: 'timed_challenges',
    target: 1,
    // Timed-challenge mode doesn't exist yet. Re-enable when the
    // mode and its event source are built.
    disabled: true
  }),
  Object.freeze({
    id: 'spend-5-minutes',
    title: 'Spend 5 minutes learning',
    eventSource: 'minutes_learned',
    target: 5,
    disabled: false
  })
]);

// ─────────────────────────────────────────────────────────────
// SILVER POOL
// ─────────────────────────────────────────────────────────────

export const SILVER_POOL = Object.freeze([
  Object.freeze({
    id: 'spend-10-minutes',
    title: 'Spend 10 minutes learning',
    eventSource: 'minutes_learned',
    target: 10,
    disabled: false
  }),
  Object.freeze({
    id: 'spend-15-minutes',
    title: 'Spend 15 minutes learning',
    eventSource: 'minutes_learned',
    target: 15,
    disabled: false
  }),
  Object.freeze({
    id: 'spend-5-minutes-in-practice',
    title: 'Spend 5 minutes in Practice',
    // NOTE: practice_minutes is a FUTURE column. It does not exist
    // on daily_progress yet. Add it via a migration when Practice
    // ships. Until then the quest stays disabled and the engine
    // never reads the column.
    eventSource: 'practice_minutes',
    target: 5,
    disabled: true
  }),
  Object.freeze({
    id: 'complete-3-lessons',
    title: 'Complete 3 lessons',
    eventSource: 'lessons_completed',
    target: 3,
    disabled: false
  }),
  Object.freeze({
    id: 'get-5-in-a-row-in-1-lesson',
    title: 'Get 5 in a row correct in a lesson',
    eventSource: 'answer_streak_5_lessons',
    target: 1,
    disabled: false
  }),
  Object.freeze({
    id: 'get-5-in-a-row-in-2-lessons',
    title: 'Get 5 in a row correct in 2 lessons',
    eventSource: 'answer_streak_5_lessons',
    target: 2,
    disabled: false
  }),
  Object.freeze({
    id: 'score-80-in-3',
    title: 'Score 80%+ in 3 lessons',
    eventSource: 'high_accuracy_lessons',
    target: 3,
    disabled: false
  }),
  Object.freeze({
    id: 'score-90-in-3',
    title: 'Score 90%+ in 3 lessons',
    eventSource: 'high_accuracy_90_lessons',
    target: 3,
    disabled: false
  }),
  Object.freeze({
    id: 'complete-2-perfect-lessons',
    title: 'Complete 2 perfect lessons',
    eventSource: 'perfect_lessons',
    target: 2,
    disabled: false
  }),
  Object.freeze({
    id: 'master-2-lessons',
    title: 'Master 2 lessons',
    eventSource: 'mastered_lessons',
    target: 2,
    // mastered_lessons counter is only incremented by quiz-engine
    // (item 7). Re-enable then.
    disabled: true
  })
]);

// ─────────────────────────────────────────────────────────────
// GOLD POOL
// ─────────────────────────────────────────────────────────────

export const GOLD_POOL = Object.freeze([
  Object.freeze({
    id: 'complete-5-lessons',
    title: 'Complete 5 lessons',
    eventSource: 'lessons_completed',
    target: 5,
    disabled: false
  }),
  Object.freeze({
    id: 'get-5-in-a-row-in-3-lessons',
    title: 'Get 5 in a row correct in 3 lessons',
    eventSource: 'answer_streak_5_lessons',
    target: 3,
    disabled: false
  }),
  Object.freeze({
    id: 'get-5-in-a-row-in-5-lessons',
    title: 'Get 5 in a row correct in 5 lessons',
    eventSource: 'answer_streak_5_lessons',
    target: 5,
    disabled: false
  }),
  Object.freeze({
    id: 'score-80-in-5',
    title: 'Score 80%+ in 5 lessons',
    eventSource: 'high_accuracy_lessons',
    target: 5,
    disabled: false
  }),
  Object.freeze({
    id: 'score-90-in-5',
    title: 'Score 90%+ in 5 lessons',
    eventSource: 'high_accuracy_90_lessons',
    target: 5,
    disabled: false
  }),
  Object.freeze({
    id: 'complete-3-perfect-lessons',
    title: 'Complete 3 perfect lessons',
    eventSource: 'perfect_lessons',
    target: 3,
    disabled: false
  }),
  Object.freeze({
    id: 'complete-4-perfect-lessons',
    title: 'Complete 4 perfect lessons',
    eventSource: 'perfect_lessons',
    target: 4,
    disabled: false
  }),
  Object.freeze({
    id: 'spend-10-minutes-in-practice',
    title: 'Spend 10 minutes in Practice',
    // NOTE: practice_minutes is a FUTURE column. See the Silver
    // pool note above.
    eventSource: 'practice_minutes',
    target: 10,
    disabled: true
  }),
  Object.freeze({
    id: 'master-3-lessons',
    title: 'Master 3 lessons',
    eventSource: 'mastered_lessons',
    target: 3,
    // mastered_lessons counter is only incremented by quiz-engine
    // (item 7). Re-enable then.
    disabled: true
  }),
  Object.freeze({
    id: 'complete-2-timed-challenges',
    title: 'Complete 2 timed challenges',
    eventSource: 'timed_challenges',
    target: 2,
    // Timed-challenge mode doesn't exist yet.
    disabled: true
  })
]);

// ─────────────────────────────────────────────────────────────
// POOL LOOKUP
// ─────────────────────────────────────────────────────────────

export function getPoolForTier(tier) {
  switch (tier) {
    case QUEST_TIERS.BRONZE: return BRONZE_POOL;
    case QUEST_TIERS.SILVER: return SILVER_POOL;
    case QUEST_TIERS.GOLD:   return GOLD_POOL;
    default: return [];
  }
}

// ─────────────────────────────────────────────────────────────
// STABLE SELECTION
// ─────────────────────────────────────────────────────────────
//
// Selection must be stable for the same (user, local date, tier).
// Refreshing the page, opening on another device, or reloading
// mid-day must show the same three quests.
//
// We use a deterministic hash of the seed string. It is NOT
// cryptographically random — it just needs to distribute evenly
// and be stable.

function hashSeed(str) {
  let h = 2166136261 >>> 0;             // FNV-1a 32-bit offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;    // FNV-1a 32-bit prime
  }
  return h;
}

function pickOne(pool, seedString) {
  if (!pool || pool.length === 0) return null;
  const enabled = pool.filter(q => !q.disabled);
  if (enabled.length === 0) return null;
  const idx = hashSeed(seedString) % enabled.length;
  return enabled[idx];
}

/**
 * Select the three quests for a given (user, local date, tier).
 *
 * @param {object} opts
 *   userId     — string, or 'guest' for logged-out users
 *   localDate  — YYYY-MM-DD in the user's local zone
 *   isFirstDay — true when the user has never completed a lesson
 *                on any day prior to (or including) today
 *
 * @returns {{
 *   bronze: { id, title, eventSource, target, disabled },
 *   silver: { id, title, eventSource, target, disabled },
 *   gold:   { id, title, eventSource, target, disabled }
 * }}
 */
export function selectDailyQuests({ userId, localDate, isFirstDay }) {
  if (isFirstDay) {
    // First-day quests are guaranteed enabled. See the comment on
    // FIRST_DAY_QUESTS above.
    return {
      bronze: FIRST_DAY_QUESTS.bronze,
      silver: FIRST_DAY_QUESTS.silver,
      gold:   FIRST_DAY_QUESTS.gold
    };
  }

  const seedBase = `${userId || 'guest'}|${localDate}`;

  return {
    bronze: pickOne(BRONZE_POOL, `${seedBase}|bronze`),
    silver: pickOne(SILVER_POOL, `${seedBase}|silver`),
    gold:   pickOne(GOLD_POOL,   `${seedBase}|gold`)
  };
}

/**
 * Find a pool entry by its id across every tier. Used by the
 * engine when it needs to reconstruct a quest's metadata from a
 * persisted daily_quests row.
 */
export function findQuestDefById(id) {
  const pools = [BRONZE_POOL, SILVER_POOL, GOLD_POOL];
  for (const pool of pools) {
    const found = pool.find(q => q.id === id);
    if (found) return found;
  }
  const firstDay = [FIRST_DAY_QUESTS.bronze, FIRST_DAY_QUESTS.silver, FIRST_DAY_QUESTS.gold];
  return firstDay.find(q => q.id === id) || null;
}

/**
 * Every quest id across every tier. Useful for validating
 * persisted rows or building admin tooling.
 */
export function getAllQuestIds() {
  const ids = new Set();
  [BRONZE_POOL, SILVER_POOL, GOLD_POOL].forEach(pool => {
    pool.forEach(q => ids.add(q.id));
  });
  ids.add(FIRST_DAY_QUESTS.bronze.id);
  ids.add(FIRST_DAY_QUESTS.silver.id);
  ids.add(FIRST_DAY_QUESTS.gold.id);
  return Array.from(ids);
}
