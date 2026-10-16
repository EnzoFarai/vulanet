-- ============================================================
-- 0002_profiles_daily_goal.sql
-- Canonical storage for the user's chosen daily learning goal.
--
-- Captured by onboarding (state 6). Constrained to the four
-- options the onboarding UI offers: 5 / 10 / 15 / 20 minutes.
--
-- Defensive: an UPDATE sanitizes any pre-existing out-of-range
-- values to the default before the CHECK constraint is added,
-- so the migration cannot fail on a project with unexpected
-- data.
-- ============================================================

-- ------------------------------------------------------------
-- Column
-- ------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS daily_goal_minutes INTEGER NOT NULL DEFAULT 5;

-- ------------------------------------------------------------
-- Sanitize before constraining
-- Not strictly possible today (the column is brand new and
-- NOT NULL with a default), but harmless to include so this
-- migration is safe if ever re-run against a project where the
-- column already existed with different data.
-- ------------------------------------------------------------
UPDATE public.profiles
   SET daily_goal_minutes = 5
 WHERE daily_goal_minutes IS NULL
    OR daily_goal_minutes NOT IN (5, 10, 15, 20);

-- ------------------------------------------------------------
-- Constraint
-- ------------------------------------------------------------
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_daily_goal_minutes_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_daily_goal_minutes_check
  CHECK (daily_goal_minutes IN (5, 10, 15, 20));