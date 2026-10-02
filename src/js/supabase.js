// src/js/supabase.js
// ============================================================
// VULANET SUPABASE CLIENT + DATA ACCESS LAYER
// ============================================================
//
// Design rules:
//   • Supabase is CANONICAL for logged-in users.
//   • localStorage is a write-through cache for fast paint.
//   • When NOT logged in, localStorage is canonical.
//   • Reads AND writes that touch the canonical store for a
//     logged-in user return null on failure. Callers must check
//     for null before assuming success.
//   • Never throw for expected errors.
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing Supabase environment variables. Make sure .env exists and VITE_* are set.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const LS_KEYS = {
  coins: 'coins',
  hearts: 'hearts',
  nextHeartAt: 'nextHeartAt',
  streakState: 'streakState',
  achievements: 'guest_achievements',
  records: 'guest_records',
  dailyGoal: 'guest_daily_goal',
  dailyProgress: 'guest_daily_progress',
  tempProgress: 'tempLessonProgress'
};

const COIN_STARTING_BALANCE = 500;
const HEART_MAX = 5;
const HEART_REGEN_MINUTES = 30;

function readJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* noop */ }
}

function readInt(key, fallback = 0) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function writeInt(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) { /* noop */ }
}

function clampInt(n, min, max) {
  n = Math.round(Number(n) || 0);
  return Math.max(min, Math.min(max, n));
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

// ============================================================
// 1. CLIENT + AUTH HELPERS
// ============================================================

export async function isLoggedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}

export async function getCurrentUserProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  return { user, profile };
}

export async function getCurrentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user ? user.id : null;
}

// ============================================================
// 2. PROFILES
// ============================================================

export async function getProfileById(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return null;
  return data;
}

export async function getProfileByUsername(username) {
  if (!username) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .ilike('username', username)
    .maybeSingle();
  if (error) return null;
  return data;
}

