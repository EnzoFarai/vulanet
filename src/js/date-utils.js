// src/js/date-utils.js
/**
 * Format a date as "13th of August 2025"
 */
export function formatDateOrdinal(date) {
  const day = date.getDate();
  const ordinal = (d) => {
    if (d > 3 && d < 21) return 'th';
    switch (d % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  };
  const month = date.toLocaleString('en-US', { month: 'long' });
  const year = date.getFullYear();
  return `${day}${ordinal(day)} of ${month} ${year}`;
}

/**
 * Format a number with K/M suffix
 */
export function formatNumberShort(num) {
  if (num < 1000) return String(num);
  if (num < 1000000) {
    const k = (num / 1000).toFixed(1);
    return k.endsWith('.0') ? k.slice(0, -2) + 'K' : k + 'K';
  }
  const m = (num / 1000000).toFixed(1);
  return m.endsWith('.0') ? m.slice(0, -2) + 'M' : m + 'M';
}
