-- migrations/0008_achievement_counters.sql
-- ============================================================
-- VULANET — Achievement counters
-- ============================================================
--
-- Adds lifetime counter columns to public.user_stats. Each column
-- backs one achievement defined in src/js/achievement-defs.js:
--
--   total_xp                    (already exists)  → xppowerhouse
--   perfect_lessons             (already exists)  → sharpshooter
--   perfect_week_count                            → perfectweek
--   glossary_terms_discovered                     → wordsmith
--   timed_challenge_xp                            → speedfreak
--   night_owl_lessons                             → nightowl
--   early_bird_lessons                            → earlybird
--   master_challenges_completed                   → goldenhands
--   quests_completed                              → questhero
--   congratulations_sent                          → cheerleader
--   corrections_made                              → erroreraser
--   league_champion_count                         → leaguechampion
--   ultimate_champion_count                       → ultimatechampion
--
-- "firstflock" is derived at read time from the follows table and
-- therefore does not get a column here.
--
-- Existing rows are backfilled with 0 for every new column.
-- Pre-migration history is NOT reconstructed. Lifetime totals in
-- daily_progress remain intact and can be used for a one-off
-- backfill if desired.
--
-- The RPC increment_user_stat() performs an atomic increment so
-- concurrent calls (e.g. two lessons finishing back-to-back, or a
-- chest claim racing a lesson completion) do not lose updates.
-- The RPC runs SECURITY INVOKER so RLS still applies.
--
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE public.user_stats
  ADD COLUMN IF NOT EXISTS perfect_week_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS glossary_terms_discovered integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS timed_challenge_xp integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS night_owl_lessons integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS early_bird_lessons integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS master_challenges_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quests_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS congratulations_sent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS corrections_made integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS league_champion_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimate_champion_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.user_stats.perfect_week_count IS
  'Number of distinct 7-day streaks completed without a Streak Revival.';
COMMENT ON COLUMN public.user_stats.glossary_terms_discovered IS
  'Cumulative count of distinct glossary terms the user has opened.';
COMMENT ON COLUMN public.user_stats.timed_challenge_xp IS
  'Total XP earned from timed-challenge lessons.';
COMMENT ON COLUMN public.user_stats.night_owl_lessons IS
  'Lessons completed between 00:00 and 02:59 local time.';
COMMENT ON COLUMN public.user_stats.early_bird_lessons IS
  'Lessons completed between 06:00 and 08:59 local time.';
COMMENT ON COLUMN public.user_stats.master_challenges_completed IS
  'Mastery-mode lesson completions.';
COMMENT ON COLUMN public.user_stats.quests_completed IS
  'Daily quest chests the user has claimed.';
COMMENT ON COLUMN public.user_stats.congratulations_sent IS
  'Congratulation messages the user has sent to other users.';
COMMENT ON COLUMN public.user_stats.corrections_made IS
  'Mistakes reviewed and corrected in the retry queue.';
COMMENT ON COLUMN public.user_stats.league_champion_count IS
  'Number of times the user has finished #1 in a league.';
COMMENT ON COLUMN public.user_stats.ultimate_champion_count IS
  'Number of times the user has finished #1 in the Ultimate League.';

-- ============================================================
-- Atomic increment RPC
-- ============================================================
--
-- increment_user_stat(p_stat_name, p_delta) increments a single
-- whitelisted counter on the calling user's user_stats row and
-- returns the new value. The whitelist prevents SQL injection via
-- the column identifier, which must be interpolated (Postgres does
-- not parameterise identifiers).
--
-- SECURITY INVOKER: the caller's RLS policies apply, so a user
-- can only touch their own row.

CREATE OR REPLACE FUNCTION public.increment_user_stat(
  p_stat_name text,
  p_delta integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  new_value integer;
BEGIN
  IF p_stat_name NOT IN (
    'total_xp',
    'perfect_lessons',
    'perfect_week_count',
    'glossary_terms_discovered',
    'timed_challenge_xp',
    'night_owl_lessons',
    'early_bird_lessons',
    'master_challenges_completed',
    'quests_completed',
    'congratulations_sent',
    'corrections_made',
    'league_champion_count',
    'ultimate_champion_count'
  ) THEN
    RAISE EXCEPTION 'increment_user_stat: invalid stat name %', p_stat_name;
  END IF;

  EXECUTE format(
    'UPDATE public.user_stats SET %I = %I + $1 WHERE user_id = auth.uid() RETURNING %I',
    p_stat_name, p_stat_name, p_stat_name
  )
    INTO new_value
    USING p_delta;

  RETURN new_value;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_user_stat(text, integer) TO authenticated;