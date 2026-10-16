--
-- PostgreSQL database dump
--

\restrict 4fGKf3aVDwzWIBWvSe9FzIGhJlt8WnQ1wQkcoi13E3zUu0bPlgf2aQr0NcllRsO

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


SET default_tablespace = '';

SET default_table_access_method = heap;

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
    updated_at timestamp with time zone DEFAULT now()
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
    next_heart_at timestamp with time zone
);


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
-- Name: lesson_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;

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

\unrestrict 4fGKf3aVDwzWIBWvSe9FzIGhJlt8WnQ1wQkcoi13E3zUu0bPlgf2aQr0NcllRsO

