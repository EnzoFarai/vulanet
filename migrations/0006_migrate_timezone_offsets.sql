-- ============================================================
-- 0006_migrate_timezone_offsets.sql
-- One-shot bulk migration of profiles.timezone from the old
-- "UTC+HH:MM" offset format to IANA identifiers.
--
-- SCOPE: WHOLE-HOUR OFFSETS ONLY. Each whole-hour offset maps to
-- the corresponding Etc/GMT±N zone (note: Etc/GMT signs are
-- INVERTED — Etc/GMT-2 is UTC+02:00). These are stable, DST-free,
-- and represent exactly the same wall-clock behaviour the old
-- offset parser provided. No regression.
--
-- WHY NO HALF-HOUR OR QUARTER-HOUR MAPPINGS: a fixed offset does
-- not uniquely determine an IANA zone. UTC+10:30 is
-- Australia/Adelaide in winter and Australia/Darwin in summer
-- (Adelaide observes DST, Darwin does not). UTC+12:45 is
-- Pacific/Chatham in winter and UTC+13:45 in summer. Choosing one
-- IANA zone for a fixed half-hour offset would silently introduce
-- (or silently remove) DST for the user, which is a worse
-- regression than leaving the offset alone. Half/quarter-hour
-- offsets are therefore left untouched by this migration and are
-- upgraded on a per-user basis by layout.js (item 8), where the
-- browser's own zone is available as a hint.
--
-- LOCALSTORAGE IS NOT TOUCHED BY THIS SQL. localStorage.userTimezone
-- still holds the original offset string for every existing user.
-- layout.js (item 8) is responsible for upgrading both the DB row
-- (via updateProfile) and the localStorage mirror (via
-- localStorage.setItem) in a single pass, using the same
-- timezoneOffsetToIana() helper.
--
-- Idempotent: only matches rows that still contain a whole-hour
-- offset string. Safe to re-run.
-- ============================================================

UPDATE public.profiles
SET timezone = CASE timezone

  -- ── Whole-hour offsets (Etc/GMT zones — sign is INVERTED) ──
  WHEN 'UTC+00:00' THEN 'UTC'
  WHEN 'UTC-01:00' THEN 'Etc/GMT+1'
  WHEN 'UTC-02:00' THEN 'Etc/GMT+2'
  WHEN 'UTC-03:00' THEN 'Etc/GMT+3'
  WHEN 'UTC-04:00' THEN 'Etc/GMT+4'
  WHEN 'UTC-05:00' THEN 'Etc/GMT+5'
  WHEN 'UTC-06:00' THEN 'Etc/GMT+6'
  WHEN 'UTC-07:00' THEN 'Etc/GMT+7'
  WHEN 'UTC-08:00' THEN 'Etc/GMT+8'
  WHEN 'UTC-09:00' THEN 'Etc/GMT+9'
  WHEN 'UTC-10:00' THEN 'Etc/GMT+10'
  WHEN 'UTC-11:00' THEN 'Etc/GMT+11'
  WHEN 'UTC-12:00' THEN 'Etc/GMT+12'
  WHEN 'UTC+01:00' THEN 'Etc/GMT-1'
  WHEN 'UTC+02:00' THEN 'Etc/GMT-2'
  WHEN 'UTC+03:00' THEN 'Etc/GMT-3'
  WHEN 'UTC+04:00' THEN 'Etc/GMT-4'
  WHEN 'UTC+05:00' THEN 'Etc/GMT-5'
  WHEN 'UTC+06:00' THEN 'Etc/GMT-6'
  WHEN 'UTC+07:00' THEN 'Etc/GMT-7'
  WHEN 'UTC+08:00' THEN 'Etc/GMT-8'
  WHEN 'UTC+09:00' THEN 'Etc/GMT-9'
  WHEN 'UTC+10:00' THEN 'Etc/GMT-10'
  WHEN 'UTC+11:00' THEN 'Etc/GMT-11'
  WHEN 'UTC+12:00' THEN 'Etc/GMT-12'
  WHEN 'UTC+13:00' THEN 'Etc/GMT-13'
  WHEN 'UTC+14:00' THEN 'Etc/GMT-14'

  -- ── Half-hour / quarter-hour offsets ──
  -- Intentionally left alone. See the header comment for the DST
  -- reasoning. layout.js (item 8) upgrades these on next login.
  ELSE timezone
END
WHERE timezone ~ '^UTC[+-]\d{2}:00$';

-- ── Verification (informational, does not affect the migration) ──
-- After this migration, run the following to see which rows remain
-- on the offset format. Those are the half/quarter-hour cases that
-- layout.js will upgrade on the user's next login:
--
--   SELECT id, timezone FROM public.profiles
--   WHERE timezone ~ '^UTC[+-]';