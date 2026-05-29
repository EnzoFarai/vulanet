// src/js/supabase.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Replace with your actual Supabase credentials when ready
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';

let supabase = null;
let supabaseInitialized = false;

try {
  if (SUPABASE_URL !== 'https://YOUR_PROJECT.supabase.co' && SUPABASE_ANON_KEY !== 'YOUR_ANON_KEY') {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    supabaseInitialized = true;
    console.log('Supabase initialized');
  } else {
    console.warn('Supabase not configured – using localStorage mock');
  }
} catch (e) {
  console.warn('Supabase initialization failed – using localStorage mock', e);
}

// ---------- MOCK IMPLEMENTATION (when Supabase not configured) ----------
const mockUsers = JSON.parse(localStorage.getItem('mock_users') || '{}');

async function mockSignUp(email, password, displayName) {
  const userId = 'mock_' + Date.now();
  mockUsers[userId] = { email, displayName, password };
  localStorage.setItem('mock_users', JSON.stringify(mockUsers));
  localStorage.setItem('mock_session', userId);
  return { user: { id: userId, email }, error: null };
}

async function mockSignIn(email, password) {
  const userId = Object.keys(mockUsers).find(id => mockUsers[id].email === email && mockUsers[id].password === password);
  if (!userId) return { user: null, error: new Error('Invalid credentials') };
  localStorage.setItem('mock_session', userId);
  return { user: { id: userId, email }, error: null };
}

async function mockSignInWithGoogle() {
  const userId = 'mock_google_' + Date.now();
  mockUsers[userId] = { email: 'google_user@example.com', displayName: 'Google User', provider: 'google' };
  localStorage.setItem('mock_users', JSON.stringify(mockUsers));
  localStorage.setItem('mock_session', userId);
  return { user: { id: userId, email: 'google_user@example.com' }, error: null };
}

async function mockGetUser() {
  const sessionId = localStorage.getItem('mock_session');
  if (sessionId && mockUsers[sessionId]) {
    return { id: sessionId, email: mockUsers[sessionId].email, user_metadata: { display_name: mockUsers[sessionId].displayName } };
  }
  return null;
}

async function mockSignOut() {
  localStorage.removeItem('mock_session');
}

// ---------- Real Supabase functions (if initialized) ----------
export async function signUp(email, password, displayName) {
  if (!supabaseInitialized) return mockSignUp(email, password, displayName);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } }
  });
  return { user: data?.user, error };
}

export async function signIn(email, password) {
  if (!supabaseInitialized) return mockSignIn(email, password);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { user: data?.user, error };
}

export async function signInWithGoogle() {
  if (!supabaseInitialized) return mockSignInWithGoogle();
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
  return { data, error };
}

export async function getCurrentUser() {
  if (!supabaseInitialized) return mockGetUser();
  const { data: { user }, error } = await supabase.auth.getUser();
  return error ? null : user;
}

export async function signOut() {
  if (!supabaseInitialized) return mockSignOut();
  await supabase.auth.signOut();
  window.location.href = '/';
}

// ---------- User Profile (registration-completion) ----------
export async function saveUserProfile(userId, { displayName, country, timezone, age }) {
  if (!supabaseInitialized) {
    const profile = { displayName, country, timezone, age };
    localStorage.setItem(`profile_${userId}`, JSON.stringify(profile));
    return;
  }
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
  if (!supabaseInitialized) {
    const profile = localStorage.getItem(`profile_${userId}`);
    return profile ? JSON.parse(profile) : null;
  }
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data;
}

