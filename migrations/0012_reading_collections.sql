-- ============================================================
-- migrations/0012_reading_collections.sql
--
-- Reading bookmarks, per-user annotations, personalised
-- annotated-lesson sharing, and username-keyed collections.
--
-- SAFETY CONTRACT
--   • Additive only. Does not alter, drop or rename any existing
--     table, column, function, policy or trigger.
--   • Fail-loud. No CREATE TABLE IF NOT EXISTS, no CREATE OR REPLACE,
--     no DROP ... IF EXISTS. If any target object already exists, this
--     file aborts with a specific error naming the conflict.
--   • Atomic. Wrapped in BEGIN/COMMIT. A mid-file failure rolls back
--     cleanly; the database is left unchanged.
--   • Every SECURITY DEFINER function uses SET search_path = '' and
--     fully schema-qualifies every reference (pg_catalog.*, public.*,
--     extensions.*, auth.uid()).
--   • No dynamic SQL.
--   • pgcrypto schema is verified, not assumed.
--
-- Run this file's entire contents as a single submission in the
-- Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- GUARD 1: pgcrypto must exist in the extensions schema
-- ------------------------------------------------------------
DO $$
DECLARE
  v_schema text;
BEGIN
  SELECT n.nspname INTO v_schema
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'pgcrypto';

  IF v_schema IS NULL THEN
    RAISE EXCEPTION
      'pgcrypto extension is not installed. Install with: CREATE EXTENSION pgcrypto WITH SCHEMA extensions;';
  END IF;

  IF v_schema <> 'extensions' THEN
    RAISE EXCEPTION
      'pgcrypto is installed in schema "%" but this migration expects "extensions". Adjust the schema reference inside _random_token() before running.', v_schema;
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- GUARD 2: no target object may already exist
-- ------------------------------------------------------------
DO $$
DECLARE
  v_conflict text;
BEGIN
  SELECT pg_catalog.string_agg(name, ', ') INTO v_conflict FROM (
    SELECT table_name AS name
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name LIKE 'reading\_%' ESCAPE '\'
    UNION ALL
    SELECT proname
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND proname IN (
         '_random_token',
         'get_shared_reading_lesson',
         'get_collection_by_username',
         'share_collection',
         '_reading_annotation_links_cleanup',
         '_reading_annotations_ensure_link',
         '_reading_annotations_identity_guard',
         'revoke_annotation_link',
         'reshare_annotation_link'
       )
  ) t;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot run 0012: the following objects already exist in public schema: %. Refusing to proceed.', v_conflict;
  END IF;
END;
$$;

-- ============================================================
-- HELPER: cryptographic 128-bit Base64URL token generator
-- Returns exactly 22 characters matching ^[A-Za-z0-9_-]{22}$
-- ============================================================
CREATE FUNCTION public._random_token()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.replace(
           pg_catalog.replace(
             pg_catalog.rtrim(
               pg_catalog.encode(extensions.gen_random_bytes(16), 'base64'),
               '='
             ),
             '+', '-'
           ),
           '/', '_'
         );
$$;

REVOKE ALL ON FUNCTION public._random_token() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._random_token() FROM anon;
REVOKE ALL ON FUNCTION public._random_token() FROM authenticated;
GRANT EXECUTE ON FUNCTION public._random_token() TO service_role;

-- ============================================================
-- TABLE 1: reading_bookmarks
-- ============================================================
CREATE TABLE public.reading_bookmarks (
  owner_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id   text        NOT NULL,
  lesson_id   text        NOT NULL,
  sort_index  numeric,
  created_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (owner_id, course_id, lesson_id),
  CONSTRAINT rb_course_len CHECK (pg_catalog.length(course_id) BETWEEN 1 AND 120),
  CONSTRAINT rb_lesson_len CHECK (pg_catalog.length(lesson_id) BETWEEN 1 AND 120)
);

CREATE INDEX reading_bookmarks_owner_recent
  ON public.reading_bookmarks (owner_id, created_at DESC);

ALTER TABLE public.reading_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY reading_bookmarks_owner ON public.reading_bookmarks
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE TRIGGER update_reading_bookmarks_updated_at
  BEFORE UPDATE ON public.reading_bookmarks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON TABLE public.reading_bookmarks FROM PUBLIC;
