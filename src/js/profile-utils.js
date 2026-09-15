// src/js/profile-utils.js
/**
 * Get a consistent avatar colour for a user based on their ID or name.
 * Uses a simple hash to pick from a palette.
 */
const AVATAR_COLORS = [
  '#ff5722', '#3f51b5', '#009688', '#9c27b0', '#e91e63',
  '#4caf50', '#00bcd4', '#ff9800', '#795548', '#607d8b',
  '#8bc34a', '#ffc107'
];

export function getAvatarColor(userId) {
  if (!userId) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

/**
 * Get the first character of the display name (or username fallback)
 */
export function getAvatarInitial(displayName, username) {
  const name = displayName || username || '?';
  return name.charAt(0).toUpperCase();
}
