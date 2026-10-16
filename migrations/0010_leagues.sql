-- migrations/0010_leagues.sql
-- ============================================================
-- VULANET — Weekly Leagues and Leaderboard
-- ============================================================
--
-- Nine leagues ascending:
--   Beginner < Amateur < Professional < Bronze < Silver < Gold
--   < Superstar < Legendary < Ultimate
--
-- Competition week = Monday 00:00 UTC → next Monday 00:00 UTC.
-- Week boundaries are derived server-side; the client's device
-- clock is never trusted.
--
-- ── DESIGN DECISIONS ────────────────────────────────────────
--
-- 1. BOTS ARE PERSISTED. Every group carries exactly 20 rows in
--    league_participants, real or bot. Bots have is_bot = TRUE,
--    user_id = NULL, and a bot_slot (1..N) unique per group. As
--    real users join a group, a bot row is displaced. Bots never
--    touch user_stats, user_records, coins, hearts, activeBoosts,
--    league_results, or the entitlement tables.
--
--    Bot XP is recomputed on read (and again at finalisation)
--    from a deterministic target derived from (group_id, slot,
--    league). No future learner performance influences an earlier
--    bot value; only elapsed wall-clock time does.
--
--    Every group ends the week at exactly 20 rows — if a real
--    user displaced a bot, the group was topped up with a fresh
--    slot. When all 20 are real, further joins create a new
--    group. This gives bots genuine competitive weight: a user
--    who does nothing sees bots climbing past them.
--
-- 2. COMPETITION RANKING WITH GAPS. rank = 1 + COUNT(*) of
--    participants with strictly higher weekly_xp. Ties share a
--    rank. Promotion / retention / relegation applies to every
--    learner at the tied rank. Coin rewards for positions
--    R..R+N-1 are summed, floored-divided by the number of REAL
--    learners at the tie, with any remainder distributed one
--    coin each to the real learners with earliest last_xp_at
--    (redistribution only — never rank or outcome).
--
-- 3. REWARD CATEGORIES ARE RANK-EXCLUSIVE. The shared rank
--    determines which category a tie receives: rank 1..10 gets
--    coins, rank 11..20 gets heart-refill / xp-boost. A tie
--    whose expanded span crosses the 10/11 boundary does NOT
--    grant both categories to the same learner. See the note at
--    the bottom of this header.
--
-- 4. SECURITY. No client-callable function accepts an XP amount.
--    sync_league_weekly_xp() takes no arguments and derives the
--    caller's weekly XP from daily_progress.xp_earned. join_league_competition(),
--    sync_league_weekly_xp(), and the bot helpers are SECURITY
--    DEFINER; league_participants has no client INSERT/UPDATE
--    policy. finalize_league_week() is SECURITY DEFINER because
--    it processes every participant in a week; its direct
--    UPDATEs on user_stats / user_records are scoped to the SQL
--    function, not client code.
--
-- 5. SCOPE. finalize_due_league_weeks() is currently narrowed to
--    weeks where the caller participated. PRE-PRODUCTION TODO:
--    replace with a scheduled job (pg_cron or equivalent) that
--    finalises all due weeks independently of any user session.
--
-- 6. KNOWN LIMITATION. daily_progress.progress_date is the
--    user's LOCAL calendar day; current_league_week() is UTC.
--    Around the Sunday/Monday boundary, a lesson may fall into
--    the neighbouring league week for users far from UTC. The
--    overlap is small (bounded by the user's timezone offset)
--    and is accepted for this iteration.
--
-- 7. TIE / REWARD-CATEGORY NOTE. A tie at rank 8 that expands
--    to position 19 (12 learners sharing rank 8) grants coins
--    to all 12 and NO heart-refill, because their shared rank
--    is 8. A tie at rank 12 grants heart-refill to all tied
--    learners and no coins. This is deliberate; see the
--    compatibility discussion on the tie-expansion rule.
-- ============================================================

-- ── 1. League week registry ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.league_weeks (
  week_start    DATE PRIMARY KEY,
  week_end      DATE NOT NULL,
  finalised     BOOLEAN NOT NULL DEFAULT FALSE,
  finalised_at  TIMESTAMPTZ,
  CONSTRAINT league_weeks_start_is_monday
    CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  CONSTRAINT league_weeks_end_after_start
    CHECK (week_end > week_start)
);

-- ── 2. Participants (real + bot) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.league_participants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  is_bot         BOOLEAN NOT NULL DEFAULT FALSE,
  bot_slot       INTEGER,
  bot_target_xp  INTEGER,
  week_start     DATE NOT NULL REFERENCES public.league_weeks(week_start) ON DELETE CASCADE,
  league         TEXT NOT NULL,
  group_id       UUID NOT NULL,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_xp_at    TIMESTAMPTZ,
  last_xp_at     TIMESTAMPTZ,
  weekly_xp      INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT lp_league_valid CHECK (league IN (
    'Beginner','Amateur','Professional','Bronze','Silver',
    'Gold','Superstar','Legendary','Ultimate')),
  CONSTRAINT lp_xp_nonneg CHECK (weekly_xp >= 0),
  CONSTRAINT lp_bot_shape CHECK (
    (is_bot = TRUE AND user_id IS NULL AND bot_slot IS NOT NULL AND bot_target_xp IS NOT NULL)
    OR
    (is_bot = FALSE AND user_id IS NOT NULL AND bot_slot IS NULL AND bot_target_xp IS NULL)
  )
);

