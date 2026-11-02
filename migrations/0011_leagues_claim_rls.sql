-- ============================================================
-- 0011_leagues_claim_rls.sql
-- Missing UPDATE policies on the two league entitlement tables.
--
-- Background
-- ----------
-- Migration 0010 created league_coin_entitlements and
-- league_other_reward_entitlements with SELECT-only RLS:
--
--     lce_read    — SELECT on league_coin_entitlements
--     lother_read — SELECT on league_other_reward_entitlements
--
-- The client-side helpers in supabase.js —
-- markCoinEntitlementsClaimed() and markOtherRewardClaimed() —
-- call .update({ claimed_at: now() }) against these tables. With
-- no UPDATE policy, PostgREST returns HTTP 200 with 0 rows
-- affected. The Supabase JS client does NOT treat this as an
-- error, so the helpers log success, return true, and the
-- entitlements stay at claimed_at = NULL on the server forever.
--
-- Symptoms observed
-- -----------------
-- 1. The league-results modal re-surfaces on every visit,
--    because leaderboard.html's re-surface rule is "unclaimed
--    entitlements remain".
--
-- 2. REPEATABLE, UNBOUNDED COIN INFLATION in the pre-0011
--    credit-first rewards flow. Without an UPDATE policy:
--
--        incrementCoins(total)               → succeeds
--        coins-reward modal                  → opens, user closes
--        markCoinEntitlementsClaimed(...)    → silently no-ops
--
--    Because the mark never lands, the same entitlement remains
--    at claimed_at = NULL. Every subsequent visit re-credits the
--    same claim. Any user who reloads the leaderboard after
--    claiming inflates their coin balance linearly with reload
--    count. No cleverness required — ordinary navigation
--    triggers the bug. This is the ACTUAL severity of the RLS
--    gap; the re-surface annoyance in (1) is only the visible
--    symptom, but (2) is what makes the missing policy
--    damaging to the coin economy.
--
-- 3. Note on the mark-first reordering (shipped alongside this
--    migration in leaderboard.html + supabase.js): mark-first
--    alone does not resolve the underlying RLS gap. Without the
--    UPDATE policy below, the initial mark would no-op and the
--    flow would skip the credit entirely — turning the coin
--    inflation bug in (2) into a silent UNDER-DELIVERY bug.
--    Both changes ship together. This migration is the actual
--    fix; the mark-first reordering is the correctness
--    improvement on top of it.
--
-- This is NOT the accepted decision-(A) annoyance (positions
-- 11–20 who never claim their heart refill). That annoyance is
-- real but separate and persists even with this migration.
--
-- Design
-- ------
-- 1. UPDATE-only, NOT FOR ALL.
--      Entitlements are created exclusively by
--      finalize_league_week(), which is SECURITY DEFINER and
--      bypasses RLS. Users must never be able to INSERT a new
--      entitlement or DELETE an existing one.
--
-- 2. WITH CHECK alongside USING.
--      USING gates which rows the user can target.
--      WITH CHECK gates the post-update row. Without it, a user
--      could UPDATE their own row and set user_id to another
--      user's id, moving the row out of their own scope. WITH
--      CHECK closes that.
--
-- 3. Precedent.
--      league_moods already carries lm_write, which is a
--      FOR ALL policy scoped by auth.uid() = user_id. This
--      migration follows the same shape but is deliberately
--      UPDATE-only (see point 1).
--
-- Idempotent: DROP POLICY IF EXISTS then CREATE POLICY. Safe
-- to re-run.
-- ============================================================

DROP POLICY IF EXISTS lce_update ON public.league_coin_entitlements;
CREATE POLICY lce_update ON public.league_coin_entitlements
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS lother_update ON public.league_other_reward_entitlements;
CREATE POLICY lother_update ON public.league_other_reward_entitlements
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);