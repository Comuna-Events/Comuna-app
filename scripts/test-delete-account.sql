-- Run in Supabase > SQL Editor to check supabase/delete_account.sql against the live database.
-- Nothing is saved: everything runs in one transaction that ends in an error, which rolls it all back.
-- The error message is the test report; every line should read as expected (see the end of this file).
begin;

-- supabase/delete_account.sql, as it would be applied
alter table public.event_submissions alter column user_id drop not null;
alter table public.event_submissions drop constraint if exists event_submissions_user_id_fkey;
alter table public.event_submissions add constraint event_submissions_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in to delete your account.'; end if;
  delete from event_submissions where user_id = uid and status is distinct from 'approved';
  delete from auth.users where id = uid;
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

create temp table results (n serial, name text, outcome text);
create temp table before_others as select
  (select count(*) from profiles) as profiles, (select count(*) from checkins) as checkins, (select count(*) from rsvps) as rsvps,
  (select count(*) from auth.users) as users, (select count(*) from leaderboard_month) as lb_rows;

-- a throwaway user with one of everything
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000dead', 'delete-test@example.test');
insert into profiles (id, name, neighborhood, points) values ('00000000-0000-4000-8000-00000000dead', 'Test Person', 'Silver Lake', 500);
insert into rsvps (user_id, event_id, occurrence_date) values ('00000000-0000-4000-8000-00000000dead', 'EVT-1500', current_date);
insert into checkins (user_id, event_id, distance_m, checkin_date) values ('00000000-0000-4000-8000-00000000dead', 'EVT-1500', 10, current_date);
insert into feedback (user_id) values ('00000000-0000-4000-8000-00000000dead');
insert into event_actions (user_id, event_id, action) values ('00000000-0000-4000-8000-00000000dead', 'EVT-1500', 'view');
insert into search_queries (user_id, query) values ('00000000-0000-4000-8000-00000000dead', 'jazz');
insert into guest_sessions (device_id, converted_user_id) values ('00000000-0000-4000-8000-0000000d0dad', '00000000-0000-4000-8000-00000000dead');
insert into event_submissions (user_id, link, title, status) values
  ('00000000-0000-4000-8000-00000000dead', 'https://example.test/a', 'TEST approved event', 'approved'),
  ('00000000-0000-4000-8000-00000000dead', 'https://example.test/p', 'TEST pending event', 'pending'),
  ('00000000-0000-4000-8000-00000000dead', 'https://example.test/r', 'TEST rejected event', 'rejected');
insert into results (name, outcome) select 'test user on leaderboard before', count(*)::text from leaderboard_month where user_id = '00000000-0000-4000-8000-00000000dead';

-- signed out: refused
do $$ begin
  perform set_config('request.jwt.claims', '', true);
  begin perform public.delete_my_account(); insert into results (name, outcome) values ('signed out', 'NOT refused');
  exception when others then insert into results (name, outcome) values ('signed out', 'refused: ' || sqlerrm); end;
end $$;
insert into results (name, outcome) select 'anon can call', has_function_privilege('anon', 'public.delete_my_account()', 'execute')::text;
insert into results (name, outcome) select 'signed-in can call', has_function_privilege('authenticated', 'public.delete_my_account()', 'execute')::text;

-- signed in as the test user: delete the account
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000dead","role":"authenticated"}', true);
select public.delete_my_account();

insert into results (name, outcome) select 'auth user left', count(*)::text from auth.users where id = '00000000-0000-4000-8000-00000000dead';
insert into results (name, outcome) select 'profile left', count(*)::text from profiles where id = '00000000-0000-4000-8000-00000000dead';
insert into results (name, outcome) select 'rsvps left', count(*)::text from rsvps where user_id = '00000000-0000-4000-8000-00000000dead';
insert into results (name, outcome) select 'checkins left', count(*)::text from checkins where user_id = '00000000-0000-4000-8000-00000000dead';
insert into results (name, outcome) select 'event_actions left', count(*)::text from event_actions where user_id = '00000000-0000-4000-8000-00000000dead';
insert into results (name, outcome) select 'search_queries left', count(*)::text from search_queries where user_id = '00000000-0000-4000-8000-00000000dead';
insert into results (name, outcome) select 'leaderboard rows left', count(*)::text from leaderboard_month where user_id = '00000000-0000-4000-8000-00000000dead';
insert into results (name, outcome) select 'feedback kept, owner removed', coalesce(user_id::text, 'no owner') from feedback where id = (select max(id) from feedback);
insert into results (name, outcome) select 'guest session kept, unlinked', coalesce(converted_user_id::text, 'unlinked') from guest_sessions where device_id = '00000000-0000-4000-8000-0000000d0dad';
insert into results (name, outcome) select 'submissions remaining', coalesce(string_agg(title || ' (owner ' || coalesce(user_id::text, 'none') || ')', '; '), 'none') from event_submissions where title like 'TEST %';
insert into results (name, outcome) select 'other people unchanged',
  ((select count(*) from profiles) = b.profiles and (select count(*) from checkins) = b.checkins and (select count(*) from rsvps) = b.rsvps
   and (select count(*) from auth.users) = b.users and (select count(*) from leaderboard_month) = b.lb_rows)::text from before_others b;

do $r$ begin raise exception E'TEST RESULTS (rolled back)\n%', (select string_agg(name || ' => ' || outcome, E'\n' order by n) from results); end $r$;

-- Expected report:
--   test user on leaderboard before => 1
--   signed out => refused: Sign in to delete your account.
--   anon can call => false
--   signed-in can call => true
--   auth user left, profile left, rsvps left, checkins left, event_actions left, search_queries left, leaderboard rows left => 0
--   feedback kept, owner removed => no owner
--   guest session kept, unlinked => unlinked
--   submissions remaining => TEST approved event (owner none)
--   other people unchanged => true