-- Real users: at most one row per (user, week).
CREATE UNIQUE INDEX IF NOT EXISTS uq_lp_user_week
  ON public.league_participants (user_id, week_start)
  WHERE user_id IS NOT NULL;

-- Bots: at most one row per (group, slot).
CREATE UNIQUE INDEX IF NOT EXISTS uq_lp_bot_slot
  ON public.league_participants (group_id, bot_slot)
  WHERE is_bot = TRUE;

CREATE INDEX IF NOT EXISTS idx_lp_week_group
  ON public.league_participants (week_start, group_id);
CREATE INDEX IF NOT EXISTS idx_lp_week_league
  ON public.league_participants (week_start, league);
CREATE INDEX IF NOT EXISTS idx_lp_user
  ON public.league_participants (user_id) WHERE user_id IS NOT NULL;

-- ── 3. Finalised results (real users only) ────────────────
CREATE TABLE IF NOT EXISTS public.league_results (
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start     DATE NOT NULL REFERENCES public.league_weeks(week_start) ON DELETE CASCADE,
  league         TEXT NOT NULL,
  final_rank     INTEGER NOT NULL,
  outcome        TEXT NOT NULL,
  next_league    TEXT NOT NULL,
  finalised_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start),
  CONSTRAINT lr_outcome_valid
    CHECK (outcome IN ('promoted','retained','relegated'))
);

CREATE INDEX IF NOT EXISTS idx_lr_user_week
  ON public.league_results (user_id, week_start DESC);

-- ── 4. Coin entitlements (real users only, positions 1-10) ─
CREATE TABLE IF NOT EXISTS public.league_coin_entitlements (
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start    DATE NOT NULL REFERENCES public.league_weeks(week_start) ON DELETE CASCADE,
  amount        INTEGER NOT NULL CHECK (amount >= 0),
  claimed_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_lce_unclaimed
  ON public.league_coin_entitlements (user_id) WHERE claimed_at IS NULL;

-- ── 5. Non-coin entitlements (real users only) ─────────────
CREATE TABLE IF NOT EXISTS public.league_other_reward_entitlements (
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start    DATE NOT NULL REFERENCES public.league_weeks(week_start) ON DELETE CASCADE,
  reward_type   TEXT NOT NULL,
  multiplier    NUMERIC,
  duration_min  INTEGER,
  claimed_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start, reward_type),
  CONSTRAINT lother_type_valid
    CHECK (reward_type IN ('heart_refill','xp_boost'))
);

CREATE INDEX IF NOT EXISTS idx_lother_unclaimed
  ON public.league_other_reward_entitlements (user_id) WHERE claimed_at IS NULL;

-- ── 6. Weekly mood (real users only) ───────────────────────
CREATE TABLE IF NOT EXISTS public.league_moods (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start   DATE NOT NULL REFERENCES public.league_weeks(week_start) ON DELETE CASCADE,
  emoji        TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start)
);

-- ── 7. Schema corrections ──────────────────────────────────
ALTER TABLE public.user_records
  ADD COLUMN IF NOT EXISTS current_league TEXT NOT NULL DEFAULT 'Beginner';

