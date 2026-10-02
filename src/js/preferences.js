// src/js/preferences.js
// Vulanet preference storage.
// - Logged-in users: stored in public.user_preferences (Supabase).
// - Guests: stored in localStorage under "guest_preferences".
// Callers never need to know which mode is active.

import { supabase, isLoggedIn, getCurrentUserProfile } from './supabase.js';

const GUEST_KEY = 'guest_preferences';

const PREFERENCE_DEFAULTS = {
  // Notifications
  smart_reminder: true,
  reminder_hour: 18,
  night_owl: true,
  early_bird: true,
  league_status: true,
  friends_quest: true,
  // Preferences
  sound_effects: true,
  motivational_messages: true,
  pref_friends_quests: true,
  // Privacy
  ad_tracking: true
};

// ── module-level cache ───────────────────────────────────────
let _cache = null;             // merged defaults + DB row
let _userId = null;            // null when guest
let _loadingPromise = null;

function readGuest() {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function writeGuest(obj) {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(obj));
  } catch (e) {
    /* storage full or blocked */
  }
}

async function loadCache() {
  if (_cache) return _cache;
  if (_loadingPromise) return _loadingPromise;

  _loadingPromise = (async () => {
    let loggedIn = false;
    try {
      loggedIn = await isLoggedIn();
    } catch (e) {
      loggedIn = false;
    }

    if (!loggedIn) {
      _userId = null;
      _cache = { ...PREFERENCE_DEFAULTS, ...readGuest() };
      return _cache;
    }

    let current = null;
    try {
      current = await getCurrentUserProfile();
    } catch (e) {
      current = null;
    }

    if (!current || !current.user) {
      _userId = null;
      _cache = { ...PREFERENCE_DEFAULTS, ...readGuest() };
      return _cache;
    }

    _userId = current.user.id;

    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', _userId)
      .maybeSingle();

    if (error || !data) {
      // Row missing — defaults only. It will be created on first save.
      _cache = { ...PREFERENCE_DEFAULTS };
    } else {
      _cache = { ...PREFERENCE_DEFAULTS, ...data };
    }
    return _cache;
  })();

  return _loadingPromise;
}

/**
 * Force a reload from the backend. Call after login/logout.
 */
export function clearPreferencesCache() {
  _cache = null;
  _userId = null;
  _loadingPromise = null;
}

/**
 * Preload the cache. Optional — getPreference() will load on demand.
 */
export async function loadPreferences() {
  return loadCache();
}

/**
 * Read a single preference value.
 */
export async function getPreference(key) {
  await loadCache();
  return _cache[key];
}

/**
 * Read all preferences at once.
 */
export async function getAllPreferences() {
  await loadCache();
  return { ..._cache };
}

/**
 * Persist a single preference. Returns true on success.
 */
export async function setPreference(key, value) {
  await loadCache();

  // Optimistic local update
  _cache[key] = value;

  if (!_userId) {
    // Guest mode — localStorage only
    const guest = readGuest();
    guest[key] = value;
    writeGuest(guest);
    return true;
  }

  // Logged-in — Supabase update (with upsert fallback if row absent)
  const payload = { [key]: value };

  const { error } = await supabase
    .from('user_preferences')
    .update(payload)
    .eq('user_id', _userId);

  if (error) {
    // Row may not exist yet — try insert
    const { error: insertError } = await supabase
      .from('user_preferences')
      .insert({ user_id: _userId, ...payload });

    if (insertError) {
      console.error('Failed to save preference:', error, insertError);
      return false;
    }
  }
  return true;
}

export { PREFERENCE_DEFAULTS };
