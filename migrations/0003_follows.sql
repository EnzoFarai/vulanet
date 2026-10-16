-- ============================================================
-- 0003_follows.sql
-- Follow relationship between users.
-- A "friend" is a mutual follow (A→B and B→A).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

-- following_id index: "who follows me?" queries.
CREATE INDEX IF NOT EXISTS idx_follows_following_id
  ON public.follows(following_id);

-- follower_id index: "who do I follow?" queries.
-- (The PK already covers follower_id as its leading column, but
-- this explicit index keeps query plans predictable regardless of
-- planner version and postgres version.)
CREATE INDEX IF NOT EXISTS idx_follows_follower_id
  ON public.follows(follower_id);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can follow others"    ON public.follows;
DROP POLICY IF EXISTS "Users can unfollow"         ON public.follows;
DROP POLICY IF EXISTS "Users can view own follows" ON public.follows;

CREATE POLICY "Users can follow others"
  ON public.follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can unfollow"
  ON public.follows FOR DELETE
  USING (auth.uid() = follower_id);

-- A user can see rows where they're on either side (their following list
-- and their followers list). Public follower counts require a separate
-- view or RPC later — for now, this policy keeps data scoped to the two
-- parties involved.
CREATE POLICY "Users can view own follows"
  ON public.follows FOR SELECT
  USING (auth.uid() IN (follower_id, following_id));