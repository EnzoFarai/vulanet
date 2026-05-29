// src/js/supabase.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Replace with your Supabase project URL and anon key
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========== USER & SESSION ==========
export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = '/';
}

// ========== USER PROFILE (registration-completion data) ==========
export async function saveUserProfile(userId, { displayName, country, timezone, age }) {
  const { error } = await supabase
    .from('users')
    .upsert({
      id: userId,
      display_name: displayName,
      country,
      timezone,
      age,
      updated_at: new Date()
    });
  if (error) throw error;
}

export async function getUserProfile(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data;
}

// ========== USER PROGRESS (coins, hearts, streak, lesson completions) ==========
export async function loadUserProgress(userId) {
  const { data, error } = await supabase
    .from('user_progress')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  if (!data) {
    // Create initial record
    const initial = {
      user_id: userId,
      coins: 500,
      hearts: 5,
      current_streak: 1,
      longest_streak: 1,
      total_xp: 0,
      perfect_lessons_today: 0,
      most_xp_in_a_day: 0,
      last_lesson_date: null,
      created_at: new Date(),
      updated_at: new Date()
    };
    const { data: newData, error: insertError } = await supabase
      .from('user_progress')
      .insert(initial)
      .select()
      .single();
    if (insertError) throw insertError;
    return newData;
  }
  return data;
}

export async function updateUserProgress(userId, updates) {
  const { error } = await supabase
    .from('user_progress')
    .update({ ...updates, updated_at: new Date() })
    .eq('user_id', userId);
  if (error) throw error;
}

// ========== LESSON COMPLETIONS ==========
export async function recordLessonCompletion(userId, courseId, lessonId, xpEarned, accuracy, timeSpent) {
  const { error } = await supabase
    .from('lesson_completions')
    .insert({
      user_id: userId,
      course_id: courseId,
      lesson_id: lessonId,
      xp_earned: xpEarned,
      accuracy: accuracy,
      time_spent: timeSpent,
      completed_at: new Date()
    });
  if (error) throw error;
}

// ========== DAILY QUESTS ==========
export async function loadDailyQuests(userId, date) {
  const { data, error } = await supabase
    .from('daily_quests')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateDailyQuest(userId, date, questId, current, claimed) {
  // First check if record exists
  const existing = await loadDailyQuests(userId, date);
  if (!existing) {
    // Create default quests for first-time user (bronze, silver, gold)
    const defaultQuests = {
      user_id: userId,
      date: date,
      bronze_title: 'Start a streak',
      bronze_current: 1,
      bronze_total: 1,
      bronze_claimed: false,
      silver_title: 'Score 80% or higher in 3 lessons',
      silver_current: 0,
      silver_total: 3,
      silver_claimed: false,
      gold_title: 'Complete your next 4 lessons',
      gold_current: 0,
      gold_total: 4,
      gold_claimed: false
    };
    const { error } = await supabase.from('daily_quests').insert(defaultQuests);
    if (error) throw error;
    return updateDailyQuest(userId, date, questId, current, claimed);
  }
  
  const updateField = {};
  if (questId === 'bronze') {
    updateField.bronze_current = current;
    updateField.bronze_claimed = claimed;
  } else if (questId === 'silver') {
    updateField.silver_current = current;
    updateField.silver_claimed = claimed;
  } else if (questId === 'gold') {
    updateField.gold_current = current;
    updateField.gold_claimed = claimed;
  }
  
  const { error } = await supabase
    .from('daily_quests')
    .update(updateField)
    .eq('user_id', userId)
    .eq('date', date);
  if (error) throw error;
}

// ========== ACHIEVEMENTS & PERSONAL RECORDS ==========
export async function loadAchievements(userId) {
  const { data, error } = await supabase
    .from('achievements')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return data || [];
}

export async function updateAchievement(userId, achievementId, level, coinsAwarded) {
  // Upsert logic: if exists, update level; else insert
  const { error } = await supabase
    .from('achievements')
    .upsert({
      user_id: userId,
      achievement_id: achievementId,
      level: level,
      coins_awarded: coinsAwarded,
      awarded_at: new Date()
    }, { onConflict: 'user_id,achievement_id' });
  if (error) throw error;
}

export async function loadPersonalRecords(userId) {
  const { data, error } = await supabase
    .from('personal_records')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return data || [];
}

export async function updatePersonalRecord(userId, recordType, value, coinsAwarded) {
  const { error } = await supabase
    .from('personal_records')
    .upsert({
      user_id: userId,
      record_type: recordType,
      value: value,
      coins_awarded: coinsAwarded,
      achieved_at: new Date()
    }, { onConflict: 'user_id,record_type' });
  if (error) throw error;
}

// ========== XP BOOSTS ==========
export async function getActiveXpBoost(userId) {
  const now = new Date();
  const { data, error } = await supabase
    .from('xp_boosts')
    .select('*')
    .eq('user_id', userId)
    .gt('expires_at', now.toISOString())
    .order('multiplier', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function addXpBoost(userId, multiplier, durationMinutes) {
  const expiresAt = new Date(Date.now() + durationMinutes * 60000);
  const { error } = await supabase
    .from('xp_boosts')
    .insert({
      user_id: userId,
      multiplier: multiplier,
      expires_at: expiresAt.toISOString()
    });
  if (error) throw error;
}
