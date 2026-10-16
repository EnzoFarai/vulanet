-- ============================================================
-- 0001_daily_progress.sql
-- Per-user, per-local-date counters for the daily-goal system
-- and daily quests.
--
-- Every column except updated_at is a monotonic accumulator.
-- "Reset" happens implicitly: a new row is created on the first
-- lesson of the local day. Old rows are retained for history.
--
-- Self-contained: this file declares its own copy of
-- update_updated_at_column() so the migrations folder can be
-- applied to a fresh Supabase project without depending on the
-- base schema being run first.
-- ============================================================

-- ------------------------------------------------------------
-- Shared helper — safe to re-declare, matches the base schema.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_progress (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  progress_date DATE NOT NULL,

  -- Daily-goal + learning-time accumulators
  minutes_learned INTEGER NOT NULL DEFAULT 0,
  xp_earned INTEGER NOT NULL DEFAULT 0,

  -- Lesson-shape counters
  lessons_completed INTEGER NOT NULL DEFAULT 0,
  perfect_lessons INTEGER NOT NULL DEFAULT 0,
  mastered_lessons INTEGER NOT NULL DEFAULT 0,
  high_accuracy_lessons INTEGER NOT NULL DEFAULT 0,
  answer_streak_5_lessons INTEGER NOT NULL DEFAULT 0,

  -- Reserved for future quest types
  practice_lessons INTEGER NOT NULL DEFAULT 0,
  timed_challenges INTEGER NOT NULL DEFAULT 0,
  reviewed_lessons INTEGER NOT NULL DEFAULT 0,
  chapter_reviews INTEGER NOT NULL DEFAULT 0,

  -- Daily-goal reward gating (once per local day)
  daily_goal_reward_claimed BOOLEAN NOT NULL DEFAULT FALSE,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, progress_date)
);

-- The PK already covers (user_id, progress_date) lookups.
-- This index supports aggregate queries across all users for a
-- specific date (leaderboards, analytics).
CREATE INDEX IF NOT EXISTS idx_daily_progress_date
  ON public.daily_progress(progress_date);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.daily_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own daily progress"   ON public.daily_progress;
DROP POLICY IF EXISTS "Users can insert own daily progress" ON public.daily_progress;
DROP POLICY IF EXISTS "Users can update own daily progress" ON public.daily_progress;

CREATE POLICY "Users can view own daily progress"
  ON public.daily_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily progress"
  ON public.daily_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own daily progress"
  ON public.daily_progress FOR UPDATE
  USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Trigger
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS update_daily_progress_updated_at ON public.daily_progress;
CREATE TRIGGER update_daily_progress_updated_at
  BEFORE UPDATE ON public.daily_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();