-- Run in Supabase > SQL Editor to check supabase/submissions_v2.sql against the live database.
-- Nothing is saved: everything runs in one transaction that ends in an error, which rolls it all back.
-- The error message is the test report; every line should end in "ok".
begin;

alter table public.event_submissions add column if not exists end_date date;
alter table public.event_submissions add column if not exists rsvp_required boolean not null default false;
alter table public.event_submissions drop constraint if exists event_submissions_end_after_start;
alter table public.event_submissions add constraint event_submissions_end_after_start
  check (end_date is null or end_date >= event_date) not valid;
comment on column public.event_submissions.end_date is
'One-time: the last day of a multi-day event. Repeating: the last date it repeats. Empty: a single day, or repeats with no end.';
comment on column public.event_submissions.rsvp_required is
'The sharer says people need to RSVP or buy tickets in advance, at the link. The app reminds people who save it.';

create table if not exists public.blocked_link_hosts (
  host       text primary key check (host = lower(host) and host !~ '[/:@\s]'),
  reason     text,
  created_at timestamptz not null default now()
);
alter table public.blocked_link_hosts enable row level security;   -- no policies: only the team (SQL Editor) reads or writes it
comment on table public.blocked_link_hosts is
'[Team] Sites shared events can''t link to (spam, scams, malware). Blocks subdomains too.';

create or replace function public.link_host(p_link text) returns text
language sql immutable as $$
  select lower(substring(p_link from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^/?#@]*@)?([^/?#:]+)'))
$$;

create or replace function public.link_host_blocked(p_link text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocked_link_hosts b
                 where public.link_host(p_link) = b.host or public.link_host(p_link) like '%.' || b.host)
$$;

create or replace function public.link_problem(p_link text) returns text
language plpgsql stable security definer set search_path = public as $$
declare h text := public.link_host(p_link);
        path text := lower(coalesce(substring(p_link from '^[^:]+://[^/?#]+([^?#]*)'), ''));
begin
  if p_link is null or p_link !~* '^https://' then return 'use the secure link, starting with https://'; end if;
  if p_link ~ '^[^:]+://[^/?#]*@' then return 'links with a login in them can''t be added'; end if;
  if h is null or h !~ '\.' or h ~ '^[0-9.]+$' then return 'use the site''s name, not a number address'; end if;
  if h ~ '(^|\.)xn--' then return 'that site name uses look-alike characters'; end if;
  if h ~ '^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|cutt\.ly|rebrand\.ly|shorturl\.at|rb\.gy|t\.ly|tiny\.cc|s\.id|v\.gd|qrco\.de|bl\.ink|short\.io|tiny\.one)$'
    then return 'use the full link, not a shortened one'; end if;
  if path ~ '\.(exe|apk|aab|ipa|dmg|pkg|msi|zip|rar|7z|tar|gz|scr|bat|cmd|com|jar|js|vbs|ps1|iso|img|deb|rpm|bin|sh|app|xapk|torrent)$'
    then return 'links that download a file can''t be added'; end if;
  if public.link_host_blocked(p_link) then return 'that site isn''t allowed on Comuna'; end if;
  return null;
end $$;

create or replace function public.check_submission_link() returns trigger
language plpgsql security definer set search_path = public as $$
declare why text := public.link_problem(new.link);
begin
  if why is not null then raise exception 'link_refused: %', why using errcode = 'check_violation'; end if;
  return new;
end $$;

drop trigger if exists check_link on public.event_submissions;
create trigger check_link before insert or update of link on public.event_submissions
  for each row execute function public.check_submission_link();

create or replace view public.event_submissions_review with (security_invoker = true) as
select id, created_at, title, event_date, end_date, recurrence, price, rsvp_required,
       public.link_host(link) as link_site, link, venue, address, description, is_host, user_id
from public.event_submissions
where status = 'pending'
order by created_at;
revoke all on public.event_submissions_review from anon, authenticated;
comment on view public.event_submissions_review is
'[Team] Shared events waiting for review, oldest first. Open the link (check the site name) before approving.';

insert into public.blocked_link_hosts (host, reason) values ('badsite.example', 'test');
do $$
declare r text := ''; u uuid := (select id from auth.users limit 1); n bigint;
begin
  r := r || E'\nfine eventbrite: '      || coalesce(public.link_problem('https://www.eventbrite.com/e/trivia-123'), 'ok');
  r := r || E'\nhttp refused: '         || case when public.link_problem('http://example.com/x') is not null then 'ok' else 'FAIL' end;
  r := r || E'\nshortener refused: '    || case when public.link_problem('https://bit.ly/abc') is not null then 'ok' else 'FAIL' end;
  r := r || E'\ndownload refused: '     || case when public.link_problem('https://files.example.com/Event.APK') is not null then 'ok' else 'FAIL' end;
  r := r || E'\nip refused: '           || case when public.link_problem('https://192.168.1.4/e') is not null then 'ok' else 'FAIL' end;
  r := r || E'\nlogin refused: '        || case when public.link_problem('https://user@evil.example/e') is not null then 'ok' else 'FAIL' end;
  r := r || E'\npunycode refused: '     || case when public.link_problem('https://xn--evntbrite-123.com/e') is not null then 'ok' else 'FAIL' end;
  r := r || E'\nblocked subdomain: '    || case when public.link_problem('https://go.badsite.example/e') is not null then 'ok' else 'FAIL' end;
  r := r || E'\nsimilar name allowed: ' || coalesce(public.link_problem('https://notbadsite.example/e'), 'ok');
  r := r || E'\nquery .zip allowed: '   || coalesce(public.link_problem('https://partiful.com/e/abc?x=file.zip'), 'ok');
  begin
    insert into public.event_submissions (user_id, status, link, title, category, event_date, end_date, recurrence, venue, address, lat, lng, price, rsvp_required)
    values (u, 'pending', 'https://bit.ly/x', 'T', 'arts', current_date, current_date + 2, 'One-time', 'V', 'A', 34, -118, 'Free', true);
    r := r || E'\ntrigger blocks insert: FAIL';
  exception when check_violation then r := r || E'\ntrigger blocks insert: ' || case when sqlerrm like 'link_refused: %' then 'ok' else 'FAIL '||sqlerrm end;
  end;
  insert into public.event_submissions (user_id, status, link, title, category, event_date, end_date, recurrence, venue, address, lat, lng, price, rsvp_required)
  values (u, 'pending', 'https://www.eventbrite.com/e/x', 'T', 'arts', current_date, current_date + 2, 'One-time', 'V', 'A', 34, -118, 'Free', true) returning id into n;
  r := r || E'\nmulti-day insert: ' || case when (select end_date - event_date from public.event_submissions where id = n) = 2 then 'ok' else 'FAIL' end;
  r := r || E'\nreview view lists it: ' || case when exists (select 1 from public.event_submissions_review where id = n and link_site = 'www.eventbrite.com') then 'ok' else 'FAIL' end;
  begin
    insert into public.event_submissions (user_id, status, link, title, category, event_date, end_date, recurrence, venue, address, lat, lng, price)
    values (u, 'pending', 'https://www.eventbrite.com/e/y', 'T', 'arts', current_date, current_date - 1, 'One-time', 'V', 'A', 34, -118, 'Free');
    r := r || E'\nend before start refused: FAIL';
  exception when check_violation then r := r || E'\nend before start refused: ok';
  end;
  raise exception 'TEST REPORT (rolled back):%', r;
end $$;