export async function updateProfile(updates) {
  const uid = await getCurrentUserId();
  if (!uid) return false;

  const ALLOWED = ['display_name', 'username', 'country', 'timezone', 'age', 'daily_goal_minutes'];
  const payload = {};
  for (const key of ALLOWED) {
    if (updates[key] !== undefined) payload[key] = updates[key];
  }
  if (Object.keys(payload).length === 0) return true;

  const { error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', uid);

  if (error) {
    console.error('updateProfile failed:', error);
    return false;
  }
  return true;
}

export async function isUsernameTaken(username, excludeUserId = null) {
  if (!username) return false;
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .ilike('username', username)
    .maybeSingle();
  if (error || !data) return false;
  if (excludeUserId && data.id === excludeUserId) return false;
  return true;
}

// ============================================================
// 3. COINS
// ============================================================

/**
 * Current coin balance.
 *
 *   Guest:      localStorage value (canonical for guests).
 *   Logged in:  user_stats.coins. Returns null on DB-read failure.
 */
export async function getCoins() {
  if (!(await isLoggedIn())) {
    return readInt(LS_KEYS.coins, COIN_STARTING_BALANCE);
  }
  const uid = await getCurrentUserId();
  if (!uid) return null;

  const { data, error } = await supabase
    .from('user_stats')
    .select('coins')
    .eq('user_id', uid)
    .maybeSingle();

  if (error || !data) {
    console.error('getCoins: DB read failed', error);
    return null;
  }
  writeInt(LS_KEYS.coins, data.coins);
  return data.coins;
}

/**
 * Set the coin balance.
 *
 * Returns the new balance on success. Returns null when the write
 * to Supabase fails for a logged-in user, so callers can gate
 * reward modals on the actual credit having happened.
 */
export async function setCoins(amount) {
  const next = Math.max(0, Math.round(Number(amount) || 0));
  writeInt(LS_KEYS.coins, next);

  if (!(await isLoggedIn())) return next;
  const uid = await getCurrentUserId();
  if (!uid) return null;

  const { error } = await supabase
    .from('user_stats')
    .update({ coins: next })
    .eq('user_id', uid);

  if (error) {
    console.error('setCoins failed:', error);
    return null;
  }
  return next;
}

/**
 * Add (or subtract) coins. Returns the new balance, or null on
 * failure (read or write).
 */
export async function incrementCoins(delta) {
  const current = await getCoins();
  if (current === null) {
    console.error('incrementCoins: cannot read current balance; skipping credit');
    return null;
  }
  return setCoins(current + delta);
}

// ============================================================
// 4. HEARTS
// ============================================================

export async function getHearts() {
  if (!(await isLoggedIn())) {
    return clampInt(readInt(LS_KEYS.hearts, HEART_MAX), 0, HEART_MAX);
  }
  const uid = await getCurrentUserId();
  if (!uid) return clampInt(readInt(LS_KEYS.hearts, HEART_MAX), 0, HEART_MAX);

  const { data, error } = await supabase
    .from('user_stats')
    .select('hearts')
    .eq('user_id', uid)
    .maybeSingle();

  if (error || !data) return clampInt(readInt(LS_KEYS.hearts, HEART_MAX), 0, HEART_MAX);
  writeInt(LS_KEYS.hearts, data.hearts);
  return data.hearts;
}

/**
 * Set hearts. Returns the new count, or null on DB write failure
 * for logged-in users.
 */
export async function setHearts(amount) {
  const next = clampInt(amount, 0, HEART_MAX);
  writeInt(LS_KEYS.hearts, next);

  if (!(await isLoggedIn())) return next;
  const uid = await getCurrentUserId();
  if (!uid) return null;

  const { error } = await supabase
    .from('user_stats')
    .update({ hearts: next })
    .eq('user_id', uid);

  if (error) {
    console.error('setHearts failed:', error);
    return null;
  }
  return next;
}

export async function getNextHeartAt() {
  if (!(await isLoggedIn())) {
    return readJSON(LS_KEYS.nextHeartAt, null);
  }
  const uid = await getCurrentUserId();
  if (!uid) return readJSON(LS_KEYS.nextHeartAt, null);

  const { data, error } = await supabase
    .from('user_stats')
    .select('next_heart_at')
    .eq('user_id', uid)
    .maybeSingle();

  if (error || !data || !data.next_heart_at) return null;
  const ms = new Date(data.next_heart_at).getTime();
  writeJSON(LS_KEYS.nextHeartAt, ms);
  return ms;
}

/**
 * Set the next-heart timestamp. Pass null to clear.
 *
 * Returns:
 *   - null when clearing (that's the clear value, not a failure)
 *   - ms on success
 *   - null on DB write failure for a logged-in user (ambiguous
 *     with clear; callers who need to distinguish should re-read
 *     getNextHeartAt())
 */
export async function setNextHeartAt(ms) {
  if (ms === null || ms === undefined) {
    try { localStorage.removeItem(LS_KEYS.nextHeartAt); } catch (e) { /* noop */ }
    if (await isLoggedIn()) {
      const uid = await getCurrentUserId();
      if (uid) {
        await supabase.from('user_stats').update({ next_heart_at: null }).eq('user_id', uid);
      }
    }
    return null;
  }

  writeJSON(LS_KEYS.nextHeartAt, ms);

  if (!(await isLoggedIn())) return ms;
  const uid = await getCurrentUserId();
  if (!uid) return null;

  const { error } = await supabase
    .from('user_stats')
    .update({ next_heart_at: new Date(ms).toISOString() })
    .eq('user_id', uid);

  if (error) {
    console.error('setNextHeartAt failed:', error);
    return null;
  }
  return ms;
}

// ============================================================
// 5. STREAK
// ============================================================

export async function getStreakState() {
  if (!(await isLoggedIn())) {
    const state = readJSON(LS_KEYS.streakState, null);
    if (!state) {
      return { currentStreak: 0, longestStreak: 0, lastLessonDate: null };
    }
    return {
      currentStreak: state.currentStreak || 0,
      longestStreak: state.longestStreak || state.currentStreak || 0,
      lastLessonDate: state.lastLessonDate || null
    };
  }

  const uid = await getCurrentUserId();
  if (!uid) {
    return { currentStreak: 0, longestStreak: 0, lastLessonDate: null };
  }

  const { data, error } = await supabase
    .from('user_stats')
    .select('current_streak, longest_streak, last_lesson_date')
    .eq('user_id', uid)
    .maybeSingle();

  if (error || !data) {
    return { currentStreak: 0, longestStreak: 0, lastLessonDate: null };
  }
  return {
    currentStreak: data.current_streak || 0,
    longestStreak: data.longest_streak || 0,
    lastLessonDate: data.last_lesson_date || null
  };
}

export async function setStreakState(updates) {
  const current = await getStreakState();
  const next = {
    currentStreak: updates.currentStreak !== undefined ? Math.max(0, Math.round(updates.currentStreak)) : current.currentStreak,
    longestStreak: updates.longestStreak !== undefined ? Math.max(0, Math.round(updates.longestStreak)) : current.longestStreak,
    lastLessonDate: updates.lastLessonDate !== undefined ? updates.lastLessonDate : current.lastLessonDate
  };
  if (next.currentStreak > next.longestStreak) next.longestStreak = next.currentStreak;

  const localState = readJSON(LS_KEYS.streakState, {}) || {};
  localState.currentStreak = next.currentStreak;
  localState.longestStreak = next.longestStreak;
  localState.lastLessonDate = next.lastLessonDate;
  writeJSON(LS_KEYS.streakState, localState);

  if (!(await isLoggedIn())) return next;
  const uid = await getCurrentUserId();
  if (!uid) return next;

  const { error } = await supabase
    .from('user_stats')
    .update({
      current_streak: next.currentStreak,
      longest_streak: next.longestStreak,
      last_lesson_date: next.lastLessonDate
    })
    .eq('user_id', uid);

  if (error) console.error('setStreakState failed:', error);
  return next;
}

// ============================================================
// 6. LESSON PROGRESS
// ============================================================

export async function getLessonProgress(courseId, lessonId) {
  if (!(await isLoggedIn())) return null;
  const uid = await getCurrentUserId();
  if (!uid) return null;

  const { data, error } = await supabase
    .from('lesson_progress')
    .select('*')
    .eq('user_id', uid)
    .eq('course_id', courseId)
    .eq('lesson_id', lessonId)
    .maybeSingle();

  if (error) return null;
  return data;
}

export async function getAllLessonProgress() {
  if (!(await isLoggedIn())) return [];
  const uid = await getCurrentUserId();
  if (!uid) return [];

  const { data, error } = await supabase
    .from('lesson_progress')
    .select('*')
    .eq('user_id', uid);

  if (error || !data) return [];
  return data;
}

export async function recordLessonCompletion(stats) {
  if (!(await isLoggedIn())) return { ok: false, reason: 'guest' };
  const uid = await getCurrentUserId();
  if (!uid) return { ok: false, reason: 'guest' };

  const {
    courseId, lessonId, mastered = false, sublessonIndex = null
  } = stats;

  const nowISO = new Date().toISOString();
  const row = {
    user_id: uid,
    course_id: courseId,
    lesson_id: lessonId,
    status: 'completed',
    last_attempt_at: nowISO,
    updated_at: nowISO
  };

  if (mastered) row.mastered = true;

  if (sublessonIndex !== null) {
    const existing = await getLessonProgress(courseId, lessonId);
    const completed = new Set(existing?.completed_sublessons || []);
    completed.add(sublessonIndex);
    row.completed_sublessons = Array.from(completed).sort((a, b) => a - b);

    if (mastered) {
      const masteredSet = new Set(existing?.mastered_sublessons || []);
      masteredSet.add(sublessonIndex);
      row.mastered_sublessons = Array.from(masteredSet).sort((a, b) => a - b);
    }
  }

  const { error } = await supabase
    .from('lesson_progress')
    .upsert(row, { onConflict: 'user_id,course_id,lesson_id' });

  if (error) {
    console.error('recordLessonCompletion failed:', error);
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}

export async function markLessonMastered(courseId, lessonId) {
  if (!(await isLoggedIn())) return false;
  const uid = await getCurrentUserId();
  if (!uid) return false;

  const { error } = await supabase
    .from('lesson_progress')
    .upsert({
      user_id: uid,
      course_id: courseId,
      lesson_id: lessonId,
      status: 'completed',
      mastered: true,
      last_attempt_at: new Date().toISOString()
    }, { onConflict: 'user_id,course_id,lesson_id' });

  if (error) {
    console.error('markLessonMastered failed:', error);
    return false;
  }
  return true;
}

export async function recordReview(courseId, lessonId) {
  if (!(await isLoggedIn())) return false;
  const uid = await getCurrentUserId();
  if (!uid) return false;

  const { error } = await supabase
    .from('lesson_progress')
    .upsert({
      user_id: uid,
      course_id: courseId,
      lesson_id: lessonId,
      last_attempt_at: new Date().toISOString()
    }, { onConflict: 'user_id,course_id,lesson_id', ignoreDuplicates: false });

  if (error) {
    console.error('recordReview failed:', error);
    return false;
  }
  return true;
}

// ============================================================
// 7. DAILY PROGRESS
// ============================================================

const DAILY_PROGRESS_COLUMNS = [
  'minutes_learned', 'xp_earned',
  'lessons_completed', 'perfect_lessons', 'mastered_lessons',
  'high_accuracy_lessons', 'high_accuracy_90_lessons',
  'answer_streak_5_lessons',
  'practice_lessons', 'timed_challenges',
  'reviewed_lessons', 'chapter_reviews'
];

export async function getDailyProgress(date) {
  const progressDate = date || utcToday();
  if (!(await isLoggedIn())) {
    const guest = readJSON(LS_KEYS.dailyProgress, {}) || {};
    return guest[progressDate] || null;
  }
  const uid = await getCurrentUserId();
  if (!uid) return null;

  const { data, error } = await supabase
    .from('daily_progress')
    .select('*')
    .eq('user_id', uid)
    .eq('progress_date', progressDate)
    .maybeSingle();

  if (error) return null;
  return data;
}

export async function updateDailyProgress(date, deltas) {
  const progressDate = date || utcToday();

  const existing = (await getDailyProgress(progressDate)) || {};
  const merged = {
    minutes_learned: 0,
    xp_earned: 0,
    lessons_completed: 0,
    perfect_lessons: 0,
    mastered_lessons: 0,
    high_accuracy_lessons: 0,
    high_accuracy_90_lessons: 0,
    answer_streak_5_lessons: 0,
    practice_lessons: 0,
    timed_challenges: 0,
    reviewed_lessons: 0,
    chapter_reviews: 0,
    daily_goal_reward_claimed: false
  };

  for (const col of DAILY_PROGRESS_COLUMNS) {
    merged[col] = (existing[col] || 0) + (deltas[col] || 0);
  }
  if (deltas.daily_goal_reward_claimed !== undefined) {
    merged.daily_goal_reward_claimed = !!deltas.daily_goal_reward_claimed;
  } else if (existing.daily_goal_reward_claimed) {
    merged.daily_goal_reward_claimed = true;
  }

  const mergedRow = { progress_date: progressDate, ...merged };

  if (!(await isLoggedIn())) {
    const guest = readJSON(LS_KEYS.dailyProgress, {}) || {};
    guest[progressDate] = mergedRow;
    writeJSON(LS_KEYS.dailyProgress, guest);
    return { ok: true, row: mergedRow, error: null };
  }

  const uid = await getCurrentUserId();
  if (!uid) {
    return { ok: false, row: mergedRow, error: 'no-user-id' };
  }

  const { data, error } = await supabase
    .from('daily_progress')
    .upsert({
      user_id: uid,
      progress_date: progressDate,
      ...merged
    }, { onConflict: 'user_id,progress_date' })
    .select()
    .maybeSingle();

  if (error) {
    console.error('updateDailyProgress failed:', error);
    return { ok: false, row: mergedRow, error: error.message };
  }
  return { ok: true, row: data || mergedRow, error: null };
}

export async function getTodayCounters(localDate) {
  return await getDailyProgress(localDate || utcToday());
}

// ============================================================
// 8. DAILY GOAL
// ============================================================

const DAILY_GOAL_OPTIONS = [5, 10, 15, 20];
const DAILY_GOAL_DEFAULT = 5;

export async function getDailyGoal() {
  if (!(await isLoggedIn())) {
    const cached = readInt(LS_KEYS.dailyGoal, 0);
    if (cached > 0) return cached;

    const onboarding = readJSON('onboardingData', null);
    if (onboarding && DAILY_GOAL_OPTIONS.includes(onboarding.dailyGoal)) {
      writeInt(LS_KEYS.dailyGoal, onboarding.dailyGoal);
      return onboarding.dailyGoal;
    }
    return DAILY_GOAL_DEFAULT;
  }

  const uid = await getCurrentUserId();
  if (!uid) return DAILY_GOAL_DEFAULT;

  const { data, error } = await supabase
    .from('profiles')
    .select('daily_goal_minutes')
    .eq('id', uid)
    .maybeSingle();

  if (error || !data || !data.daily_goal_minutes) return DAILY_GOAL_DEFAULT;
  return data.daily_goal_minutes;
}

export async function setDailyGoal(minutes) {
  const safe = DAILY_GOAL_OPTIONS.includes(minutes) ? minutes : DAILY_GOAL_DEFAULT;

  if (!(await isLoggedIn())) {
    writeInt(LS_KEYS.dailyGoal, safe);
    return safe;
  }
  const uid = await getCurrentUserId();
  if (!uid) return safe;

  const { error } = await supabase
    .from('profiles')
    .update({ daily_goal_minutes: safe })
    .eq('id', uid);

  if (error) console.error('setDailyGoal failed:', error);
  return safe;
}

// ============================================================
// 9. ACHIEVEMENTS
// ============================================================

export async function getUserAchievements() {
  if (!(await isLoggedIn())) {
    return readJSON(LS_KEYS.achievements, []) || [];
  }
  const uid = await getCurrentUserId();
  if (!uid) return [];

  const { data, error } = await supabase
    .from('user_achievements')
    .select('achievement_key, level, earned_at, claimed')
    .eq('user_id', uid);

  if (error || !data) return [];
  return data;
}

export async function getAchievement(key) {
  if (!(await isLoggedIn())) {
    const all = readJSON(LS_KEYS.achievements, []) || [];
    return all.find(a => a.achievement_key === key) || null;
  }
  const uid = await getCurrentUserId();
  if (!uid) return null;

  const { data, error } = await supabase
    .from('user_achievements')
    .select('achievement_key, level, earned_at, claimed')
    .eq('user_id', uid)
    .eq('achievement_key', key)
    .maybeSingle();

  if (error) return null;
  return data;
}

export async function setAchievementLevel(key, level) {
  const nowISO = new Date().toISOString();

  if (!(await isLoggedIn())) {
    const all = readJSON(LS_KEYS.achievements, []) || [];
    const existing = all.find(a => a.achievement_key === key);
    if (existing) {
      if (level > existing.level) existing.level = level;
    } else {
      all.push({ achievement_key: key, level, earned_at: nowISO, claimed: false });
    }
    writeJSON(LS_KEYS.achievements, all);
    return all.find(a => a.achievement_key === key).level;
  }

  const uid = await getCurrentUserId();
  if (!uid) return level;

  const existing = await getAchievement(key);
  const nextLevel = existing ? Math.max(existing.level || 0, level) : level;

  const { error } = await supabase
    .from('user_achievements')
    .upsert({
      user_id: uid,
      achievement_key: key,
      level: nextLevel,
      earned_at: existing?.earned_at || nowISO
    }, { onConflict: 'user_id,achievement_key' });

  if (error) {
    console.error('setAchievementLevel failed:', error);
    return existing ? existing.level : 0;
  }
  return nextLevel;
}

export async function markAchievementClaimed(key) {
  if (!(await isLoggedIn())) {
    const all = readJSON(LS_KEYS.achievements, []) || [];
    const found = all.find(a => a.achievement_key === key);
    if (found) found.claimed = true;
    writeJSON(LS_KEYS.achievements, all);
    return true;
  }
  const uid = await getCurrentUserId();
  if (!uid) return false;

  const { error } = await supabase
    .from('user_achievements')
    .update({ claimed: true })
    .eq('user_id', uid)
    .eq('achievement_key', key);

  if (error) {
    console.error('markAchievementClaimed failed:', error);
    return false;
  }
  return true;
}

// ============================================================
// 10. PERSONAL RECORDS
// ============================================================

export async function getUserRecords() {
  if (!(await isLoggedIn())) {
    return readJSON(LS_KEYS.records, {}) || {};
  }
  const uid = await getCurrentUserId();
  if (!uid) return {};

  const { data, error } = await supabase
    .from('user_records')
    .select('*')
    .eq('user_id', uid)
    .maybeSingle();

  if (error || !data) return {};
  return data;
}

export async function updateRecord(key, value, direction = null) {
  const ALLOWED = ['longest_streak', 'highest_league', 'perfect_lessons_in_day', 'most_xp_in_day'];
  if (!ALLOWED.includes(key)) {
    console.warn(`updateRecord: unknown key "${key}"`);
    return false;
  }

  const current = await getUserRecords();
  const cur = current[key];

  let dir = direction;
  if (!dir) {
    if (typeof value === 'number') dir = 'max';
    else dir = 'set';
  }

  let next = value;
  if (dir === 'max' && typeof cur === 'number' && cur >= value) return false;
  if (dir === 'min' && typeof cur === 'number' && cur <= value) return false;
  if (dir === 'set' && cur === value) return false;

  if (!(await isLoggedIn())) {
    const all = readJSON(LS_KEYS.records, {}) || {};
    all[key] = next;
    all.updated_at = new Date().toISOString();
    writeJSON(LS_KEYS.records, all);
    return true;
  }

  const uid = await getCurrentUserId();
  if (!uid) return false;

  const { error } = await supabase
    .from('user_records')
    .update({ [key]: next, updated_at: new Date().toISOString() })
    .eq('user_id', uid);

  if (error) {
    console.error('updateRecord failed:', error);
    return false;
  }
  return true;
}

// ============================================================
// 11. DAILY QUESTS
// ============================================================

export async function getDailyQuests(date) {
  const questDate = date || utcToday();
  if (!(await isLoggedIn())) return null;
  const uid = await getCurrentUserId();
  if (!uid) return null;

  const { data, error } = await supabase
    .from('daily_quests')
    .select('*')
    .eq('user_id', uid)
    .eq('quest_date', questDate)
    .maybeSingle();

  if (error) return null;
  return data;
}

export async function getOrCreateDailyQuests(date, defs) {
  if (!(await isLoggedIn())) return null;
  const uid = await getCurrentUserId();
  if (!uid) return null;

  const existing = await getDailyQuests(date);
  if (existing) return existing;

  const row = {
    user_id: uid,
    quest_date: date,
    bronze_quest: defs.bronze?.quest || null,
    bronze_total: defs.bronze?.total || 1,
    bronze_current: 0,
    bronze_claimed: false,
    silver_quest: defs.silver?.quest || null,
    silver_total: defs.silver?.total || 1,
    silver_current: 0,
    silver_claimed: false,
    gold_quest: defs.gold?.quest || null,
    gold_total: defs.gold?.total || 1,
    gold_current: 0,
    gold_claimed: false
  };

  const { data, error } = await supabase
    .from('daily_quests')
    .insert(row)
    .select()
    .maybeSingle();

  if (error) {
    console.error('getOrCreateDailyQuests insert failed:', error);
    return null;
  }
  return data;
}

export async function updateQuestProgress(date, chestId, current) {
  const valid = ['bronze', 'silver', 'gold'];
  if (!valid.includes(chestId)) return false;
  if (!(await isLoggedIn())) return false;

  const uid = await getCurrentUserId();
  if (!uid) return false;

  const col = `${chestId}_current`;
  const { error } = await supabase
    .from('daily_quests')
    .update({ [col]: current })
    .eq('user_id', uid)
    .eq('quest_date', date);

  if (error) {
    console.error('updateQuestProgress failed:', error);
    return false;
  }
  return true;
}

export async function claimQuestReward(date, chestId) {
  const valid = ['bronze', 'silver', 'gold'];
  if (!valid.includes(chestId)) return false;
  if (!(await isLoggedIn())) return false;

  const uid = await getCurrentUserId();
  if (!uid) return false;

  const row = await getDailyQuests(date);
  if (!row) return false;

  const currentCol = `${chestId}_current`;
  const totalCol   = `${chestId}_total`;
  const claimedCol = `${chestId}_claimed`;

  if (row[claimedCol]) return false;
  if ((row[currentCol] || 0) < (row[totalCol] || 1)) return false;

  const { error } = await supabase
    .from('daily_quests')
    .update({ [claimedCol]: true })
    .eq('user_id', uid)
    .eq('quest_date', date);

  if (error) {
    console.error('claimQuestReward failed:', error);
    return false;
  }
  return true;
}

/**
 * Flip a previously-claimed chest back to unclaimed. Used when the
 * mark succeeded but the subsequent coin credit failed, so the
 * user gets another chance on the next load.
 *
 * Idempotent: no-op if the row doesn't exist or is already
 * unclaimed.
 */
export async function unclaimQuestReward(date, chestId) {
  const valid = ['bronze', 'silver', 'gold'];
  if (!valid.includes(chestId)) return false;
  if (!(await isLoggedIn())) return false;

  const uid = await getCurrentUserId();
  if (!uid) return false;

  const claimedCol = `${chestId}_claimed`;
  const { error } = await supabase
    .from('daily_quests')
    .update({ [claimedCol]: false })
    .eq('user_id', uid)
    .eq('quest_date', date);

  if (error) {
    console.error('unclaimQuestReward failed:', error);
    return false;
  }
  return true;
}

// ============================================================
// 12. FOLLOWS
// ============================================================

export async function isFollowing(userId) {
  if (!userId) return false;
  if (!(await isLoggedIn())) return false;
  const uid = await getCurrentUserId();
  if (!uid || uid === userId) return false;

  const { data, error } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', uid)
    .eq('following_id', userId)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

export async function followUser(userId) {
  if (!userId) return false;
  if (!(await isLoggedIn())) return false;
  const uid = await getCurrentUserId();
  if (!uid || uid === userId) return false;

  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: uid, following_id: userId });

  if (error && error.code !== '23505') {
    console.error('followUser failed:', error);
    return false;
  }
  return true;
}

export async function unfollowUser(userId) {
  if (!userId) return false;
  if (!(await isLoggedIn())) return false;
  const uid = await getCurrentUserId();
  if (!uid) return false;

  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', uid)
    .eq('following_id', userId);

  if (error) {
    console.error('unfollowUser failed:', error);
    return false;
  }
  return true;
}

export async function getFollowing(userId) {
  const id = userId || (await getCurrentUserId());
  if (!id) return [];

  const { data, error } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', id);

  if (error || !data) return [];
  return data.map(r => r.following_id);
}

export async function getFollowers(userId) {
  const id = userId || (await getCurrentUserId());
  if (!id) return [];

  const { data, error } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('following_id', id);

  if (error || !data) return [];
  return data.map(r => r.follower_id);
}

export async function getMutualFollowers(userId) {
  const id = userId || (await getCurrentUserId());
  if (!id) return [];

  const following = new Set(await getFollowing(id));
  const followers = await getFollowers(id);
  return followers.filter(fid => following.has(fid));
}

// ============================================================
// 13. FRIEND SUGGESTIONS
// ============================================================

export async function getFriendSuggestions(limit = 5) {
  if (!(await isLoggedIn())) return [];
  const uid = await getCurrentUserId();
  if (!uid) return [];

  const [following, dismissed] = await Promise.all([
    getFollowing(uid),
    (async () => {
      const { data, error } = await supabase
        .from('quest_suggestion_dismissals')
        .select('dismissed_user_id')
        .eq('user_id', uid);
      if (error || !data) return [];
      return data.map(r => r.dismissed_user_id);
    })()
  ]);

  const excluded = new Set([uid, ...following, ...dismissed]);

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, country')
    .not('username', 'is', null)
    .limit(50);

  if (error || !data) return [];

  const filtered = data.filter(p => !excluded.has(p.id));
  return filtered.slice(0, limit);
}

export async function dismissSuggestion(dismissedUserId) {
  if (!dismissedUserId) return false;
  if (!(await isLoggedIn())) return false;
  const uid = await getCurrentUserId();
  if (!uid || uid === dismissedUserId) return false;

  const { error } = await supabase
    .from('quest_suggestion_dismissals')
    .insert({ user_id: uid, dismissed_user_id: dismissedUserId });

  if (error && error.code !== '23505') {
    console.error('dismissSuggestion failed:', error);
    return false;
  }
  return true;
}

// ============================================================
// 14. TEMP LESSON PROGRESS
// ============================================================

export function saveTempProgress(courseId, lessonId, stats) {
  const temp = {
    courseId,
    lessonId,
    completedAt: Date.now(),
    stats: { ...stats }
  };
  sessionStorage.setItem(LS_KEYS.tempProgress, JSON.stringify(temp));
}

export function getTempProgress() {
  const data = sessionStorage.getItem(LS_KEYS.tempProgress);
  return data ? JSON.parse(data) : null;
}

export function clearTempProgress() {
  sessionStorage.removeItem(LS_KEYS.tempProgress);
}

// ============================================================
// 15. GUEST → SUPABASE MIGRATION
// ============================================================

export async function syncGuestDataToSupabase() {
  const migrated = [];
  const skipped = [];

  if (!(await isLoggedIn())) {
    return { migrated, skipped: ['not-logged-in'] };
  }
  const uid = await getCurrentUserId();
  if (!uid) return { migrated, skipped: ['no-user-id'] };

  try {
    const guestCoins = readInt(LS_KEYS.coins, 0);
    if (guestCoins > 0) {
      const { data } = await supabase
        .from('user_stats')
        .select('coins')
        .eq('user_id', uid)
        .maybeSingle();
      const current = data?.coins ?? 0;
      if (guestCoins > current) {
        await supabase.from('user_stats').update({ coins: guestCoins }).eq('user_id', uid);
        migrated.push('coins');
      } else {
        skipped.push('coins');
      }
    }
  } catch (e) { skipped.push('coins'); }

  try {
    const guestHearts = readInt(LS_KEYS.hearts, -1);
    if (guestHearts >= 0) {
      const { data } = await supabase
        .from('user_stats')
        .select('hearts')
        .eq('user_id', uid)
        .maybeSingle();
      const current = data?.hearts ?? HEART_MAX;
      if (guestHearts > current) {
        await supabase.from('user_stats').update({ hearts: guestHearts }).eq('user_id', uid);
        migrated.push('hearts');
      } else {
        skipped.push('hearts');
      }
    }
  } catch (e) { skipped.push('hearts'); }

  try {
    const local = readJSON(LS_KEYS.streakState, null);
    if (local && local.currentStreak > 0) {
      const { data } = await supabase
        .from('user_stats')
        .select('current_streak, longest_streak, last_lesson_date')
        .eq('user_id', uid)
        .maybeSingle();
      const currentStreak = data?.current_streak ?? 0;
      const longestStreak = data?.longest_streak ?? 0;
      const lastLessonDate = data?.last_lesson_date ?? null;

      const merged = {
        current_streak: Math.max(currentStreak, local.currentStreak || 0),
        longest_streak: Math.max(longestStreak, local.longestStreak || local.currentStreak || 0),
        last_lesson_date: lastLessonDate || local.lastLessonDate || null
      };
      await supabase.from('user_stats').update(merged).eq('user_id', uid);
      migrated.push('streak');
    }
  } catch (e) { skipped.push('streak'); }

  try {
    const guestGoal = readInt(LS_KEYS.dailyGoal, 0);
    if (guestGoal > 0 && DAILY_GOAL_OPTIONS.includes(guestGoal)) {
      const { data } = await supabase
        .from('profiles')
        .select('daily_goal_minutes')
        .eq('id', uid)
        .maybeSingle();
      if (!data || data.daily_goal_minutes === DAILY_GOAL_DEFAULT) {
        await supabase.from('profiles').update({ daily_goal_minutes: guestGoal }).eq('id', uid);
        migrated.push('daily_goal');
      } else {
        skipped.push('daily_goal');
      }
    }
  } catch (e) { skipped.push('daily_goal'); }

  try {
    const guestAchievements = readJSON(LS_KEYS.achievements, []) || [];
    if (guestAchievements.length > 0) {
      const current = await getUserAchievements();
      const byKey = {};
      current.forEach(a => { byKey[a.achievement_key] = a; });

      for (const g of guestAchievements) {
        const cur = byKey[g.achievement_key];
        const level = cur ? Math.max(cur.level || 0, g.level || 0) : (g.level || 0);
        if (level > 0) {
          await supabase
            .from('user_achievements')
            .upsert({
              user_id: uid,
              achievement_key: g.achievement_key,
              level,
              earned_at: cur?.earned_at || g.earned_at || new Date().toISOString(),
              claimed: cur?.claimed || g.claimed || false
            }, { onConflict: 'user_id,achievement_key' });
        }
      }
      migrated.push('achievements');
    }
  } catch (e) { skipped.push('achievements'); }

  try {
    const guestRecords = readJSON(LS_KEYS.records, {}) || {};
    if (Object.keys(guestRecords).length > 0) {
      const current = await getUserRecords();
      const merge = {};
      for (const key of ['longest_streak', 'perfect_lessons_in_day', 'most_xp_in_day']) {
        const g = Number(guestRecords[key]) || 0;
        const c = Number(current[key]) || 0;
        if (g > c) merge[key] = g;
      }
      if (guestRecords.highest_league && !current.highest_league) {
        merge.highest_league = guestRecords.highest_league;
      }
      if (Object.keys(merge).length > 0) {
        await supabase.from('user_records').update(merge).eq('user_id', uid);
        migrated.push('records');
      }
    }
  } catch (e) { skipped.push('records'); }

  try {
    localStorage.removeItem(LS_KEYS.achievements);
    localStorage.removeItem(LS_KEYS.records);
    localStorage.removeItem(LS_KEYS.dailyGoal);
    localStorage.removeItem(LS_KEYS.dailyProgress);
  } catch (e) { /* noop */ }

  return { migrated, skipped };
}