// ---------- User Progress ----------
export async function loadUserProgress(userId) {
  if (!supabaseInitialized) {
    const key = `progress_${userId}`;
    let progress = localStorage.getItem(key);
    if (!progress) {
      progress = {
        user_id: userId,
        coins: 500,
        hearts: 5,
        current_streak: 1,
        longest_streak: 1,
        total_xp: 0,
        perfect_lessons_today: 0,
        most_xp_in_a_day: 0,
        last_lesson_date: null
      };
      localStorage.setItem(key, JSON.stringify(progress));
    } else {
      progress = JSON.parse(progress);
    }
    return progress;
  }
  const { data, error } = await supabase
    .from('user_progress')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  if (!data) {
    const initial = {
      user_id: userId,
      coins: 500,
      hearts: 5,
      current_streak: 1,
      longest_streak: 1,
      total_xp: 0,
      perfect_lessons_today: 0,
      most_xp_in_a_day: 0,
      last_lesson_date: null
    };
    const { data: newData, error: insertError } = await supabase.from('user_progress').insert(initial).select().single();
    if (insertError) throw insertError;
    return newData;
  }
  return data;
}

export async function updateUserProgress(userId, updates) {
  if (!supabaseInitialized) {
    const key = `progress_${userId}`;
    const progress = JSON.parse(localStorage.getItem(key) || '{}');
    Object.assign(progress, updates);
    localStorage.setItem(key, JSON.stringify(progress));
    return;
  }
  const { error } = await supabase
    .from('user_progress')
    .update({ ...updates, updated_at: new Date() })
    .eq('user_id', userId);
  if (error) throw error;
}

// ---------- Lesson Completions ----------
export async function recordLessonCompletion(userId, courseId, lessonId, xpEarned, accuracy, timeSpent) {
  if (!supabaseInitialized) {
    const completions = JSON.parse(localStorage.getItem(`completions_${userId}`) || '[]');
    completions.push({ courseId, lessonId, xpEarned, accuracy, timeSpent, completed_at: new Date() });
    localStorage.setItem(`completions_${userId}`, JSON.stringify(completions));
    return;
  }
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

// ---------- Daily Quests ----------
export async function loadDailyQuests(userId, date) {
  if (!supabaseInitialized) {
    const key = `dailyQuests_${userId}_${date}`;
    return JSON.parse(localStorage.getItem(key));
  }
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
  if (!supabaseInitialized) {
    const key = `dailyQuests_${userId}_${date}`;
    let quests = JSON.parse(localStorage.getItem(key) || '{}');
    quests[questId] = { current, claimed };
    localStorage.setItem(key, JSON.stringify(quests));
    return;
  }
  // Similar to previous implementation (see earlier schema)
  const existing = await loadDailyQuests(userId, date);
  if (!existing) {
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
    await supabase.from('daily_quests').insert(defaultQuests);
    return updateDailyQuest(userId, date, questId, current, claimed);
  }
  const updateField = {};
  if (questId === 'bronze') { updateField.bronze_current = current; updateField.bronze_claimed = claimed; }
  else if (questId === 'silver') { updateField.silver_current = current; updateField.silver_claimed = claimed; }
  else if (questId === 'gold') { updateField.gold_current = current; updateField.gold_claimed = claimed; }
  await supabase.from('daily_quests').update(updateField).eq('user_id', userId).eq('date', date);
}

// ---------- XP Boosts ----------
export async function getActiveXpBoost(userId) {
  if (!supabaseInitialized) {
    const boosts = JSON.parse(localStorage.getItem(`boosts_${userId}`) || '[]');
    const now = Date.now();
    const active = boosts.find(b => b.expiresAt > now);
    return active ? { multiplier: active.multiplier } : null;
  }
  const { data, error } = await supabase
    .from('xp_boosts')
    .select('*')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('multiplier', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function addXpBoost(userId, multiplier, durationMinutes) {
  const expiresAt = new Date(Date.now() + durationMinutes * 60000);
  if (!supabaseInitialized) {
    const boosts = JSON.parse(localStorage.getItem(`boosts_${userId}`) || '[]');
    boosts.push({ multiplier, expiresAt: expiresAt.getTime() });
    localStorage.setItem(`boosts_${userId}`, JSON.stringify(boosts));
    return;
  }
  const { error } = await supabase.from('xp_boosts').insert({
    user_id: userId,
    multiplier: multiplier,
    expires_at: expiresAt.toISOString()
  });
  if (error) throw error;
}
