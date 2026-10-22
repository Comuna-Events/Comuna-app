-- Run in Supabase > SQL Editor to check supabase/event_reports.sql against the live database.
-- Nothing is saved: everything runs in one transaction that ends in an error, which rolls it all back.
-- The error message is the test report (expected lines are at the end of this file).
begin;

-- 1. Hidden events stay in the table but aren't served to anyone except the person who shared them.
alter table public.event_submissions add column if not exists hidden_at timestamptz;
comment on column public.event_submissions.hidden_at is
'Set when 2 signed-in people report the event; it stops showing in the app. Clear it to put the event back.';
alter policy "see approved or own" on public.event_submissions
  using ((status = 'approved' and hidden_at is null) or auth.uid() = user_id);

-- 2. Reports. People can add them but not read them; the team reads them through event_reports_review.
create table if not exists public.event_reports (
  id         bigint generated always as identity primary key,
  event_id   text not null check (event_id ~ '^SUB-\d+$'),
  user_id    uuid references auth.users (id) on delete set null,
  device_id  uuid,
  reason     text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);
create unique index if not exists event_reports_once_per_person on public.event_reports (event_id, user_id);
create unique index if not exists event_reports_once_per_device on public.event_reports (event_id, device_id);
alter table public.event_reports enable row level security;
revoke all on public.event_reports from anon, authenticated;
grant insert on public.event_reports to anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'event_reports' and policyname = 'report as yourself') then
    create policy "report as yourself" on public.event_reports for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'event_reports' and policyname = 'guests report by device') then
    create policy "guests report by device" on public.event_reports for insert to anon, authenticated
      with check (user_id is null and device_id is not null);
  end if;
end $$;
comment on table public.event_reports is
'[Team] Reports on community events. 2 signed-in reports hide the event (event_submissions.hidden_at).';

-- 3. The second signed-in report hides the event for everyone.
create or replace function public.hide_reported_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(distinct user_id) from event_reports where event_id = new.event_id and user_id is not null) >= 2 then
    update event_submissions set hidden_at = now()
     where id = substring(new.event_id from 5)::bigint and status = 'approved' and hidden_at is null;
  end if;
  return null;
end $$;
revoke execute on function public.hide_reported_event() from public, anon, authenticated;
create or replace trigger hide_reported_event after insert on public.event_reports
  for each row execute function public.hide_reported_event();

-- 4. People the team has blocked from sharing events.
create table if not exists public.blocked_submitters (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  reason     text,
  created_at timestamptz not null default now()
);
alter table public.blocked_submitters enable row level security;   -- no policies: only the team (dashboard) can see or change it
revoke all on public.blocked_submitters from anon, authenticated;
comment on table public.blocked_submitters is '[Team] People who can no longer share events.';

-- the existing check on new submissions (5 waiting at most) now also turns away blocked people
create or replace function public.limit_pending_submissions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from blocked_submitters where user_id = new.user_id) then
    raise exception 'You can''t share events on Comuna right now. If you think this is a mistake, contact us.';
  end if;
  if (select count(*) from event_submissions where user_id = new.user_id and status = 'pending') >= 5 then
    raise exception 'You already have 5 events waiting for review';
  end if;
  return new;
end $$;
revoke execute on function public.limit_pending_submissions() from public, anon, authenticated;

-- 5. What the team checks each day: reported events, most recent first.
create or replace view public.event_reports_review with (security_invoker = true) as
select s.id as submission_id, s.title, s.status, s.hidden_at, s.user_id as shared_by,
       exists (select 1 from blocked_submitters b where b.user_id = s.user_id) as shared_by_blocked,
       count(*) as reports,
       count(distinct r.user_id) as signed_in_reporters,
       string_agg(r.reason, ' | ' order by r.created_at) as reasons,
       max(r.created_at) as last_report
from event_reports r join event_submissions s on s.id = substring(r.event_id from 5)::bigint
group by s.id
order by max(r.created_at) desc;
revoke all on public.event_reports_review from anon, authenticated;
comment on view public.event_reports_review is '[Team] Reported community events, with counts and reasons. Check daily.';

create temp table results (n serial, name text, outcome text);
grant all on results to authenticated, anon;
grant usage, select on sequence results_n_seq to authenticated, anon;
-- two throwaway people and an approved community event shared by a third
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'report-a@example.test'),
  ('00000000-0000-4000-8000-0000000000b2', 'report-b@example.test'),
  ('00000000-0000-4000-8000-0000000000c3', 'sharer@example.test');