REVOKE ALL ON TABLE public.reading_bookmarks FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_bookmarks TO authenticated;
GRANT ALL ON public.reading_bookmarks TO service_role;

-- ============================================================
-- TABLE 2: reading_annotations
-- ============================================================
CREATE TABLE public.reading_annotations (
  id           uuid        NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  owner_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id    text        NOT NULL,
  lesson_id    text        NOT NULL,
  kind         text        NOT NULL,
  start_offset integer     NOT NULL,
  end_offset   integer     NOT NULL,
  quote        text        NOT NULL,
  body         text        NOT NULL DEFAULT '',
  color        text,
  created_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (id),
  CONSTRAINT ra_kind_valid       CHECK (kind IN ('highlight','note')),
  CONSTRAINT ra_start_nonneg     CHECK (start_offset >= 0),
  CONSTRAINT ra_range_reasonable CHECK (end_offset > start_offset AND (end_offset - start_offset) <= 10000),
  CONSTRAINT ra_course_len       CHECK (pg_catalog.length(course_id) BETWEEN 1 AND 120),
  CONSTRAINT ra_lesson_len       CHECK (pg_catalog.length(lesson_id) BETWEEN 1 AND 120),
  CONSTRAINT ra_kind_color_body  CHECK (
    (kind = 'highlight'
       AND color IS NOT NULL
       AND color IN ('bee','boa','gecko','ladybug','tiger','beetle')
       AND body = '')
    OR
    (kind = 'note'
       AND color IS NULL)
  )
);

CREATE INDEX reading_annotations_owner_lesson_recent
  ON public.reading_annotations (owner_id, course_id, lesson_id, updated_at DESC);

ALTER TABLE public.reading_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY reading_annotations_owner ON public.reading_annotations
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE TRIGGER update_reading_annotations_updated_at
  BEFORE UPDATE ON public.reading_annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON TABLE public.reading_annotations FROM PUBLIC;
REVOKE ALL ON TABLE public.reading_annotations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_annotations TO authenticated;
GRANT ALL ON public.reading_annotations TO service_role;

-- ============================================================
-- TABLE 3: reading_annotation_links
-- No FK to reading_annotations. Lifecycle managed by trigger.
-- ============================================================
CREATE TABLE public.reading_annotation_links (
  owner_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id   text        NOT NULL,
  lesson_id   text        NOT NULL,
  token       text        NOT NULL DEFAULT public._random_token(),
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (owner_id, course_id, lesson_id),
  CONSTRAINT ral_token_unique UNIQUE (token),
  CONSTRAINT ral_token_shape  CHECK (token ~ '^[A-Za-z0-9_-]{22}$'),
  CONSTRAINT ral_course_len   CHECK (pg_catalog.length(course_id) BETWEEN 1 AND 120),
  CONSTRAINT ral_lesson_len   CHECK (pg_catalog.length(lesson_id) BETWEEN 1 AND 120)
);

ALTER TABLE public.reading_annotation_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY reading_annotation_links_owner ON public.reading_annotation_links
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

REVOKE ALL ON TABLE public.reading_annotation_links FROM PUBLIC;
REVOKE ALL ON TABLE public.reading_annotation_links FROM anon;
-- Clients may read their own links; writes go through SECURITY DEFINER
-- triggers and lifecycle RPCs. SELECT-only is the design intent.
GRANT SELECT ON public.reading_annotation_links TO authenticated;
GRANT ALL ON public.reading_annotation_links TO service_role;

-- ============================================================
-- TABLE 4: reading_collection_links
-- ============================================================
CREATE TABLE public.reading_collection_links (
  owner_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text        NOT NULL,
  visibility  text        NOT NULL DEFAULT 'private',
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (owner_id, kind),
  CONSTRAINT rcl_kind_valid       CHECK (kind IN ('bookmarks','highlights','notes')),
  CONSTRAINT rcl_visibility_valid CHECK (visibility IN ('private','public'))
);

ALTER TABLE public.reading_collection_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY reading_collection_links_owner ON public.reading_collection_links
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE TRIGGER update_reading_collection_links_updated_at
  BEFORE UPDATE ON public.reading_collection_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON TABLE public.reading_collection_links FROM PUBLIC;
