-- ============================================================
-- 0004_quest_suggestion_dismissals.sql
-- Persists "X" dismissals of Friends Quest suggestion cards.
--
-- One-way event: a dismissal is permanent until the user or an
-- admin removes the row. No updated_at — created_at is sufficient.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.quest_suggestion_dismissals (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dismissed_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, dismissed_user_id),
  CHECK (user_id <> dismissed_user_id)
);

CREATE INDEX IF NOT EXISTS idx_dismissals_user_id
  ON public.quest_suggestion_dismissals(user_id);

ALTER TABLE public.quest_suggestion_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own dismissals" ON public.quest_suggestion_dismissals;
DROP POLICY IF EXISTS "Users can create dismissals"   ON public.quest_suggestion_dismissals;
DROP POLICY IF EXISTS "Users can remove dismissals"   ON public.quest_suggestion_dismissals;

CREATE POLICY "Users can view own dismissals"
  ON public.quest_suggestion_dismissals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create dismissals"
  ON public.quest_suggestion_dismissals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove dismissals"
  ON public.quest_suggestion_dismissals FOR DELETE
  USING (auth.uid() = user_id);