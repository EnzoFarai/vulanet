-- ============================================================
-- 0005_user_stats_additions.sql
-- Additional columns on user_stats needed by the streak and
-- hearts pipelines when quiz-engine.js starts writing to
-- Supabase (item 7 of the shipping list).
--
--   last_lesson_date — the user's LOCAL date of their most
--                      recent completed lesson. Written after
--                      the streak modal closes.
--
--   next_heart_at    — timestamp when the next heart should
--                      regenerate. NULL when hearts are full.
--                      Read by layout.js for the header
--                      countdown and by the refill check.
-- ============================================================

ALTER TABLE public.user_stats
  ADD COLUMN IF NOT EXISTS last_lesson_date DATE;

ALTER TABLE public.user_stats
  ADD COLUMN IF NOT EXISTS next_heart_at TIMESTAMPTZ;