ALTER TABLE public.user_records
  ALTER COLUMN highest_league SET DEFAULT 'Beginner';

-- Conditional backfill: only users with no league_results rows.
UPDATE public.user_records ur
   SET highest_league = 'Beginner'
 WHERE ur.highest_league = 'Bronze'
   AND NOT EXISTS (
     SELECT 1 FROM public.league_results lr WHERE lr.user_id = ur.user_id
   );

-- ── 8. Pure helpers ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._league_rank(p_league TEXT)
RETURNS INTEGER IMMUTABLE LANGUAGE sql AS $$
  SELECT CASE p_league
    WHEN 'Beginner' THEN 1 WHEN 'Amateur' THEN 2 WHEN 'Professional' THEN 3
    WHEN 'Bronze' THEN 4 WHEN 'Silver' THEN 5 WHEN 'Gold' THEN 6
    WHEN 'Superstar' THEN 7 WHEN 'Legendary' THEN 8 WHEN 'Ultimate' THEN 9
    ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public._league_outcome_for_rank(p_league TEXT, p_rank INTEGER)
RETURNS TEXT IMMUTABLE LANGUAGE sql AS $$
  SELECT CASE
    WHEN p_league = 'Beginner' THEN
      CASE WHEN p_rank <= 8 THEN 'promoted' ELSE 'retained' END
    WHEN p_league = 'Ultimate' THEN
      CASE WHEN p_rank <= 17 THEN 'retained' ELSE 'relegated' END
    ELSE
      CASE WHEN p_rank <= 8 THEN 'promoted'
           WHEN p_rank <= 17 THEN 'retained'
           ELSE 'relegated' END
  END;
$$;

CREATE OR REPLACE FUNCTION public._league_next(p_league TEXT, p_outcome TEXT)
RETURNS TEXT IMMUTABLE LANGUAGE sql AS $$
  SELECT CASE p_outcome
    WHEN 'promoted' THEN CASE p_league
      WHEN 'Beginner' THEN 'Amateur' WHEN 'Amateur' THEN 'Professional'
      WHEN 'Professional' THEN 'Bronze' WHEN 'Bronze' THEN 'Silver'
      WHEN 'Silver' THEN 'Gold' WHEN 'Gold' THEN 'Superstar'
      WHEN 'Superstar' THEN 'Legendary' WHEN 'Legendary' THEN 'Ultimate'
      ELSE 'Ultimate' END
    WHEN 'relegated' THEN CASE p_league
      WHEN 'Ultimate' THEN 'Legendary' WHEN 'Legendary' THEN 'Superstar'
      WHEN 'Superstar' THEN 'Gold' WHEN 'Gold' THEN 'Silver'
      WHEN 'Silver' THEN 'Bronze' WHEN 'Bronze' THEN 'Professional'
      WHEN 'Professional' THEN 'Amateur' WHEN 'Amateur' THEN 'Beginner'
      ELSE 'Beginner' END
    ELSE p_league
  END;
$$;

CREATE OR REPLACE FUNCTION public._league_coin_weight(p_rank INTEGER)
RETURNS INTEGER IMMUTABLE LANGUAGE sql AS $$
  SELECT CASE p_rank
    WHEN 1 THEN 25 WHEN 2 THEN 18 WHEN 3 THEN 15 WHEN 4 THEN 12
    WHEN 5 THEN 10 WHEN 6 THEN 8 WHEN 7 THEN 6 WHEN 8 THEN 4
    WHEN 9 THEN 2 WHEN 10 THEN 1 ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.current_league_week()
RETURNS DATE STABLE LANGUAGE sql AS $$
  SELECT (date_trunc('week', now() AT TIME ZONE 'UTC'))::date;
$$;

-- ── 9. Bot helpers ─────────────────────────────────────────
-- Baseline XP expectation per league (roughly mid-tier weekly
-- output for a modestly active learner in that league).
CREATE OR REPLACE FUNCTION public._bot_target_for(
  p_group_id UUID,
  p_bot_slot INTEGER,
  p_league   TEXT
)
RETURNS INTEGER IMMUTABLE LANGUAGE plpgsql AS $$
DECLARE
  v_base  INTEGER;
  v_hash  BIGINT;
  v_mult  NUMERIC;
