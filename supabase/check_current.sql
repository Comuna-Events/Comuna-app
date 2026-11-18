-- Comuna: checks that each owned function and view (see supabase/README.md) is the current version.
-- Safe to run any time: it only reads. Run it after any SQL file; every row should say OK.
-- WRONG means an older definition got back in: re-run that object's owner file (named in the second column).

select check_name, owner_file, case when ok then 'OK' else 'WRONG' end as result, note
from (
  select 'leaderboard_top returns titles and leaves out hidden people' as check_name, 'leaderboard_names.sql' as owner_file,
         coalesce(pg_get_functiondef(to_regprocedure('public.leaderboard_top(text, int)')) like '%title%'
              and pg_get_functiondef(to_regprocedure('public.leaderboard_top(text, int)')) like '%lb_show%', false) as ok,
         'If WRONG, real names may be public. Run leaderboard_names.sql now.' as note
  union all
  select 'promote_candidate carries price_detail', 'price_detail.sql',
         coalesce(pg_get_functiondef(to_regprocedure('ingest.promote_candidate(bigint)')) like '%price_detail%', false),
         'If WRONG, promoted events lose their price text.'
  union all
  select 'events_request_geocode has the skip switch', 'event_autopromote.sql',
         coalesce(pg_get_functiondef(to_regprocedure('public.events_request_geocode()')) like '%skip_geocode%', false),
         'If WRONG, a big promote fires one geocode request per insert.'
  union all
  select 'event_stats has the guest columns', 'guests.sql',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'event_stats' and column_name = 'guest_views'),
         'Run guests.sql.'
  union all
  select 'search_terms has the guest columns', 'guests.sql',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'search_terms' and column_name = 'guest_searches'),
         'Run guests.sql.'
  union all
  select 'leaderboard_month exists', 'points_rules.sql',
         to_regclass('public.leaderboard_month') is not null,
         'Run points_rules.sql.'
  union all
  select 'regions has Los Angeles', 'regions.sql',
         coalesce((select true from public.regions where id = 'la'), false),
         'Run regions.sql.'
  union all
  select 'events, sources and candidates have a region column', 'regions.sql',
         (select count(*) from information_schema.columns
          where column_name = 'region'
            and ((table_schema = 'public' and table_name = 'events')
              or (table_schema = 'ingest' and table_name in ('event_sources', 'event_candidates')))) = 3,
         'Run regions.sql.'
) c
order by 3, 1;

-- Not a pass/fail: when the leaderboard starts counting from. '-infinity' = all time (leaderboard_all_time.sql).
select public.leaderboard_start() as leaderboard_counts_from;
