--
-- PostgreSQL database dump
--

\restrict CchXrA3OfZzpkMUQtwpRcN2OfXt57AAY9WhJcbFozwDwzjHExkfqpg15sshWnuc

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Debian 17.11-0+deb13u1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: _bot_target_for(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._bot_target_for(p_group_id uuid, p_bot_slot integer, p_league text) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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


--
-- Name: _bot_xp_at(integer, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._bot_xp_at(p_target integer, p_hours_elapsed numeric) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
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


--
-- Name: _fill_group_with_bots(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._fill_group_with_bots(p_group_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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


--
-- Name: _league_coin_weight(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._league_coin_weight(p_rank integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE p_rank
    WHEN 1 THEN 25 WHEN 2 THEN 18 WHEN 3 THEN 15 WHEN 4 THEN 12
    WHEN 5 THEN 10 WHEN 6 THEN 8 WHEN 7 THEN 6 WHEN 8 THEN 4
    WHEN 9 THEN 2 WHEN 10 THEN 1 ELSE 0 END;
$$;


--
-- Name: _league_next(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._league_next(p_league text, p_outcome text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
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


--
-- Name: _league_outcome_for_rank(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._league_outcome_for_rank(p_league text, p_rank integer) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
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


--
-- Name: _league_rank(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._league_rank(p_league text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE p_league
    WHEN 'Beginner' THEN 1 WHEN 'Amateur' THEN 2 WHEN 'Professional' THEN 3
    WHEN 'Bronze' THEN 4 WHEN 'Silver' THEN 5 WHEN 'Gold' THEN 6
    WHEN 'Superstar' THEN 7 WHEN 'Legendary' THEN 8 WHEN 'Ultimate' THEN 9
    ELSE 0 END;
$$;


--
-- Name: current_league_week(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_league_week() RETURNS date
    LANGUAGE sql STABLE
    AS $$
  SELECT (date_trunc('week', now() AT TIME ZONE 'UTC'))::date;
$$;


--
-- Name: discover_glossary_term(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.discover_glossary_term(p_course_id text, p_term text) RETURNS boolean
    LANGUAGE plpgsql
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


--
-- Name: finalize_due_league_weeks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalize_due_league_weeks() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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


--
-- Name: finalize_league_week(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalize_league_week(p_week_start date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (
    NEW.id, 
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)), 
    NEW.email
  );
  
  INSERT INTO public.user_stats (user_id)
  VALUES (NEW.id);
  
  INSERT INTO public.user_records (user_id)
  VALUES (NEW.id);
  
  RETURN NEW;
END;
$$;


--
-- Name: handle_new_user_preferences(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user_preferences() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.user_preferences (user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;


--
-- Name: increment_user_stat(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_user_stat(p_stat_name text, p_delta integer) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
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
$_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: league_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    is_bot boolean DEFAULT false NOT NULL,
    bot_slot integer,
    bot_target_xp integer,
    week_start date NOT NULL,
    league text NOT NULL,
    group_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    first_xp_at timestamp with time zone,
    last_xp_at timestamp with time zone,
    weekly_xp integer DEFAULT 0 NOT NULL,
    CONSTRAINT lp_bot_shape CHECK ((((is_bot = true) AND (user_id IS NULL) AND (bot_slot IS NOT NULL) AND (bot_target_xp IS NOT NULL)) OR ((is_bot = false) AND (user_id IS NOT NULL) AND (bot_slot IS NULL) AND (bot_target_xp IS NULL)))),
    CONSTRAINT lp_league_valid CHECK ((league = ANY (ARRAY['Beginner'::text, 'Amateur'::text, 'Professional'::text, 'Bronze'::text, 'Silver'::text, 'Gold'::text, 'Superstar'::text, 'Legendary'::text, 'Ultimate'::text]))),
    CONSTRAINT lp_xp_nonneg CHECK ((weekly_xp >= 0))
);


--
-- Name: join_league_competition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_league_competition() RETURNS public.league_participants
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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


--
-- Name: refresh_bots_in_group(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_bots_in_group(p_group_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: sync_league_weekly_xp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_league_weekly_xp() RETURNS public.league_participants
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: daily_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_progress (
    user_id uuid NOT NULL,
    progress_date date NOT NULL,
    minutes_learned integer DEFAULT 0 NOT NULL,
    xp_earned integer DEFAULT 0 NOT NULL,
    lessons_completed integer DEFAULT 0 NOT NULL,
    perfect_lessons integer DEFAULT 0 NOT NULL,
    mastered_lessons integer DEFAULT 0 NOT NULL,
    high_accuracy_lessons integer DEFAULT 0 NOT NULL,
    answer_streak_5_lessons integer DEFAULT 0 NOT NULL,
    practice_lessons integer DEFAULT 0 NOT NULL,
    timed_challenges integer DEFAULT 0 NOT NULL,
    reviewed_lessons integer DEFAULT 0 NOT NULL,
    chapter_reviews integer DEFAULT 0 NOT NULL,
    daily_goal_reward_claimed boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    high_accuracy_90_lessons integer DEFAULT 0 NOT NULL
);


--
-- Name: daily_quests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_quests (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    quest_date date NOT NULL,
    bronze_quest text,
    bronze_current integer DEFAULT 0,
    bronze_total integer DEFAULT 1,
    bronze_claimed boolean DEFAULT false,
    silver_quest text,
    silver_current integer DEFAULT 0,
    silver_total integer DEFAULT 1,
    silver_claimed boolean DEFAULT false,
    gold_quest text,
    gold_current integer DEFAULT 0,
    gold_total integer DEFAULT 1,
    gold_claimed boolean DEFAULT false
);


--
-- Name: follows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.follows (
    follower_id uuid NOT NULL,
    following_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT follows_check CHECK ((follower_id <> following_id))
);


--
-- Name: glossary_discoveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.glossary_discoveries (
    user_id uuid NOT NULL,
    course_id text NOT NULL,
    term text NOT NULL,
    discovered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: league_coin_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_coin_entitlements (
    user_id uuid NOT NULL,
    week_start date NOT NULL,
    amount integer NOT NULL,
    claimed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT league_coin_entitlements_amount_check CHECK ((amount >= 0))
);


--
-- Name: league_moods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_moods (
    user_id uuid NOT NULL,
    week_start date NOT NULL,
    emoji text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: league_other_reward_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_other_reward_entitlements (
    user_id uuid NOT NULL,
    week_start date NOT NULL,
    reward_type text NOT NULL,
    multiplier numeric,
    duration_min integer,
    claimed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lother_type_valid CHECK ((reward_type = ANY (ARRAY['heart_refill'::text, 'xp_boost'::text])))
);


--
-- Name: league_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_results (
    user_id uuid NOT NULL,
    week_start date NOT NULL,
    league text NOT NULL,
    final_rank integer NOT NULL,
    outcome text NOT NULL,
    next_league text NOT NULL,
    finalised_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lr_outcome_valid CHECK ((outcome = ANY (ARRAY['promoted'::text, 'retained'::text, 'relegated'::text])))
);


--
-- Name: league_weeks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_weeks (
    week_start date NOT NULL,
    week_end date NOT NULL,
    finalised boolean DEFAULT false NOT NULL,
    finalised_at timestamp with time zone,
    CONSTRAINT league_weeks_end_after_start CHECK ((week_end > week_start)),
    CONSTRAINT league_weeks_start_is_monday CHECK ((EXTRACT(isodow FROM week_start) = (1)::numeric))
);


--
-- Name: lesson_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lesson_progress (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    course_id text NOT NULL,
    lesson_id text NOT NULL,
    status text DEFAULT 'unstarted'::text,
    mastered boolean DEFAULT false,
    current_sublesson integer DEFAULT 1,
    completed_sublessons integer[] DEFAULT '{}'::integer[],
    mastered_sublessons integer[] DEFAULT '{}'::integer[],
    last_attempt_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    display_name text NOT NULL,
    email text NOT NULL,
    username text,
    country text,
    timezone text,
    age integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    daily_goal_minutes integer DEFAULT 5 NOT NULL,
    CONSTRAINT profiles_daily_goal_minutes_check CHECK ((daily_goal_minutes = ANY (ARRAY[5, 10, 15, 20])))
);


--
-- Name: quest_suggestion_dismissals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quest_suggestion_dismissals (
    user_id uuid NOT NULL,
    dismissed_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quest_suggestion_dismissals_check CHECK ((user_id <> dismissed_user_id))
);


--
-- Name: user_achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_achievements (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    achievement_key text NOT NULL,
    level integer DEFAULT 1,
    earned_at timestamp with time zone DEFAULT now(),
    claimed boolean DEFAULT false
);


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_preferences (
    user_id uuid NOT NULL,
    smart_reminder boolean DEFAULT true,
    reminder_hour integer DEFAULT 18,
    night_owl boolean DEFAULT true,
    early_bird boolean DEFAULT true,
    league_status boolean DEFAULT true,
    friends_quest boolean DEFAULT true,
    sound_effects boolean DEFAULT true,
    motivational_messages boolean DEFAULT true,
    pref_friends_quests boolean DEFAULT true,
    ad_tracking boolean DEFAULT true,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_records (
    user_id uuid NOT NULL,
    longest_streak integer DEFAULT 0,
    highest_league text DEFAULT 'Beginner'::text,
    perfect_lessons_in_day integer DEFAULT 0,
    most_xp_in_day integer DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now(),
    current_league text DEFAULT 'Beginner'::text NOT NULL
);


--
-- Name: user_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_stats (
    user_id uuid NOT NULL,
    coins integer DEFAULT 500,
    hearts integer DEFAULT 5,
    current_streak integer DEFAULT 0,
    longest_streak integer DEFAULT 0,
    total_xp integer DEFAULT 0,
    perfect_lessons integer DEFAULT 0,
    most_xp_in_day integer DEFAULT 0,
    highest_league text DEFAULT 'Beginner'::text,
    updated_at timestamp with time zone DEFAULT now(),
    last_lesson_date date,
    next_heart_at timestamp with time zone,
    perfect_week_count integer DEFAULT 0 NOT NULL,
    glossary_terms_discovered integer DEFAULT 0 NOT NULL,
    timed_challenge_xp integer DEFAULT 0 NOT NULL,
    night_owl_lessons integer DEFAULT 0 NOT NULL,
    early_bird_lessons integer DEFAULT 0 NOT NULL,
    master_challenges_completed integer DEFAULT 0 NOT NULL,
    quests_completed integer DEFAULT 0 NOT NULL,
    congratulations_sent integer DEFAULT 0 NOT NULL,
    corrections_made integer DEFAULT 0 NOT NULL,
    league_champion_count integer DEFAULT 0 NOT NULL,
    ultimate_champion_count integer DEFAULT 0 NOT NULL
);


--
-- Name: COLUMN user_stats.perfect_week_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stats.perfect_week_count IS 'Number of distinct 7-day streaks completed without a Streak Revival.';


--
-- Name: COLUMN user_stats.glossary_terms_discovered; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stats.glossary_terms_discovered IS 'Cumulative count of distinct glossary terms the user has opened.';


--
-- Name: COLUMN user_stats.timed_challenge_xp; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stats.timed_challenge_xp IS 'Total XP earned from timed-challenge lessons.';


--
-- Name: COLUMN user_stats.night_owl_lessons; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stats.night_owl_lessons IS 'Lessons completed between 00:00 and 02:59 local time.';


--
-- Name: COLUMN user_stats.early_bird_lessons; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stats.early_bird_lessons IS 'Lessons completed between 06:00 and 08:59 local time.';


--
-- Name: COLUMN user_stats.master_challenges_completed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stats.master_challenges_completed IS 'Mastery-mode lesson completions.';


--
-- Name: COLUMN user_stats.quests_completed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stats.quests_completed IS 'Daily quest chests the user has claimed.';


--
-- Name: COLUMN user_stats.congratulations_sent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stats.congratulations_sent IS 'Congratulation messages the user has sent to other users.';


--
-- Name: COLUMN user_stats.corrections_made; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stats.corrections_made IS 'Mistakes reviewed and corrected in the retry queue.';


--
-- Name: COLUMN user_stats.league_champion_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stats.league_champion_count IS 'Number of times the user has finished #1 in a league.';


--
-- Name: COLUMN user_stats.ultimate_champion_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stats.ultimate_champion_count IS 'Number of times the user has finished #1 in the Ultimate League.';


--
-- Name: daily_progress daily_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_progress
    ADD CONSTRAINT daily_progress_pkey PRIMARY KEY (user_id, progress_date);


--
-- Name: daily_quests daily_quests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_quests
    ADD CONSTRAINT daily_quests_pkey PRIMARY KEY (id);


--
-- Name: daily_quests daily_quests_user_id_quest_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_quests
    ADD CONSTRAINT daily_quests_user_id_quest_date_key UNIQUE (user_id, quest_date);


--
-- Name: follows follows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (follower_id, following_id);


--
-- Name: glossary_discoveries glossary_discoveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.glossary_discoveries
    ADD CONSTRAINT glossary_discoveries_pkey PRIMARY KEY (user_id, course_id, term);


--
-- Name: league_coin_entitlements league_coin_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_coin_entitlements
    ADD CONSTRAINT league_coin_entitlements_pkey PRIMARY KEY (user_id, week_start);


--
-- Name: league_moods league_moods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_moods
    ADD CONSTRAINT league_moods_pkey PRIMARY KEY (user_id, week_start);


--
-- Name: league_other_reward_entitlements league_other_reward_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_other_reward_entitlements
    ADD CONSTRAINT league_other_reward_entitlements_pkey PRIMARY KEY (user_id, week_start, reward_type);


--
-- Name: league_participants league_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_participants
    ADD CONSTRAINT league_participants_pkey PRIMARY KEY (id);


--
-- Name: league_results league_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_results
    ADD CONSTRAINT league_results_pkey PRIMARY KEY (user_id, week_start);


--
-- Name: league_weeks league_weeks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_weeks
    ADD CONSTRAINT league_weeks_pkey PRIMARY KEY (week_start);


--
-- Name: lesson_progress lesson_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_progress
    ADD CONSTRAINT lesson_progress_pkey PRIMARY KEY (id);


--
-- Name: lesson_progress lesson_progress_user_id_course_id_lesson_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_progress
    ADD CONSTRAINT lesson_progress_user_id_course_id_lesson_id_key UNIQUE (user_id, course_id, lesson_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_username_key UNIQUE (username);


--
-- Name: quest_suggestion_dismissals quest_suggestion_dismissals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quest_suggestion_dismissals
    ADD CONSTRAINT quest_suggestion_dismissals_pkey PRIMARY KEY (user_id, dismissed_user_id);


--
-- Name: user_achievements user_achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_pkey PRIMARY KEY (id);


--
-- Name: user_achievements user_achievements_user_id_achievement_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_user_id_achievement_key_key UNIQUE (user_id, achievement_key);


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: user_records user_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_records
    ADD CONSTRAINT user_records_pkey PRIMARY KEY (user_id);


--
-- Name: user_stats user_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stats
    ADD CONSTRAINT user_stats_pkey PRIMARY KEY (user_id);


--
-- Name: idx_daily_progress_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_progress_date ON public.daily_progress USING btree (progress_date);


--
-- Name: idx_dismissals_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dismissals_user_id ON public.quest_suggestion_dismissals USING btree (user_id);


--
-- Name: idx_follows_follower_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follows_follower_id ON public.follows USING btree (follower_id);


--
-- Name: idx_follows_following_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follows_following_id ON public.follows USING btree (following_id);


--
-- Name: idx_glossary_discoveries_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_glossary_discoveries_user ON public.glossary_discoveries USING btree (user_id);


--
-- Name: idx_lce_unclaimed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lce_unclaimed ON public.league_coin_entitlements USING btree (user_id) WHERE (claimed_at IS NULL);


--
-- Name: idx_lother_unclaimed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lother_unclaimed ON public.league_other_reward_entitlements USING btree (user_id) WHERE (claimed_at IS NULL);


--
-- Name: idx_lp_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_user ON public.league_participants USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_lp_week_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_week_group ON public.league_participants USING btree (week_start, group_id);


--
-- Name: idx_lp_week_league; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_week_league ON public.league_participants USING btree (week_start, league);


--
-- Name: idx_lr_user_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lr_user_week ON public.league_results USING btree (user_id, week_start DESC);


--
-- Name: uq_lp_bot_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_lp_bot_slot ON public.league_participants USING btree (group_id, bot_slot) WHERE (is_bot = true);


--
-- Name: uq_lp_user_week; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_lp_user_week ON public.league_participants USING btree (user_id, week_start) WHERE (user_id IS NOT NULL);


--
-- Name: daily_progress update_daily_progress_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_daily_progress_updated_at BEFORE UPDATE ON public.daily_progress FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: lesson_progress update_lesson_progress_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_lesson_progress_updated_at BEFORE UPDATE ON public.lesson_progress FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_records update_user_records_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_records_updated_at BEFORE UPDATE ON public.user_records FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_stats update_user_stats_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_stats_updated_at BEFORE UPDATE ON public.user_stats FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: daily_progress daily_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_progress
    ADD CONSTRAINT daily_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: daily_quests daily_quests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_quests
    ADD CONSTRAINT daily_quests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: follows follows_follower_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: follows follows_following_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_following_id_fkey FOREIGN KEY (following_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: glossary_discoveries glossary_discoveries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.glossary_discoveries
    ADD CONSTRAINT glossary_discoveries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: league_coin_entitlements league_coin_entitlements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_coin_entitlements
    ADD CONSTRAINT league_coin_entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: league_coin_entitlements league_coin_entitlements_week_start_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_coin_entitlements
    ADD CONSTRAINT league_coin_entitlements_week_start_fkey FOREIGN KEY (week_start) REFERENCES public.league_weeks(week_start) ON DELETE CASCADE;


--
-- Name: league_moods league_moods_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_moods
    ADD CONSTRAINT league_moods_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: league_moods league_moods_week_start_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_moods
    ADD CONSTRAINT league_moods_week_start_fkey FOREIGN KEY (week_start) REFERENCES public.league_weeks(week_start) ON DELETE CASCADE;


--
-- Name: league_other_reward_entitlements league_other_reward_entitlements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_other_reward_entitlements
    ADD CONSTRAINT league_other_reward_entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: league_other_reward_entitlements league_other_reward_entitlements_week_start_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_other_reward_entitlements
    ADD CONSTRAINT league_other_reward_entitlements_week_start_fkey FOREIGN KEY (week_start) REFERENCES public.league_weeks(week_start) ON DELETE CASCADE;


--
-- Name: league_participants league_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_participants
    ADD CONSTRAINT league_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: league_participants league_participants_week_start_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_participants
    ADD CONSTRAINT league_participants_week_start_fkey FOREIGN KEY (week_start) REFERENCES public.league_weeks(week_start) ON DELETE CASCADE;


--
-- Name: league_results league_results_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_results
    ADD CONSTRAINT league_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: league_results league_results_week_start_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_results
    ADD CONSTRAINT league_results_week_start_fkey FOREIGN KEY (week_start) REFERENCES public.league_weeks(week_start) ON DELETE CASCADE;


--
-- Name: lesson_progress lesson_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_progress
    ADD CONSTRAINT lesson_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: quest_suggestion_dismissals quest_suggestion_dismissals_dismissed_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quest_suggestion_dismissals
    ADD CONSTRAINT quest_suggestion_dismissals_dismissed_user_id_fkey FOREIGN KEY (dismissed_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: quest_suggestion_dismissals quest_suggestion_dismissals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quest_suggestion_dismissals
    ADD CONSTRAINT quest_suggestion_dismissals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_achievements user_achievements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_preferences user_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_records user_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_records
    ADD CONSTRAINT user_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_stats user_stats_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stats
    ADD CONSTRAINT user_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: quest_suggestion_dismissals Users can create dismissals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create dismissals" ON public.quest_suggestion_dismissals FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: follows Users can follow others; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can follow others" ON public.follows FOR INSERT WITH CHECK ((auth.uid() = follower_id));


--
-- Name: daily_progress Users can insert own daily progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own daily progress" ON public.daily_progress FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: glossary_discoveries Users can insert own discoveries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own discoveries" ON public.glossary_discoveries FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_preferences Users can insert own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own preferences" ON public.user_preferences FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_achievements Users can manage own achievements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own achievements" ON public.user_achievements USING ((auth.uid() = user_id));


--
-- Name: daily_quests Users can manage own daily quests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own daily quests" ON public.daily_quests USING ((auth.uid() = user_id));


--
-- Name: lesson_progress Users can manage own progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own progress" ON public.lesson_progress USING ((auth.uid() = user_id));


--
-- Name: user_records Users can manage own records; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own records" ON public.user_records USING ((auth.uid() = user_id));


--
-- Name: quest_suggestion_dismissals Users can remove dismissals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can remove dismissals" ON public.quest_suggestion_dismissals FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: follows Users can unfollow; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can unfollow" ON public.follows FOR DELETE USING ((auth.uid() = follower_id));


--
-- Name: daily_progress Users can update own daily progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own daily progress" ON public.daily_progress FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: user_preferences Users can update own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own preferences" ON public.user_preferences FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = id));


--
-- Name: user_stats Users can update own stats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own stats" ON public.user_stats FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: daily_progress Users can view own daily progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own daily progress" ON public.daily_progress FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: glossary_discoveries Users can view own discoveries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own discoveries" ON public.glossary_discoveries FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: quest_suggestion_dismissals Users can view own dismissals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own dismissals" ON public.quest_suggestion_dismissals FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: follows Users can view own follows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own follows" ON public.follows FOR SELECT USING (((auth.uid() = follower_id) OR (auth.uid() = following_id)));


--
-- Name: user_preferences Users can view own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own preferences" ON public.user_preferences FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: user_stats Users can view own stats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own stats" ON public.user_stats FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: daily_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_quests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_quests ENABLE ROW LEVEL SECURITY;

--
-- Name: follows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

--
-- Name: glossary_discoveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.glossary_discoveries ENABLE ROW LEVEL SECURITY;

--
-- Name: league_coin_entitlements lce_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lce_read ON public.league_coin_entitlements FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: league_coin_entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_coin_entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: league_moods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_moods ENABLE ROW LEVEL SECURITY;

--
-- Name: league_other_reward_entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_other_reward_entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: league_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: league_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_results ENABLE ROW LEVEL SECURITY;

--
-- Name: league_weeks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_weeks ENABLE ROW LEVEL SECURITY;

--
-- Name: lesson_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: league_moods lm_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lm_read ON public.league_moods FOR SELECT TO authenticated USING (true);


--
-- Name: league_moods lm_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lm_write ON public.league_moods TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: league_other_reward_entitlements lother_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lother_read ON public.league_other_reward_entitlements FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: league_participants lp_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lp_read ON public.league_participants FOR SELECT TO authenticated USING (true);


--
-- Name: league_results lr_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lr_read ON public.league_results FOR SELECT TO authenticated USING (true);


--
-- Name: league_weeks lw_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lw_read ON public.league_weeks FOR SELECT TO authenticated USING (true);


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: quest_suggestion_dismissals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quest_suggestion_dismissals ENABLE ROW LEVEL SECURITY;

--
-- Name: user_achievements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

--
-- Name: user_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: user_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_records ENABLE ROW LEVEL SECURITY;

--
-- Name: user_stats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict CchXrA3OfZzpkMUQtwpRcN2OfXt57AAY9WhJcbFozwDwzjHExkfqpg15sshWnuc