BEGIN
  v_base := CASE p_league
    WHEN 'Beginner' THEN 100 WHEN 'Amateur' THEN 200
    WHEN 'Professional' THEN 350 WHEN 'Bronze' THEN 550
    WHEN 'Silver' THEN 800 WHEN 'Gold' THEN 1100
    WHEN 'Superstar' THEN 1500 WHEN 'Legendary' THEN 2000
    WHEN 'Ultimate' THEN 2700 ELSE 100 END;

  v_hash := abs(hashtextextended(p_group_id::text || ':' || p_bot_slot::text, 0));
  v_mult := 0.5 + (v_hash % 1000)::numeric / 1000;

  RETURN GREATEST(1, round(v_base * v_mult));
END;
$$;

-- Progress curve: monotone, 0 at hours=0, target at hours>=168.
-- The e^-3 normalisation makes the curve reach exactly 1 at t=1.
CREATE OR REPLACE FUNCTION public._bot_xp_at(
  p_target INTEGER,
  p_hours_elapsed NUMERIC
)
RETURNS INTEGER IMMUTABLE LANGUAGE sql AS $$
  SELECT CASE
    WHEN p_hours_elapsed <= 0 THEN 0
    WHEN p_hours_elapsed >= 168 THEN p_target
    ELSE GREATEST(0, round(
      p_target * (
        (1 - exp(-3 * (p_hours_elapsed / 168.0)))
        / (1 - exp(-3))
      )
    ))::integer
  END;
$$;