insert into profiles (id, name) values ('00000000-0000-4000-8000-0000000000c3', 'Sharer');
insert into event_submissions (user_id, link, title, status) values ('00000000-0000-4000-8000-0000000000c3', 'https://example.test/e', 'TEST reported event', 'approved');
create temp table t as select 'SUB-' || max(id) as eid, max(id) as sid from event_submissions where title = 'TEST reported event';
grant select on t to authenticated, anon;

-- act as each person through the API roles, so the real permissions apply
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ declare e text := (select eid from t); begin
  insert into event_reports (event_id, device_id, reason) values (e, '00000000-0000-4000-8000-00000000d001', 'Spam or scam');
  insert into results (name, outcome) values ('guest report saved', 'yes');
  begin insert into event_reports (event_id, device_id, reason) values (e, '00000000-0000-4000-8000-00000000d002', 'Spam or scam');
        insert into results (name, outcome) values ('second guest report saved', 'yes'); end;
  begin insert into event_reports (event_id, user_id, reason) values (e, '00000000-0000-4000-8000-0000000000a1', 'pretend');
        insert into results (name, outcome) values ('guest posing as a user', 'NOT refused');
  exception when others then insert into results (name, outcome) values ('guest posing as a user', 'refused'); end;
  begin perform 1 from event_reports; insert into results (name, outcome) values ('guest can read reports', 'yes');
  exception when others then insert into results (name, outcome) values ('guest can read reports', 'no'); end;
end $$;
insert into results (name, outcome) select 'hidden after 2 guest reports', (hidden_at is not null)::text from event_submissions where id = (select sid from t);

reset role; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
do $$ declare e text := (select eid from t); begin
  insert into event_reports (event_id, user_id, reason) values (e, auth.uid(), 'Offensive or inappropriate');
  begin insert into event_reports (event_id, user_id, reason) values (e, auth.uid(), 'again');
        insert into results (name, outcome) values ('same person reporting twice', 'NOT refused');
  exception when unique_violation then insert into results (name, outcome) values ('same person reporting twice', 'refused (duplicate)'); end;
end $$;
reset role;
insert into results (name, outcome) select 'hidden after 1 signed-in report', (hidden_at is not null)::text from event_submissions where id = (select sid from t);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
insert into event_reports (event_id, user_id, reason) select eid, auth.uid(), 'Not a real event' from t;
insert into results (name, outcome) select 'others still see it after 2 signed-in reports', count(*)::text from event_submissions where id = (select sid from t);
reset role;
insert into results (name, outcome) select 'hidden after 2 signed-in reports', (hidden_at is not null)::text from event_submissions where id = (select sid from t);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
insert into results (name, outcome) select 'sharer still sees own hidden event', count(*)::text from event_submissions where id = (select sid from t);
reset role;

insert into results (name, outcome) select 'review list', reports || ' reports, ' || signed_in_reporters || ' signed in: ' || reasons from event_reports_review where submission_id = (select sid from t);
insert into blocked_submitters (user_id, reason) values ('00000000-0000-4000-8000-0000000000c3', 'test');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
do $$ begin
  insert into event_submissions (user_id, link, title, status) values (auth.uid(), 'https://example.test/2', 'TEST second event', 'pending');
  insert into results (name, outcome) values ('blocked person submitting', 'NOT refused');
exception when others then insert into results (name, outcome) values ('blocked person submitting', 'refused: ' || sqlerrm); end $$;
reset role;
insert into results (name, outcome) select 'anon can read review list', has_table_privilege('anon', 'public.event_reports_review', 'select')::text;
insert into results (name, outcome) select 'signed-in can read blocked list', has_table_privilege('authenticated', 'public.blocked_submitters', 'select')::text;

do $r$ begin raise exception E'TEST RESULTS (rolled back)\n%', (select string_agg(name || ' => ' || outcome, E'\n' order by n) from results); end $r$;

-- Expected report:
--   guest report saved => yes
--   second guest report saved => yes
--   guest posing as a user => refused
--   guest can read reports => no
--   hidden after 2 guest reports => false
--   same person reporting twice => refused (duplicate)
--   hidden after 1 signed-in report => false
--   others still see it after 2 signed-in reports => 0
--   hidden after 2 signed-in reports => true
--   sharer still sees own hidden event => 1
--   review list => 4 reports, 2 signed in: (in any order) Spam or scam, Spam or scam, Offensive or inappropriate, Not a real event
--   blocked person submitting => refused: You can't share events on Comuna right now. If you think this is a mistake, contact us.
--   anon can read review list => false
--   signed-in can read blocked list => false
