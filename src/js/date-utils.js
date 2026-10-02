// src/js/date-utils.js
// ============================================================
// VULANET DATE & TIMEZONE UTILITIES
// ============================================================
//
// Design rules (see inspection report §3, "timezone bug"):
//
//   • The app previously stored a fixed offset string in
//     profiles.timezone, e.g. "UTC+02:00". Intl.DateTimeFormat
//     does NOT accept that format — it requires an IANA identifier.
//     Every helper that passed the string to Intl threw silently
//     and fell back to UTC, so "the user's local day" was the UTC
//     day for every user everywhere.
//
//   • We now support BOTH formats on read:
//       - IANA identifiers: "Africa/Johannesburg", "America/New_York"
//       - Fixed offset strings: "UTC+02:00", "UTC-05:00", "UTC+05:30"
//
//   • New registrations should write IANA to profiles.timezone.
//     `timezoneOffsetToIana()` provides a best-effort mapper for
//     migrating existing rows.
//
//   • When no timezone is available at all, we fall back to UTC.
//
// Exports:
//   formatDateOrdinal(date)                        — "13th of August 2025"
//   formatNumberShort(num)                         — "1.2K", "3.4M"
//   isIanaTimezone(str)                            — validator
//   isOffsetTimezone(str)                          — validator
//   isValidTimezone(str)                           — either of the above
//   parseOffsetMinutes(str)                        — "UTC+02:00" → 120
//   timezoneOffsetToIana(offsetStr, fallback?)     — best-effort mapper
//   getLocalDateString(tz, date?)                  — YYYY-MM-DD in tz
//   getLocalHour(tz, date?)                        — 0..23 in tz
//   getLocalDateObject(tz, date?)                  — Date anchored to tz
//   isSameLocalDay(tz, dateA, dateB)               — equality helper
// ============================================================

// ─────────────────────────────────────────────────────────────
// EXISTING EXPORTS — unchanged
// ─────────────────────────────────────────────────────────────

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
 * Format a number with K/M suffix.
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

// ─────────────────────────────────────────────────────────────
// TIMEZONE FORMAT DETECTION
// ─────────────────────────────────────────────────────────────

// The pattern Intl accepts for a bare fixed-offset zone name
// (rare — most environments reject these; we don't rely on it).
const IANA_OFFSET_ZONE = /^(Etc\/GMT[+-]\d{1,2}|UTC|GMT)$/;

// Our own offset format, as captured by registration-completion.html.
const OFFSET_STRING = /^UTC([+-])(\d{1,2}):?(\d{2})?$/;

/**
 * True if `str` looks like an IANA timezone identifier.
 * Examples: "Africa/Johannesburg", "America/New_York", "UTC", "Etc/GMT-2".
 */
export function isIanaTimezone(str) {
  if (typeof str !== 'string' || str.length === 0) return false;
  if (str === 'UTC' || str === 'GMT') return true;
  if (IANA_OFFSET_ZONE.test(str)) return true;
  // Everything else must contain a "/" to qualify as IANA.
  if (!str.includes('/')) return false;
  // Don't try to be clever — just ask Intl if it accepts it.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: str });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * True if `str` matches our "UTC+HH:MM" / "UTC-HH:MM" format.
 */
export function isOffsetTimezone(str) {
  return typeof str === 'string' && OFFSET_STRING.test(str);
}

/**
 * True if `str` is usable as a timezone by this module.
 */
export function isValidTimezone(str) {
  return isIanaTimezone(str) || isOffsetTimezone(str);
}

// ─────────────────────────────────────────────────────────────
// OFFSET STRING PARSING
// ─────────────────────────────────────────────────────────────

/**
 * Parse "UTC+02:00" / "UTC-05:00" / "UTC+05:30" / "UTC+2" to
 * minutes east of UTC (positive for east).
 * Returns null when the string doesn't match.
 */
export function parseOffsetMinutes(str) {
  if (typeof str !== 'string') return null;
  const m = OFFSET_STRING.exec(str);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const hours = parseInt(m[2], 10);
  const minutes = m[3] ? parseInt(m[3], 10) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours > 14 || minutes > 59) return null;
  return sign * (hours * 60 + minutes);
}

// ─────────────────────────────────────────────────────────────
// OFFSET → IANA (best effort)
// ─────────────────────────────────────────────────────────────

// Etc/GMT zones use INVERTED signs: Etc/GMT-2 is UTC+02:00.
// They only exist for whole hours. Half-hour and quarter-hour
// offsets (India, Nepal, Newfoundland) have no Etc/GMT equivalent.
function offsetMinutesToEtcGmt(minutes) {
  if (minutes % 60 !== 0) return null;
  const hours = minutes / 60;
  if (hours < -14 || hours > 14) return null;
  if (hours === 0) return 'UTC';
  // Invert the sign for Etc/GMT
  const etcSign = hours > 0 ? '-' : '+';
  return `Etc/GMT${etcSign}${Math.abs(hours)}`;
}