-- Ensure a group is exactly 20 rows by adding bots as needed.
CREATE OR REPLACE FUNCTION public._fill_group_with_bots(p_group_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count    INTEGER;
  v_league   TEXT;
  v_week     DATE;
  v_missing  INTEGER;
  v_slot     INTEGER;
  v_max_slot INTEGER;
  v_target   INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.league_participants WHERE group_id = p_group_id;

  v_missing := 20 - v_count;
  IF v_missing <= 0 THEN RETURN; END IF;

  SELECT league, week_start INTO v_league, v_week
    FROM public.league_participants
   WHERE group_id = p_group_id
   LIMIT 1;
  IF v_league IS NULL THEN RETURN; END IF;

  SELECT COALESCE(MAX(bot_slot), 0) INTO v_max_slot
    FROM public.league_participants
   WHERE group_id = p_group_id AND is_bot = TRUE;

  FOR v_slot IN (v_max_slot + 1)..(v_max_slot + v_missing) LOOP
    v_target := public._bot_target_for(p_group_id, v_slot, v_league);
    INSERT INTO public.league_participants
      (is_bot, bot_slot, bot_target_xp, week_start, league, group_id,
       joined_at, first_xp_at, last_xp_at, weekly_xp)
    VALUES
      (TRUE, v_slot, v_target, v_week, v_league, p_group_id,
       v_week::timestamptz, v_week::timestamptz,
       (v_week + 7)::timestamptz, 0)
    ON CONFLICT (group_id, bot_slot) WHERE is_bot = TRUE DO NOTHING;
  END LOOP;
END;
$$;

-- Recompute bot weekly_xp for a group based on elapsed time.
CREATE OR REPLACE FUNCTION public.refresh_bots_in_group(p_group_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_week   DATE;
  v_hours  NUMERIC;
  v_bot    RECORD;
BEGIN
  SELECT week_start INTO v_week
    FROM public.league_participants
   WHERE group_id = p_group_id
   LIMIT 1;
  IF v_week IS NULL THEN RETURN; END IF;

  v_hours := EXTRACT(EPOCH FROM (now() - v_week::timestamptz)) / 3600.0;

  FOR v_bot IN
    SELECT id, bot_target_xp FROM public.league_participants
     WHERE group_id = p_group_id AND is_bot = TRUE
  LOOP
    UPDATE public.league_participants
       SET weekly_xp = public._bot_xp_at(v_bot.bot_target_xp, v_hours)
     WHERE id = v_bot.id;
  END LOOP;
END;
$$;

-- ── 10. Join (displace bot, top up) ────────────────────────
CREATE OR REPLACE FUNCTION public.join_league_competition()
RETURNS public.league_participants
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_week       DATE := public.current_league_week();
  v_league     TEXT;
  v_group_id   UUID;
  v_row        public.league_participants;
  v_candidate  UUID;
  v_victim_id  UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'join_league_competition: not authenticated';
  END IF;

  INSERT INTO public.league_weeks (week_start, week_end)
  VALUES (v_week, v_week + 7)
  ON CONFLICT (week_start) DO NOTHING;

  -- Already joined? Refresh bots and return.
  SELECT * INTO v_row FROM public.league_participants
   WHERE user_id = v_uid AND week_start = v_week;
  IF FOUND THEN
    PERFORM public.refresh_bots_in_group(v_row.group_id);
    RETURN v_row;
  END IF;

  SELECT COALESCE(current_league, 'Beginner') INTO v_league
    FROM public.user_records WHERE user_id = v_uid;
  IF v_league IS NULL THEN v_league := 'Beginner'; END IF;

  -- Prefer a group in the same league that has at least one bot
  -- we can displace. This coalesces real users into shared groups.
  SELECT lp.group_id INTO v_candidate
    FROM public.league_participants lp
   WHERE lp.week_start = v_week
     AND lp.league = v_league
     AND lp.is_bot = TRUE
   ORDER BY lp.joined_at DESC
   LIMIT 1;

  IF v_candidate IS NOT NULL THEN
    v_group_id := v_candidate;
    -- Displace the lowest-slot bot. SKIP LOCKED avoids two
    -- concurrent joins fighting over the same bot row.
    DELETE FROM public.league_participants
     WHERE id = (
       SELECT id FROM public.league_participants
        WHERE group_id = v_group_id AND is_bot = TRUE
        ORDER BY bot_slot ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     );
  ELSE
    -- Fallback: a group of only real users with room.
    SELECT lp.group_id INTO v_candidate
      FROM public.league_participants lp
     WHERE lp.week_start = v_week AND lp.league = v_league
     GROUP BY lp.group_id
    HAVING COUNT(*) < 20 AND bool_or(lp.is_bot) = FALSE
     ORDER BY MAX(lp.joined_at) DESC
     LIMIT 1;
    IF v_candidate IS NOT NULL THEN v_group_id := v_candidate;
    ELSE v_group_id := gen_random_uuid(); END IF;
  END IF;

  INSERT INTO public.league_participants
    (is_bot, user_id, week_start, league, group_id)
  VALUES
    (FALSE, v_uid, v_week, v_league, v_group_id)
  ON CONFLICT (user_id, week_start) WHERE user_id IS NOT NULL DO NOTHING;

  -- Ensure the group is exactly 20 rows (real + bot).
  PERFORM public._fill_group_with_bots(v_group_id);

  SELECT * INTO v_row FROM public.league_participants
   WHERE user_id = v_uid AND week_start = v_week;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_league_competition() TO authenticated;

-- ── 11. Sync weekly XP (no client XP argument) ─────────────
DROP FUNCTION IF EXISTS public.award_league_weekly_xp(integer);

CREATE OR REPLACE FUNCTION public.sync_league_weekly_xp()
RETURNS public.league_participants
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_week DATE := public.current_league_week();
  v_row  public.league_participants;
  v_sum  INTEGER;
  v_now  TIMESTAMPTZ := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'sync_league_weekly_xp: not authenticated';
  END IF;

  v_row := public.join_league_competition();

  SELECT COALESCE(SUM(xp_earned), 0) INTO v_sum
    FROM public.daily_progress
   WHERE user_id = v_uid
     AND progress_date >= v_week
     AND progress_date < v_week + 7;

  IF v_sum > COALESCE(v_row.weekly_xp, 0) THEN
    UPDATE public.league_participants
       SET weekly_xp   = v_sum,
           first_xp_at = COALESCE(first_xp_at, v_now),
           last_xp_at  = v_now
     WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  PERFORM public.refresh_bots_in_group(v_row.group_id);
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_league_weekly_xp() TO authenticated;

-- ── 12. Finalisation ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_league_week(p_week_start DATE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_finalised    BOOLEAN;
  v_group        RECORD;
  v_bucket       RECORD;
  v_rank         INTEGER;
  v_tie_count    INTEGER;
  v_real_count   INTEGER;
  v_outcome      TEXT;
  v_next_league  TEXT;
  v_weight_sum   INTEGER;
  v_total_coins  INTEGER;
  v_base_share   INTEGER;
  v_leftover     INTEGER;
  v_i            INTEGER;
BEGIN
  SELECT finalised INTO v_finalised
    FROM public.league_weeks
   WHERE week_start = p_week_start
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalize_league_week: unknown week %', p_week_start;
  END IF;
  IF v_finalised THEN RETURN; END IF;

  FOR v_group IN
    SELECT DISTINCT group_id, league
      FROM public.league_participants
     WHERE week_start = p_week_start
  LOOP
    -- Freeze bots at their end-of-week value before ranking.
    PERFORM public.refresh_bots_in_group(v_group.group_id);

    FOR v_bucket IN
      SELECT DISTINCT weekly_xp
        FROM public.league_participants
       WHERE week_start = p_week_start
         AND group_id = v_group.group_id
       ORDER BY weekly_xp DESC
    LOOP
      SELECT 1 + COUNT(*) INTO v_rank
        FROM public.league_participants
       WHERE week_start = p_week_start
         AND group_id = v_group.group_id
         AND weekly_xp > v_bucket.weekly_xp;

      SELECT COUNT(*) INTO v_tie_count
        FROM public.league_participants
       WHERE week_start = p_week_start
         AND group_id = v_group.group_id
         AND weekly_xp = v_bucket.weekly_xp;

      SELECT COUNT(*) INTO v_real_count
        FROM public.league_participants
       WHERE week_start = p_week_start
         AND group_id = v_group.group_id
         AND weekly_xp = v_bucket.weekly_xp
         AND is_bot = FALSE;

      v_outcome := public._league_outcome_for_rank(v_group.league, v_rank);
      v_next_league := public._league_next(v_group.league, v_outcome);

      -- league_results: real users only.
      IF v_real_count > 0 THEN
        INSERT INTO public.league_results
          (user_id, week_start, league, final_rank, outcome, next_league)
        SELECT user_id, p_week_start, v_group.league, v_rank, v_outcome, v_next_league
          FROM public.league_participants
         WHERE week_start = p_week_start
           AND group_id = v_group.group_id
           AND weekly_xp = v_bucket.weekly_xp
           AND is_bot = FALSE
        ON CONFLICT (user_id, week_start) DO NOTHING;
      END IF;

      -- Coins: shared rank in [1,10] AND at least one real user.
      IF v_rank <= 10 AND v_real_count > 0 THEN
        v_weight_sum := 0;
        FOR v_i IN 0..(v_tie_count - 1) LOOP
          v_weight_sum := v_weight_sum + public._league_coin_weight(v_rank + v_i);
        END LOOP;

        v_total_coins := v_weight_sum * 4;

        IF v_total_coins > 0 THEN
          v_base_share := v_total_coins / v_real_count;
          v_leftover   := v_total_coins - (v_base_share * v_real_count);

          WITH tied AS (
            SELECT user_id,
                   ROW_NUMBER() OVER (
                     ORDER BY last_xp_at ASC NULLS LAST, user_id ASC
                   ) AS rn
              FROM public.league_participants
             WHERE week_start = p_week_start
               AND group_id = v_group.group_id
               AND weekly_xp = v_bucket.weekly_xp
               AND is_bot = FALSE
          )
          INSERT INTO public.league_coin_entitlements
            (user_id, week_start, amount)
          SELECT user_id,
                 p_week_start,
                 v_base_share + CASE WHEN rn <= v_leftover THEN 1 ELSE 0 END
            FROM tied
          ON CONFLICT (user_id, week_start) DO NOTHING;
        END IF;
      END IF;

      -- Heart-refill / XP-boost: shared rank in [11,20] AND at
      -- least one real user. Real users only.
      IF v_rank BETWEEN 11 AND 20 AND v_real_count > 0 THEN
        INSERT INTO public.league_other_reward_entitlements
          (user_id, week_start, reward_type)
        SELECT user_id, p_week_start, 'heart_refill'
          FROM public.league_participants
         WHERE week_start = p_week_start
           AND group_id = v_group.group_id
           AND weekly_xp = v_bucket.weekly_xp
           AND is_bot = FALSE
        ON CONFLICT (user_id, week_start, reward_type) DO NOTHING;

        INSERT INTO public.league_other_reward_entitlements
          (user_id, week_start, reward_type, multiplier, duration_min)
        SELECT user_id, p_week_start, 'xp_boost', 2.0, 30
          FROM public.league_participants
         WHERE week_start = p_week_start
           AND group_id = v_group.group_id
           AND weekly_xp = v_bucket.weekly_xp
           AND is_bot = FALSE
        ON CONFLICT (user_id, week_start, reward_type) DO NOTHING;
      END IF;

      -- Achievement bumps: rank 1 real users only.
      IF v_rank = 1 AND v_real_count > 0 THEN
        UPDATE public.user_stats
           SET league_champion_count = league_champion_count + 1
         WHERE user_id IN (
           SELECT user_id FROM public.league_participants
            WHERE week_start = p_week_start
              AND group_id = v_group.group_id
              AND weekly_xp = v_bucket.weekly_xp
              AND is_bot = FALSE
         );

        IF v_group.league = 'Ultimate' THEN
          UPDATE public.user_stats
             SET ultimate_champion_count = ultimate_champion_count + 1
           WHERE user_id IN (
             SELECT user_id FROM public.league_participants
              WHERE week_start = p_week_start
                AND group_id = v_group.group_id
                AND weekly_xp = v_bucket.weekly_xp
                AND is_bot = FALSE
           );
        END IF;
      END IF;

      -- user_records: current_league + highest_league, real users.
      IF v_real_count > 0 THEN
        UPDATE public.user_records
           SET current_league = v_next_league,
               updated_at = now()
         WHERE user_id IN (
           SELECT user_id FROM public.league_participants
            WHERE week_start = p_week_start
              AND group_id = v_group.group_id
              AND weekly_xp = v_bucket.weekly_xp
              AND is_bot = FALSE
         );

        UPDATE public.user_records ur
           SET highest_league = v_next_league,
               updated_at = now()
         WHERE ur.user_id IN (
           SELECT user_id FROM public.league_participants
            WHERE week_start = p_week_start
              AND group_id = v_group.group_id
              AND weekly_xp = v_bucket.weekly_xp
              AND is_bot = FALSE
         )
           AND public._league_rank(v_next_league)
               > public._league_rank(COALESCE(ur.highest_league, 'Beginner'));
      END IF;
    END LOOP;
  END LOOP;

  INSERT INTO public.league_weeks (week_start, week_end)
  VALUES (p_week_start + 7, p_week_start + 14)
  ON CONFLICT (week_start) DO NOTHING;

  UPDATE public.league_weeks
     SET finalised = TRUE, finalised_at = now()
   WHERE week_start = p_week_start;
END;
$$;

-- ── 13. Narrow finalisation entry point ────────────────────
CREATE OR REPLACE FUNCTION public.finalize_due_league_weeks()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_week  DATE;
  v_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'finalize_due_league_weeks: not authenticated';
  END IF;

  FOR v_week IN
    SELECT DISTINCT lw.week_start
      FROM public.league_weeks lw
      JOIN public.league_participants lp
        ON lp.week_start = lw.week_start
     WHERE lp.user_id = v_uid
       AND lw.finalised = FALSE
       AND lw.week_end <= public.current_league_week()
     ORDER BY lw.week_start ASC
  LOOP
    PERFORM public.finalize_league_week(v_week);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_due_league_weeks() TO authenticated;

-- ── 14. RLS ────────────────────────────────────────────────
ALTER TABLE public.league_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_coin_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_other_reward_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_moods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lw_read ON public.league_weeks;
CREATE POLICY lw_read ON public.league_weeks
  FOR SELECT TO authenticated USING (true);

-- Participants: readable by any authenticated user (needed for
-- the leaderboard to show group mates and bots). No client INSERT
-- or UPDATE — join and sync are SECURITY DEFINER.
DROP POLICY IF EXISTS lp_read ON public.league_participants;
CREATE POLICY lp_read ON public.league_participants
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS lp_insert_own ON public.league_participants;
DROP POLICY IF EXISTS lp_update_own ON public.league_participants;

DROP POLICY IF EXISTS lr_read ON public.league_results;
CREATE POLICY lr_read ON public.league_results
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS lce_read ON public.league_coin_entitlements;
CREATE POLICY lce_read ON public.league_coin_entitlements
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS lother_read ON public.league_other_reward_entitlements;
CREATE POLICY lother_read ON public.league_other_reward_entitlements
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS lm_read ON public.league_moods;
CREATE POLICY lm_read ON public.league_moods
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS lm_write ON public.league_moods;
CREATE POLICY lm_write ON public.league_moods
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);