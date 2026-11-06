-- Comuna: shared events that run several days, say whether they need an RSVP or tickets, and links checked for
-- spam and downloads before the team reviews them.
-- Run once in Supabase > SQL Editor after event_reports.sql; safe to re-run. The app works before and after:
-- until this runs, a multi-day event is sent without its last day (noted in the description for the reviewer).
--
-- What the link check refuses (the app says the same thing as the person types, see linkRisk() in index.html):
--   - anything but https://, raw IP addresses, look-alike (punycode, xn--) domains, links with a login in them
--   - shortened links (bit.ly and friends), which hide where they go
--   - links straight to a file download (.exe, .apk, .dmg, .zip...)
--   - any site the team has blocked:   insert into blocked_link_hosts (host, reason) values ('bad.example', 'malware');
--     (a blocked host also blocks its subdomains). Approved events already pointing there:
--     select id, title, link from event_submissions where link_host_blocked(link);
--
-- The team still reviews every shared event and opens its link before approving it; this only stops the obvious ones.
-- Daily review of what's waiting:   select * from event_submissions_review;

-- 1. Multi-day and "needs an RSVP or tickets"
alter table public.event_submissions add column if not exists end_date date;
alter table public.event_submissions add column if not exists rsvp_required boolean not null default false;
alter table public.event_submissions drop constraint if exists event_submissions_end_after_start;
alter table public.event_submissions add constraint event_submissions_end_after_start
  check (end_date is null or end_date >= event_date) not valid;
comment on column public.event_submissions.end_date is
'One-time: the last day of a multi-day event. Repeating: the last date it repeats. Empty: a single day, or repeats with no end.';
comment on column public.event_submissions.rsvp_required is
'The sharer says people need to RSVP or buy tickets in advance, at the link. The app reminds people who save it.';

-- 2. Sites the team has blocked
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

-- the reason a link can't be shared, or null when it's fine
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

-- 3. The review queue: what's waiting, with the link's site spelled out so a look-alike stands out
create or replace view public.event_submissions_review with (security_invoker = true) as
select id, created_at, title, event_date, end_date, recurrence, price, rsvp_required,
       public.link_host(link) as link_site, link, venue, address, description, is_host, user_id
from public.event_submissions
where status = 'pending'
order by created_at;
revoke all on public.event_submissions_review from anon, authenticated;
comment on view public.event_submissions_review is
'[Team] Shared events waiting for review, oldest first. Open the link (check the site name) before approving.';