/**
 * Best-effort conversion of an offset string to an IANA identifier.
 *
 * Preference order:
 *   1. If the browser's own IANA zone matches the offset *today*,
 *      use it. This is by far the most likely to be correct, since
 *      the user is on the device that produced the offset.
 *   2. Fall back to the appropriate Etc/GMT zone (whole hours only).
 *   3. Return `fallback` (or the original string) — never throws.
 *
 * NOTE: an offset does not uniquely determine a zone (UTC+02:00
 * could be Africa/Johannesburg year-round, Europe/Paris in summer,
 * Asia/Jerusalem in summer, etc.). This mapper is intentionally
 * conservative — it prefers "the user's own zone" over guessing a
 * region from a table.
 *
 * DST CAVEAT (intended behaviour, not a bug): an offset stored in
 * *winter* (say "UTC+01:00" saved in January in Paris) and later
 * evaluated in *summer* will not match the browser's current
 * offset (which would be UTC+02:00 in July in Paris). In that
 * case the mapper falls through to `Etc/GMT-1`, giving a stable
 * no-DST result. The user can re-save their timezone from settings
 * to lock in the correct IANA identifier, or the item-8 layout
 * pass will upgrade it on the next login when the offset matches
 * again.
 */
export function timezoneOffsetToIana(offsetStr, fallback = null) {
  if (!isOffsetTimezone(offsetStr)) return fallback || offsetStr;
  const targetOffset = parseOffsetMinutes(offsetStr);

  // Step 1: does the browser's own zone match?
  try {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isIanaTimezone(browserTz)) {
      const browserOffsetNow = -new Date().getTimezoneOffset(); // minutes east of UTC
      if (browserOffsetNow === targetOffset) {
        return browserTz;
      }
    }
  } catch (e) { /* swallow */ }

  // Step 2: Etc/GMT fallback (whole-hour offsets only)
  const etc = offsetMinutesToEtcGmt(targetOffset);
  if (etc) return etc;

  // Step 3: give up gracefully
  return fallback || offsetStr;
}

// ─────────────────────────────────────────────────────────────
// LOCAL DATE / HOUR RESOLUTION
// ─────────────────────────────────────────────────────────────

/**
 * Return the wall-clock date in the given timezone as a "date-like"
 * object with `year`, `month`, `day`, `hour`, `minute`, `second`,
 * `dayOfWeek`, and a `_synthetic` Date.
 *
 * **IMPORTANT:** Do NOT call `_synthetic.getTime()` — its epoch is
 * meaningless. `_synthetic` is a value carrier whose getters return
 * the target-zone wall-clock values, but its absolute timestamp is
 * derived from the runtime's local zone and has no relation to the
 * actual instant. Treat it as a struct with getters, nothing more.
 *
 * Callers who just want the YYYY-MM-DD string should use
 * `getLocalDateString` instead, which is a thin wrapper.
 */
export function getLocalDateObject(tz, date = new Date()) {
  if (isIanaTimezone(tz)) {
    try {
      // Build a Date whose *local* fields reflect the target zone
      // by reading the formatted parts and reassembling them in
      // the current runtime's local zone.
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).formatToParts(date);

      const grab = (type) => {
        const p = parts.find(x => x.type === type);
        return p ? parseInt(p.value, 10) : 0;
      };

      // Note: hour "24" is possible in hour12:false on some engines
      // for midnight; normalise it to 0.
      let hh = grab('hour');
      if (hh === 24) hh = 0;

      const yyyy = grab('year');
      const mm = grab('month'); // 1..12
      const dd = grab('day');
      const mi = grab('minute');
      const ss = grab('second');

      // Construct a Date in the *runtime's* local zone with those
      // fields. We only use its getters — we never ask it for
      // absolute time — so the runtime's own zone doesn't matter.
      const synthetic = new Date(yyyy, mm - 1, dd, hh, mi, ss);

      return {
        year: yyyy,
        month: mm,      // 1..12
        day: dd,
        hour: hh,
        minute: mi,
        second: ss,
        dayOfWeek: synthetic.getDay(), // 0=Sun..6=Sat
        _synthetic: synthetic
      };
    } catch (e) {
      // fall through to offset / UTC
    }
  }

  if (isOffsetTimezone(tz)) {
    const offsetMin = parseOffsetMinutes(tz);
    if (offsetMin !== null) {
      const shifted = new Date(date.getTime() + offsetMin * 60 * 1000);
      return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        second: shifted.getUTCSeconds(),
        dayOfWeek: shifted.getUTCDay(),
        _synthetic: shifted
      };
    }
  }

  // Fallback: UTC
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    dayOfWeek: date.getUTCDay(),
    _synthetic: date
  };
}

/**
 * Return YYYY-MM-DD in the given timezone.
 * Accepts both IANA and offset formats; falls back to UTC.
 */
export function getLocalDateString(tz, date = new Date()) {
  const parts = getLocalDateObject(tz, date);
  const mm = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  return `${parts.year}-${mm}-${dd}`;
}

/**
 * Return the wall-clock hour (0..23) in the given timezone.
 * Used by Night Owl (00:00–02:59) and Early Bird (06:00–08:59)
 * detection.
 */
export function getLocalHour(tz, date = new Date()) {
  return getLocalDateObject(tz, date).hour;
}

/**
 * True when `dateA` and `dateB` fall on the same local day in `tz`.
 */
export function isSameLocalDay(tz, dateA, dateB) {
  return getLocalDateString(tz, dateA) === getLocalDateString(tz, dateB);
}
