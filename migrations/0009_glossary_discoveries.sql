-- migrations/0009_glossary_discoveries.sql
-- ============================================================
-- VULANET — Glossary discoveries
-- ============================================================
--
-- Authoritative server-side record of which glossary terms a user
-- has discovered, keyed by (user_id, course_id, term). Backs the
-- Wordsmith achievement via user_stats.glossary_terms_discovered.
--
-- The RPC discover_glossary_term() performs an atomic
-- insert-if-new + counter-bump in a single round trip. The counter
-- increments exactly once per unique (user, course, term).
--
-- Because terms are course-scoped, the same term name discovered
-- in two courses counts twice. This is deliberate — different
-- courses define terms differently.
--
-- SECURITY INVOKER: RLS applies, so a user can only touch their
-- own rows.
--
-- Idempotent: safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.glossary_discoveries (
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id     TEXT NOT NULL,
  term          TEXT NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id, term)
);

CREATE INDEX IF NOT EXISTS idx_glossary_discoveries_user
  ON public.glossary_discoveries (user_id);

ALTER TABLE public.glossary_discoveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own discoveries" ON public.glossary_discoveries;
DROP POLICY IF EXISTS "Users can view own discoveries"   ON public.glossary_discoveries;

CREATE POLICY "Users can insert own discoveries"
  ON public.glossary_discoveries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own discoveries"
  ON public.glossary_discoveries FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- Atomic discover RPC
-- ============================================================
--
-- Inserts a row if (user, course, term) is new, then bumps
-- user_stats.glossary_terms_discovered by 1. Returns TRUE when a
-- new discovery was recorded, FALSE when the term was already
-- known.
--
-- Why a raw UPDATE instead of calling increment_user_stat: the
-- "insert + bump" pair must be one atomic server-side operation.
-- Two client round trips would leave a window where the insert
-- succeeds but the bump fails, undercounting the achievement.
-- increment_user_stat remains the right primitive for bare
-- increments that aren't paired with an insert.

CREATE OR REPLACE FUNCTION public.discover_glossary_term(
  p_course_id TEXT,
  p_term      TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  inserted BOOLEAN := FALSE;
BEGIN
  INSERT INTO public.glossary_discoveries (user_id, course_id, term)
  VALUES (auth.uid(), p_course_id, p_term)
  ON CONFLICT (user_id, course_id, term) DO NOTHING;

  -- FOUND is set by the INSERT itself. When ON CONFLICT DO NOTHING
  -- skips the row, FOUND is FALSE.
  IF FOUND THEN
    inserted := TRUE;
    UPDATE public.user_stats
      SET glossary_terms_discovered = glossary_terms_discovered + 1
      WHERE user_id = auth.uid();
  END IF;

  RETURN inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.discover_glossary_term(text, text) TO authenticated;