-- Comuna: reporting events people shared, and blocking people who abuse it (App Store guideline 1.2).
-- Run once in Supabase > SQL Editor; safe to re-run.
--
-- Anyone can report a community event from its page. It disappears for them straight away, and once
-- 2 signed-in people have reported it, it's hidden for everyone until the team looks at it.
-- Guests' reports reach the team too, but don't count toward hiding, so nobody can hide events anonymously.
--
-- Daily check, in Table Editor or SQL Editor:   select * from event_reports_review;
--   Keep a hidden event:     update event_submissions set hidden_at = null where id = <id>;
--   Take it down for good:   update event_submissions set status = 'rejected' where id = <id>;   (its points go too)
--   Block the person who shared it from sharing more:
--                            insert into blocked_submitters (user_id, reason) values ('<user_id>', '<why>');

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