REVOKE ALL ON TABLE public.reading_collection_links FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_collection_links TO authenticated;
GRANT ALL ON public.reading_collection_links TO service_role;

-- ============================================================
-- TABLE 5: reading_collection_order
-- ============================================================
CREATE TABLE public.reading_collection_order (
  owner_id    uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text    NOT NULL,
  course_id   text    NOT NULL,
  lesson_id   text    NOT NULL,
  sort_index  integer NOT NULL,
  PRIMARY KEY (owner_id, kind, course_id, lesson_id),
  CONSTRAINT rco_kind_valid  CHECK (kind IN ('highlights','notes')),
  CONSTRAINT rco_course_len  CHECK (pg_catalog.length(course_id) BETWEEN 1 AND 120),
  CONSTRAINT rco_lesson_len  CHECK (pg_catalog.length(lesson_id) BETWEEN 1 AND 120)
);

ALTER TABLE public.reading_collection_order ENABLE ROW LEVEL SECURITY;

CREATE POLICY reading_collection_order_owner ON public.reading_collection_order
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

REVOKE ALL ON TABLE public.reading_collection_order FROM PUBLIC;
REVOKE ALL ON TABLE public.reading_collection_order FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_collection_order TO authenticated;
GRANT ALL ON public.reading_collection_order TO service_role;

-- ============================================================
-- TRIGGER FUNCTION 1: _reading_annotation_links_cleanup
-- AFTER DELETE on reading_annotations. Removes the link row when
-- the last annotation for that lesson is deleted. Preserves a
-- revoked-but-still-annotated link, since cleanup only fires when
-- count = 0.
-- ============================================================
CREATE FUNCTION public._reading_annotation_links_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.reading_annotations
     WHERE owner_id  = OLD.owner_id
       AND course_id = OLD.course_id
       AND lesson_id = OLD.lesson_id
  ) THEN
    DELETE FROM public.reading_annotation_links
     WHERE owner_id  = OLD.owner_id
       AND course_id = OLD.course_id
       AND lesson_id = OLD.lesson_id;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._reading_annotation_links_cleanup() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._reading_annotation_links_cleanup() FROM anon;
REVOKE ALL ON FUNCTION public._reading_annotation_links_cleanup() FROM authenticated;

-- ============================================================
-- TRIGGER FUNCTION 2: _reading_annotations_ensure_link
-- AFTER INSERT on reading_annotations. Ensures a link row exists
-- with a valid token. Does not clear revoked_at (revocation is
-- sticky until reshare_annotation_link).
-- ============================================================
CREATE FUNCTION public._reading_annotations_ensure_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.reading_annotation_links (owner_id, course_id, lesson_id)
  VALUES (NEW.owner_id, NEW.course_id, NEW.lesson_id)
  ON CONFLICT (owner_id, course_id, lesson_id) DO NOTHING;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._reading_annotations_ensure_link() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._reading_annotations_ensure_link() FROM anon;
REVOKE ALL ON FUNCTION public._reading_annotations_ensure_link() FROM authenticated;

-- ============================================================
-- TRIGGER FUNCTION 3: _reading_annotations_identity_guard
-- BEFORE UPDATE on reading_annotations. Prevents modification of
-- identity and range fields. Body and color remain mutable.
-- ============================================================
CREATE FUNCTION public._reading_annotations_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.owner_id     IS DISTINCT FROM NEW.owner_id
  OR OLD.course_id    IS DISTINCT FROM NEW.course_id
  OR OLD.lesson_id    IS DISTINCT FROM NEW.lesson_id
  OR OLD.kind         IS DISTINCT FROM NEW.kind
  OR OLD.start_offset IS DISTINCT FROM NEW.start_offset
  OR OLD.end_offset   IS DISTINCT FROM NEW.end_offset
  OR OLD.quote        IS DISTINCT FROM NEW.quote
  THEN
    RAISE EXCEPTION
      'Cannot modify identity fields (owner_id, course_id, lesson_id, kind, start_offset, end_offset, quote) of an existing annotation.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._reading_annotations_identity_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._reading_annotations_identity_guard() FROM anon;
REVOKE ALL ON FUNCTION public._reading_annotations_identity_guard() FROM authenticated;

