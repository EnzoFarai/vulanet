-- ============================================================
-- 0007_high_accuracy_90.sql
-- Adds a 90%-accuracy lesson counter to daily_progress so the
-- quest pool can reference it directly.
--
-- Semantics:
--   high_accuracy_lessons       — lessons scored >= 80%
--   high_accuracy_90_lessons    — lessons scored >= 90%
--
-- These are independent counters. A single lesson can increment
-- both if it scored >= 90%.
-- ============================================================

ALTER TABLE public.daily_progress
  ADD COLUMN IF NOT EXISTS high_accuracy_90_lessons INTEGER NOT NULL DEFAULT 0;