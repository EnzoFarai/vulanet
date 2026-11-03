-- ============================================================
-- 0012_reading_collections_postcheck.sql
-- Read-only verification. Run after 0012_reading_collections.sql.
-- Each section prints PASS or FAIL.
-- ============================================================

-- 1. Five tables exist
SELECT '1. tables' AS check_name,
       CASE WHEN (
         SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN (
              'reading_bookmarks','reading_annotations',
              'reading_annotation_links','reading_collection_links',
              'reading_collection_order'
            )
       ) = 5 THEN 'PASS' ELSE 'FAIL' END AS result;

-- 2. Token column and default
SELECT '2a. token column' AS check_name,
       (SELECT data_type || ' / default=' ||
               coalesce(column_default, '<none>')
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'reading_annotation_links'
           AND column_name  = 'token') AS result;

SELECT '2b. token round-trip' AS check_name,
       CASE WHEN (SELECT public._random_token()) ~ '^[A-Za-z0-9_-]{22}$'
            THEN 'PASS' ELSE 'FAIL' END AS result;

-- 3. UNIQUE constraint on token (index provided by constraint, not a
--    separate CREATE INDEX)
SELECT '3. token UNIQUE constraint' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_catalog.pg_constraint
          WHERE conname = 'ral_token_unique'
            AND contype = 'u'
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

-- 4. reading_collection_links shape: visibility present, revoked_at
--    present, no token column, no legacy visible column
SELECT '4. collection link shape' AS check_name,
       CASE WHEN
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='reading_collection_links'
                    AND column_name='visibility' AND data_type='text' AND is_nullable='NO')
         AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='reading_collection_links'
                    AND column_name='revoked_at')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='reading_collection_links'
                    AND column_name IN ('token','visible'))
       THEN 'PASS' ELSE 'FAIL' END AS result;

-- 5. Visibility CHECK excludes 'restricted'
SELECT '5. visibility values' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_catalog.pg_constraint
          WHERE conname = 'rcl_visibility_valid'
            AND pg_catalog.pg_get_constraintdef(oid) NOT LIKE '%restricted%'
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

-- 6. Four functions exist with expected security mode
SELECT '6a. _random_token is INVOKER' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND proname='_random_token' AND NOT prosecdef
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

SELECT '6b. get_shared_reading_lesson is DEFINER' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND proname='get_shared_reading_lesson' AND prosecdef
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

SELECT '6c. get_collection_by_username is DEFINER' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND proname='get_collection_by_username' AND prosecdef
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

SELECT '6d. share_collection is INVOKER' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND proname='share_collection' AND NOT prosecdef
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

SELECT '6e. _reading_annotation_links_cleanup is DEFINER trigger fn' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND proname='_reading_annotation_links_cleanup'
           AND prosecdef AND prorettype = 'pg_catalog.trigger'::regtype
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

-- 7. share_collection grant matrix: authenticated yes, anon no, PUBLIC no
SELECT '7a. share_collection grants' AS check_name,
       coalesce(string_agg(DISTINCT grantee, ', '), '<none>') AS result
FROM information_schema.routine_privileges
WHERE routine_schema='public'
  AND routine_name='share_collection'
  AND privilege_type='EXECUTE';

SELECT '7b. share_collection not granted to anon or PUBLIC' AS check_name,
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM information_schema.routine_privileges
          WHERE routine_schema='public'
            AND routine_name='share_collection'
            AND grantee IN ('anon','PUBLIC')
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

-- 8. RLS enabled on all five tables
SELECT '8. RLS enabled' AS check_name,
       CASE WHEN (
         SELECT COUNT(*) FROM pg_catalog.pg_tables
          WHERE schemaname='public'
            AND tablename IN (
              'reading_bookmarks','reading_annotations',
              'reading_annotation_links','reading_collection_links',
              'reading_collection_order'
            )
            AND rowsecurity = true
       ) = 5 THEN 'PASS' ELSE 'FAIL' END AS result;

-- 9. Five owner policies present
SELECT '9. owner policies' AS check_name,
       CASE WHEN (
         SELECT COUNT(*) FROM pg_catalog.pg_policies
          WHERE schemaname='public' AND tablename LIKE 'reading_%'
       ) = 5 THEN 'PASS' ELSE 'FAIL' END AS result;

-- 10. search_path empty on all five functions
SELECT '10. search_path' AS check_name,
       CASE WHEN (
         SELECT COUNT(*) FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname='public'
            AND proname IN (
              '_random_token',
              'get_shared_reading_lesson',
              'get_collection_by_username',
              'share_collection',
              '_reading_annotation_links_cleanup'
            )
            AND pg_catalog.array_to_string(p.proconfig, ',') LIKE '%search_path=%'
       ) = 5 THEN 'PASS' ELSE 'FAIL' END AS result;

-- 11. Lifecycle trigger present on reading_annotations
SELECT '11. cleanup trigger' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_catalog.pg_trigger
          WHERE tgname = 'reading_annotations_cleanup_link'
            AND tgrelid = 'public.reading_annotations'::regclass
            AND NOT tgisinternal
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

-- 12. updated_at triggers present on the three tables with that column
SELECT '12. updated_at triggers' AS check_name,
       CASE WHEN (
         SELECT COUNT(*) FROM pg_catalog.pg_trigger
          WHERE tgname IN (
            'update_reading_bookmarks_updated_at',
            'update_reading_annotations_updated_at',
            'update_reading_collection_links_updated_at'
          )
            AND NOT tgisinternal
       ) = 3 THEN 'PASS' ELSE 'FAIL' END AS result;

-- 13. Baseline intact (17 pre-existing tables still present)
SELECT '13. baseline tables' AS check_name,
       CASE WHEN (
         SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema='public' AND table_type='BASE TABLE'
       ) >= 17 THEN 'PASS' ELSE 'FAIL' END AS result;