-- Attach triggers
CREATE TRIGGER reading_annotations_cleanup_link
  AFTER DELETE ON public.reading_annotations
  FOR EACH ROW
  EXECUTE FUNCTION public._reading_annotation_links_cleanup();

CREATE TRIGGER reading_annotations_ensure_link
  AFTER INSERT ON public.reading_annotations
  FOR EACH ROW
  EXECUTE FUNCTION public._reading_annotations_ensure_link();

CREATE TRIGGER reading_annotations_identity_guard
  BEFORE UPDATE ON public.reading_annotations
  FOR EACH ROW
  EXECUTE FUNCTION public._reading_annotations_identity_guard();

-- ============================================================
-- RPC 1: get_shared_reading_lesson(p_token text)
-- Returns:
--   NULL                       → invalid token, or zero annotations
--   {"status":"revoked"}       → revoked link
--   {"status":"ok","data":{…}} → active link with annotations
-- ============================================================
CREATE FUNCTION public.get_shared_reading_lesson(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row         record;
  v_owner_name  text;
  v_annotations jsonb;
BEGIN
  IF p_token IS NULL OR pg_catalog.length(p_token) <> 22 THEN
    RETURN NULL;
  END IF;

  SELECT owner_id, course_id, lesson_id, revoked_at
    INTO v_row
    FROM public.reading_annotation_links
   WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_row.revoked_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'revoked');
  END IF;

  SELECT coalesce(
           nullif(p.display_name, ''),
           nullif(p.username, ''),
           'Vulanet reader'
         )
    INTO v_owner_name
    FROM public.profiles p
   WHERE p.id = v_row.owner_id;

  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id',           a.id,
               'kind',         a.kind,
               'start_offset', a.start_offset,
               'end_offset',   a.end_offset,
               'quote',        a.quote,
               'body',         a.body,
               'color',        a.color,
               'updated_at',   a.updated_at
             ) ORDER BY a.created_at
           ),
           '[]'::jsonb
         )
    INTO v_annotations
    FROM public.reading_annotations a
   WHERE a.owner_id  = v_row.owner_id
     AND a.course_id = v_row.course_id
     AND a.lesson_id = v_row.lesson_id;

  IF pg_catalog.jsonb_array_length(v_annotations) = 0 THEN
    RETURN NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'ok',
    'data',   pg_catalog.jsonb_build_object(
      'course_id',   v_row.course_id,
      'lesson_id',   v_row.lesson_id,
      'owner_name',  v_owner_name,
      'annotations', v_annotations
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shared_reading_lesson(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_reading_lesson(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shared_reading_lesson(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_reading_lesson(text) TO service_role;

-- ============================================================
-- RPC 2: get_collection_by_username(p_username text, p_kind text)
-- Uniform {"status":"denied"} for every deny reason.
-- Honours sort_index from reading_bookmarks and
-- reading_collection_order.
-- ============================================================
CREATE FUNCTION public.get_collection_by_username(p_username text, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_owner       uuid;
  v_link        record;
  v_owner_name  text;
  v_items       jsonb;
  v_is_owner    boolean := false;
  v_shared      boolean := false;
  v_kind_ann    text;
BEGIN
  IF p_username IS NULL
     OR p_kind IS NULL
     OR p_kind NOT IN ('bookmarks','highlights','notes') THEN
    RETURN pg_catalog.jsonb_build_object('status', 'denied');
  END IF;

  SELECT id INTO v_owner FROM public.profiles WHERE username = p_username;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'denied');
  END IF;

  IF v_uid IS NOT NULL AND v_uid = v_owner THEN
    v_is_owner := true;
    SELECT visibility, revoked_at INTO v_link
      FROM public.reading_collection_links
     WHERE owner_id = v_owner AND kind = p_kind;
    v_shared := FOUND
                AND v_link.visibility = 'public'
                AND v_link.revoked_at IS NULL;
  ELSE
    SELECT visibility, revoked_at INTO v_link
      FROM public.reading_collection_links
     WHERE owner_id = v_owner AND kind = p_kind;
    IF NOT FOUND
       OR v_link.visibility <> 'public'
       OR v_link.revoked_at IS NOT NULL THEN
      RETURN pg_catalog.jsonb_build_object('status', 'denied');
    END IF;
    v_shared := true;
  END IF;

  SELECT coalesce(
           nullif(p.display_name, ''),
           nullif(p.username, ''),
           'Vulanet reader'
         )
    INTO v_owner_name
    FROM public.profiles p
   WHERE p.id = v_owner;

  IF p_kind = 'bookmarks' THEN
    SELECT coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'course_id',  b.course_id,
                 'lesson_id',  b.lesson_id,
                 'updated_at', b.updated_at
               ) ORDER BY b.sort_index ASC NULLS LAST, b.created_at DESC
             ),
             '[]'::jsonb
           )
      INTO v_items
      FROM public.reading_bookmarks b
     WHERE b.owner_id = v_owner;
  ELSE
    v_kind_ann := CASE WHEN p_kind = 'notes' THEN 'note' ELSE 'highlight' END;
    SELECT coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'course_id',  x.course_id,
                 'lesson_id',  x.lesson_id,
                 'updated_at', x.updated_at
               ) ORDER BY co.sort_index ASC NULLS LAST, x.updated_at DESC
             ),
             '[]'::jsonb
           )
      INTO v_items
      FROM (
        SELECT a.course_id, a.lesson_id,
               pg_catalog.max(a.updated_at) AS updated_at
          FROM public.reading_annotations a
         WHERE a.owner_id = v_owner
           AND a.kind     = v_kind_ann
         GROUP BY a.course_id, a.lesson_id
      ) x
      LEFT JOIN public.reading_collection_order co
        ON co.owner_id  = v_owner
       AND co.kind      = p_kind
       AND co.course_id = x.course_id
       AND co.lesson_id = x.lesson_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'ok',
    'data',   pg_catalog.jsonb_build_object(
      'kind',       p_kind,
      'owner_name', v_owner_name,
      'is_owner',   v_is_owner,
      'shared',     v_shared,
      'items',      v_items
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_collection_by_username(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_collection_by_username(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_collection_by_username(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_collection_by_username(text, text) TO service_role;

-- ============================================================
-- RPC 3: share_collection(p_kind text) — SECURITY INVOKER
-- Requires auth.uid(). Relies on RLS + grants for authorization.
-- ============================================================
CREATE FUNCTION public.share_collection(p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'share_collection: not authenticated';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('bookmarks','highlights','notes') THEN
    RAISE EXCEPTION 'share_collection: invalid kind %', p_kind;
  END IF;

  INSERT INTO public.reading_collection_links
    (owner_id, kind, visibility, revoked_at)
  VALUES
    (v_uid, p_kind, 'public', NULL)
  ON CONFLICT (owner_id, kind) DO UPDATE
    SET visibility = 'public',
        revoked_at = NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.share_collection(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.share_collection(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.share_collection(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.share_collection(text) TO service_role;

-- ============================================================
-- RPC 4: revoke_annotation_link(course, lesson) — SECURITY DEFINER
-- Sets revoked_at = now(). Scoped to auth.uid() via WHERE clause.
-- ============================================================
CREATE FUNCTION public.revoke_annotation_link(p_course_id text, p_lesson_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'revoke_annotation_link: not authenticated';
  END IF;

  UPDATE public.reading_annotation_links
     SET revoked_at = pg_catalog.now()
   WHERE owner_id  = v_uid
     AND course_id = p_course_id
     AND lesson_id = p_lesson_id;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_annotation_link(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_annotation_link(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_annotation_link(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_annotation_link(text, text) TO service_role;

-- ============================================================
-- RPC 5: reshare_annotation_link(course, lesson) — SECURITY DEFINER
-- Generates a new token, clears revoked_at, returns the token.
-- Raises if no link exists. Scoped to auth.uid() via WHERE clause.
-- ============================================================
CREATE FUNCTION public.reshare_annotation_link(p_course_id text, p_lesson_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_token text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'reshare_annotation_link: not authenticated';
  END IF;

  UPDATE public.reading_annotation_links
     SET token      = public._random_token(),
         revoked_at = NULL
   WHERE owner_id  = v_uid
     AND course_id = p_course_id
     AND lesson_id = p_lesson_id
   RETURNING token INTO v_token;

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'reshare_annotation_link: no link exists for that lesson';
  END IF;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.reshare_annotation_link(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reshare_annotation_link(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reshare_annotation_link(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reshare_annotation_link(text, text) TO service_role;

COMMIT;
