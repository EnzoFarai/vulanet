-- ============================================================
-- 0012_reading_collections_preflight.sql
-- Read-only diagnostic. Modifies nothing. Safe on live.
-- Answers: "Is it safe to run 0012_reading_collections.sql yet?"
-- ============================================================

-- 1. Existing reading_* tables (expected: 0 rows)
SELECT '1. reading_* tables' AS check_name,
       coalesce(string_agg(table_name, ', ' ORDER BY table_name), '<none>') AS result
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'reading_%';

-- 2. Conflicting target functions (expected: 0 rows)
SELECT '2. reading_* functions' AS check_name,
       coalesce(string_agg(proname, ', ' ORDER BY proname), '<none>') AS result
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN (
    '_random_token',
    'share_collection',
    'get_collection_by_username',
    'get_shared_reading_lesson',
    '_reading_annotation_links_cleanup'
  );

-- 3. pgcrypto availability and schema
SELECT '3. pgcrypto' AS check_name,
       coalesce(
         (SELECT n.nspname
            FROM pg_catalog.pg_extension e
            JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
           WHERE e.extname = 'pgcrypto'),
         '<not installed>'
       ) AS result;

-- 4. gen_random_uuid availability (built-in since PG 13)
SELECT '4. gen_random_uuid' AS check_name,
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_catalog.pg_proc p
                JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'pg_catalog' AND proname = 'gen_random_uuid'
            ) THEN 'available' ELSE '<missing>' END AS result;

-- 5. Baseline counts
SELECT '5a. public base tables' AS check_name, COUNT(*)::text AS result
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

SELECT '5b. public functions' AS check_name, COUNT(*)::text AS result
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public';

SELECT '5c. SECURITY DEFINER functions' AS check_name, COUNT(*)::text AS result
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef = true;

-- 6. Event-trigger drift (informational; do not act)
SELECT '6. ensure_rls event trigger' AS check_name,
       coalesce(string_agg(evtname, ', '), '<absent>') AS result
FROM pg_catalog.pg_event_trigger
WHERE evtname = 'ensure_rls';

-- 7. Orphan grants on reading_* (expected: 0 rows)
SELECT '7. reading_* grants' AS check_name,
       coalesce(string_agg(DISTINCT grantee || ':' || privilege_type, ', '), '<none>') AS result
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name LIKE 'reading_%';

-- 8. Orphan policies on reading_* (expected: 0 rows)
SELECT '8. reading_* policies' AS check_name,
       coalesce(string_agg(policyname, ', ' ORDER BY policyname), '<none>') AS result
FROM pg_catalog.pg_policies
WHERE schemaname = 'public' AND tablename LIKE 'reading_%';

-- 9. Execution context
SELECT '9. current_user' AS check_name, current_user::text AS result;
SELECT '9b. session_user' AS check_name, session_user::text AS result;

-- 10. PostgreSQL version
SELECT '10. version' AS check_name, version() AS result;

-- 11. Verdict — covers tables AND target functions
SELECT '11. verdict' AS check_name,
       CASE
         WHEN EXISTS (
           SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name LIKE 'reading_%'
         )
         OR EXISTS (
           SELECT 1 FROM pg_catalog.pg_proc p
             JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND proname IN (
                '_random_token',
                'share_collection',
                'get_collection_by_username',
                'get_shared_reading_lesson',
                '_reading_annotation_links_cleanup'
              )
         )
         THEN 'STOP — conflicting objects exist; do not run 0012'
         ELSE 'PROCEED — clean slate; safe to run 0012'
       END AS result;