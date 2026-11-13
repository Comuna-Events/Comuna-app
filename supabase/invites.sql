-- Comuna: friend invites. Someone invites friends to one date of an event; everyone answers In, Maybe or Can't, and
-- the people in that invite see each other's names and answers. Nobody else sees anything about it.
-- Run once in Supabase > SQL Editor AFTER push.sql; safe to re-run. Then redeploy send-reminders (it sends the invite
-- notifications). The app works before and after: until this runs, Invite opens the phone's share menu as before.
--
-- How friends work (version 1): there's no friends list to manage. Anyone who has answered an invite you've also
-- answered (or sent) is someone you can pick next time. Everyone else comes in by link: a link joins whoever opens it
-- to that invite, so it's only as private as the chat it's pasted into, like any party link.
--
-- Tables are private (no direct reads or writes); the app goes through the functions below, which check that you're in
-- the invite. Everything is deleted with the account (on delete cascade).
--
--   invites          one per person, event and date (inviting more friends adds them to the same one)
--   invite_members   who's in it and their answer: pending (not answered), in, maybe, out
--   invite_removed   people the person who invited took out; their link no longer lets them back in
--
-- Anyone but the person who invited can leave an invite; the person who invited can take someone out, or cancel it
-- (everyone in it is told, and the invite disappears from the app).
--
-- Notifications (send-reminders; Profile > Reminders > Friend invites turns them all off). Invites, nudges, dropping
-- out and cancelling send within seconds (the triggers at the bottom call send-reminders); "Still in?" goes out with
-- the every-10-minutes run.
--   invite     "Jess invited you to ..."             to someone added by a friend (not by link: they opened it already)
--   nudge      "Jess is waiting on you"              the person who invited taps Nudge on someone who hasn't answered
--   still_in   "Still in for ... at 7:30?"           2-2.7 hours before it starts, to everyone In or Maybe, when 2+ are
--   dropped    "Sam can't make ..."                  someone goes from In/Maybe to Can't; to the others still going
--   cancelled  "Jess cancelled ..."                  to everyone else in it who hadn't said Can't

create table if not exists public.invites (
  id              uuid primary key default gen_random_uuid(),
  -- the link code: 12 characters from a random uuid, so links can't be guessed
  code            text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  event_id        text not null,
  occurrence_date date not null,
  host_id         uuid not null references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  cancelled_at    timestamptz,
  unique (host_id, event_id, occurrence_date)
);
alter table public.invites add column if not exists cancelled_at timestamptz;
create index if not exists invites_event on public.invites (event_id, occurrence_date);

create table if not exists public.invite_members (
  invite_id   uuid not null references public.invites (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  invited_by  uuid references auth.users (id) on delete set null,
  via         text not null default 'direct' check (via in ('host', 'direct', 'link')),
  answer      text not null default 'pending' check (answer in ('pending', 'in', 'maybe', 'out')),
  invited_at  timestamptz not null default now(),
  answered_at timestamptz,
  nudged_at   timestamptz,     -- set once, by the person who invited
  dropped_at  timestamptz,     -- went from In or Maybe to Can't (cleared if they come back)
  primary key (invite_id, user_id)
);
create index if not exists invite_members_user on public.invite_members (user_id);

create table if not exists public.invite_removed (
  invite_id  uuid not null references public.invites (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  removed_at timestamptz not null default now(),
  primary key (invite_id, user_id)
);

alter table public.invites enable row level security;
alter table public.invite_members enable row level security;
alter table public.invite_removed enable row level security;
revoke all on public.invites, public.invite_members, public.invite_removed from anon, authenticated;

-- "Maya R.": first name and last initial, from the name they gave at sign-up
create or replace function public.invite_name(p_user uuid)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(split_part(btrim(p.name), ' ', 1) || ' ' ||
           coalesce(left(nullif(split_part(btrim(p.name), ' ', 2), ''), 1) || '.', '')), ''), 'A friend')
  from (select (select name from profiles where id = p_user) as name) p;
$$;

-- people who've answered an invite you've also answered or sent, most plans together first
create or replace function public.my_friends()
returns table (user_id uuid, name text, plans bigint)
language sql stable security definer set search_path = public as $$
  select o.user_id, invite_name(o.user_id), count(distinct o.invite_id)
  from invite_members me
  join invite_members o on o.invite_id = me.invite_id and o.user_id <> me.user_id
  where me.user_id = auth.uid() and me.answer <> 'pending' and o.answer <> 'pending'
  group by o.user_id
  order by 3 desc, 2
  limit 100;
$$;

-- Add friends to an invite you're in (and haven't said Can't to). Only people from my_friends(); 25 people at most.
create or replace function public.invite_more(p_invite uuid, p_friends uuid[])
returns integer
language plpgsql security definer set search_path = public as $$
declare added integer;
begin
  if not exists (select 1 from invite_members m join invites i on i.id = m.invite_id
                 where m.invite_id = p_invite and m.user_id = auth.uid() and m.answer <> 'out' and i.cancelled_at is null) then
    raise exception 'not in this invite';
  end if;
  insert into invite_members (invite_id, user_id, invited_by, via)
  select p_invite, f.user_id, auth.uid(), 'direct'
  from my_friends() f
  where f.user_id = any (coalesce(p_friends, '{}'))
    and not exists (select 1 from invite_removed r where r.invite_id = p_invite and r.user_id = f.user_id)
    and (select count(*) from invite_members where invite_id = p_invite) < 25
  on conflict do nothing;
  get diagnostics added = row_count;
  return added;
end $$;

-- Invite friends to one date of an event (or just make the invite, for a link). Inviting again to the same event and
-- date adds to the same invite. Returns the invite's id and link code.
create or replace function public.create_invite(p_event_id text, p_date date, p_friends uuid[] default '{}')
returns table (id uuid, code text, added integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare inv invites; n integer := 0;
begin
  if auth.uid() is null then raise exception 'sign in to invite friends'; end if;
  if not exists (select 1 from events e where e.event_id = p_event_id) then raise exception 'no such event'; end if;
  if p_date < (now() at time zone 'America/Los_Angeles')::date then raise exception 'that date has passed'; end if;
  -- inviting again after cancelling starts a fresh invite
  delete from invites i where i.host_id = auth.uid() and i.event_id = p_event_id and i.occurrence_date = p_date
    and i.cancelled_at is not null;
  select * into inv from invites i where i.host_id = auth.uid() and i.event_id = p_event_id and i.occurrence_date = p_date;
  if inv.id is null then
    if (select count(*) from invites i where i.host_id = auth.uid() and i.created_at > now() - interval '1 day') >= 20 then
      raise exception 'too many invites today';
    end if;
    insert into invites (event_id, occurrence_date, host_id)
    values (p_event_id, p_date, auth.uid())
    returning * into inv;
    insert into invite_members (invite_id, user_id, via, answer, answered_at) values (inv.id, auth.uid(), 'host', 'in', now());
  else
    -- the person who invited is going again if they'd said Can't
    update invite_members m set answer = 'in', answered_at = now(), dropped_at = null
    where m.invite_id = inv.id and m.user_id = auth.uid() and m.answer <> 'in';
  end if;
  if cardinality(coalesce(p_friends, '{}')) > 0 then n := invite_more(inv.id, p_friends); end if;
  return query select inv.id, inv.code, n;
end $$;

-- What a link shows before someone signs up: the event, the date, who invited and how many are going. No names but
-- the inviter's, and nothing that lets them answer.
create or replace function public.invite_preview(p_code text)
returns table (event_id text, occurrence_date date, host_name text, going bigint)
language sql stable security definer set search_path = public as $$
  select i.event_id, i.occurrence_date, invite_name(i.host_id),
         (select count(*) from invite_members m where m.invite_id = i.id and m.answer = 'in')
  from invites i where i.code = p_code and length(p_code) = 12 and i.cancelled_at is null;
$$;

-- Opening a link: join that invite (not answered yet). Returns its id.
create or replace function public.join_invite(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare inv invites;
begin
  if auth.uid() is null then raise exception 'sign in to answer'; end if;
  select * into inv from invites where code = p_code and length(p_code) = 12;
  if inv.id is null then raise exception 'invite not found'; end if;
  if inv.cancelled_at is not null then raise exception 'this plan was cancelled'; end if;
  if exists (select 1 from invite_removed where invite_id = inv.id and user_id = auth.uid()) then
    raise exception 'you were taken out of this invite';
  end if;
  if not exists (select 1 from invite_members where invite_id = inv.id and user_id = auth.uid()) then
    if (select count(*) from invite_members where invite_id = inv.id) >= 25 then raise exception 'this invite is full'; end if;
    insert into invite_members (invite_id, user_id, invited_by, via) values (inv.id, auth.uid(), inv.host_id, 'link')
    on conflict do nothing;
  end if;
  return inv.id;
end $$;

create or replace function public.answer_invite(p_invite uuid, p_answer text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_answer not in ('in', 'maybe', 'out') then raise exception 'answer is in, maybe or out'; end if;
  if exists (select 1 from invites where id = p_invite and cancelled_at is not null) then
    raise exception 'this plan was cancelled';
  end if;
  update invite_members m
  set dropped_at = case when p_answer = 'out' and m.answer in ('in', 'maybe') then now()
                        when p_answer = 'out' then m.dropped_at end,
      answer = p_answer, answered_at = now()
  where m.invite_id = p_invite and m.user_id = auth.uid();
  if not found then raise exception 'not in this invite'; end if;
end $$;

-- The person who invited can nudge someone who hasn't answered, once
create or replace function public.nudge_invite(p_invite uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from invites where id = p_invite and host_id = auth.uid()) then
    raise exception 'only the person who invited can nudge';
  end if;
  update invite_members set nudged_at = now()
  where invite_id = p_invite and user_id = p_user and answer = 'pending' and nudged_at is null;
end $$;

-- Leave an invite you were added to (the person who invited cancels instead). A link can bring you back.
create or replace function public.leave_invite(p_invite uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from invites where id = p_invite and host_id = auth.uid()) then
    raise exception 'cancel the plan instead';
  end if;
  delete from invite_members where invite_id = p_invite and user_id = auth.uid();
end $$;

-- The person who invited takes someone out; that person's link no longer works for this invite. Nobody is told.
create or replace function public.remove_from_invite(p_invite uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from invites where id = p_invite and host_id = auth.uid()) then
    raise exception 'only the person who invited can take someone out';
  end if;
  if p_user = auth.uid() then raise exception 'cancel the plan instead'; end if;
  delete from invite_members where invite_id = p_invite and user_id = p_user;
  insert into invite_removed (invite_id, user_id) values (p_invite, p_user) on conflict do nothing;
end $$;

-- The person who invited calls it off: everyone else in it who hadn't said Can't is told, and it leaves the app.
-- Plans people saved stay saved (they can still go).
create or replace function public.cancel_invite(p_invite uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update invites set cancelled_at = now() where id = p_invite and host_id = auth.uid() and cancelled_at is null;
  if not found and not exists (select 1 from invites where id = p_invite and host_id = auth.uid()) then
    raise exception 'only the person who invited can cancel';
  end if;
end $$;

-- Your invites from today on, with everyone in each and their answers (only the invites you're in)
create or replace function public.my_invites()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'date', x->>'created_at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', i.id, 'code', i.code, 'event_id', i.event_id, 'date', i.occurrence_date,
      'created_at', i.created_at, 'host_id', i.host_id, 'host_name', invite_name(i.host_id),
      'is_host', i.host_id = auth.uid(), 'my_answer', me.answer, 'invited_at', me.invited_at,
      'members', (select jsonb_agg(jsonb_build_object(
          'user_id', m.user_id, 'name', invite_name(m.user_id), 'answer', m.answer, 'via', m.via,
          'answered_at', m.answered_at, 'nudged', m.nudged_at is not null,
          'host', m.user_id = i.host_id, 'me', m.user_id = auth.uid())
        order by (m.user_id = i.host_id) desc, array_position(array['in', 'maybe', 'pending', 'out'], m.answer), m.invited_at)
        from invite_members m where m.invite_id = i.id)) as x
    from invite_members me join invites i on i.id = me.invite_id
    where me.user_id = auth.uid() and i.occurrence_date >= (now() at time zone 'America/Los_Angeles')::date
      and i.cancelled_at is null
  ) q;
$$;

revoke execute on function public.invite_name(uuid), public.my_friends(), public.invite_more(uuid, uuid[]),
  public.create_invite(text, date, uuid[]), public.invite_preview(text), public.join_invite(text),
  public.answer_invite(uuid, text), public.nudge_invite(uuid, uuid), public.my_invites(), public.leave_invite(uuid),
  public.remove_from_invite(uuid, uuid), public.cancel_invite(uuid) from public, anon;
grant execute on function public.my_friends(), public.invite_more(uuid, uuid[]), public.create_invite(text, date, uuid[]),
  public.invite_preview(text), public.join_invite(text), public.answer_invite(uuid, text), public.nudge_invite(uuid, uuid),
  public.my_invites(), public.leave_invite(uuid), public.remove_from_invite(uuid, uuid), public.cancel_invite(uuid)
  to authenticated;
-- a link opened before signing up shows what it's for
grant execute on function public.invite_preview(text) to anon;

/* ---------- notifications (read by supabase/functions/send-reminders) ---------- */

alter table public.push_prefs add column if not exists invites boolean not null default true;

alter table public.push_sent drop constraint if exists push_sent_kind_check;
alter table public.push_sent add constraint push_sent_kind_check check (kind in
  ('plans_today', 'tickets', 'new_for_you', 'invite', 'nudge', 'still_in', 'dropped', 'cancelled'));

-- One row per phone. items is one object: the invite, the event, who it's from (or who dropped), and who's going.
create or replace function public.due_push_invites()
returns table (kind text, ref text, user_id uuid, token text, environment text, items jsonb)
language sql stable security definer set search_path = public as $$
  with inv as (
    select i.*, e.name, e.venue,
           case when e.start_time is not null then (i.occurrence_date + e.start_time) at time zone 'America/Los_Angeles' end as starts_at,
           array(select invite_name(g.user_id) from invite_members g
                 where g.invite_id = i.id and g.answer = 'in' order by (g.user_id = i.host_id) desc, g.answered_at) as going
    from invites i join events e on e.event_id = i.event_id
    where i.occurrence_date >= (now() at time zone 'America/Los_Angeles')::date
      and (i.cancelled_at is null or i.cancelled_at > now() - interval '1 day')
      and e.status is distinct from 'Cancelled' and e.status is distinct from 'Past / archived'
  ),
  item as (
    select inv.id, jsonb_build_object('invite_id', inv.id, 'event_id', inv.event_id, 'name', inv.name, 'venue', inv.venue,
      'date', inv.occurrence_date, 'starts_at', inv.starts_at, 'from', invite_name(inv.host_id),
      'going', to_jsonb(inv.going)) as j, inv.starts_at, inv.host_id, inv.cancelled_at
    from inv
  ),
  -- added by a friend in the last day, not answered yet
  invited as (
    select 'invite'::text as kind, m.invite_id::text as ref, m.user_id,
           it.j || jsonb_build_object('from', invite_name(coalesce(m.invited_by, it.host_id))) as items
    from invite_members m join item it on it.id = m.invite_id
    where m.via = 'direct' and m.answer = 'pending' and m.invited_at > now() - interval '1 day'
      and it.cancelled_at is null
  ),
  nudged as (
    select 'nudge'::text, m.invite_id::text, m.user_id, it.j
    from invite_members m join item it on it.id = m.invite_id
    where m.answer = 'pending' and m.nudged_at > now() - interval '1 day'
      and it.cancelled_at is null
  ),
  -- 2 to 2h40 before it starts, when at least two people are In or Maybe
  still as (
    select 'still_in'::text, m.invite_id::text, m.user_id, it.j
    from invite_members m join item it on it.id = m.invite_id
    where m.answer in ('in', 'maybe') and it.starts_at between now() + interval '2 hours' and now() + interval '160 minutes'
      and it.cancelled_at is null
      and (select count(*) from invite_members o where o.invite_id = m.invite_id and o.answer in ('in', 'maybe')) >= 2
  ),
  -- someone dropped in the last day: tell the others still In or Maybe
  dropped as (
    select 'dropped'::text, d.invite_id || ':' || d.user_id, m.user_id,
           it.j || jsonb_build_object('dropped', invite_name(d.user_id))
    from invite_members d join item it on it.id = d.invite_id
    join invite_members m on m.invite_id = d.invite_id and m.user_id <> d.user_id and m.answer in ('in', 'maybe')
    where d.answer = 'out' and d.dropped_at > now() - interval '1 day'
      and it.cancelled_at is null
  ),
  cancelled as (
    select 'cancelled'::text, m.invite_id::text, m.user_id, it.j
    from invite_members m join item it on it.id = m.invite_id
    where it.cancelled_at is not null and m.user_id <> it.host_id and m.answer <> 'out'
  ),
  due as (select * from invited union all select * from nudged union all select * from still union all select * from dropped
          union all select * from cancelled)
  select d.kind, d.ref, d.user_id, t.token, t.environment, d.items
  from due d join push_tokens t on t.user_id = d.user_id
  where coalesce((select p.invites from push_prefs p where p.user_id = d.user_id), true)
    and not exists (select 1 from push_sent s where s.user_id = d.user_id and s.kind = d.kind and s.ref = d.ref);
$$;
revoke execute on function public.due_push_invites() from public, anon, authenticated;

comment on table public.invites is
'[App users] Friend invites: one per person, event and date. Read and written only through the invite functions (invites.sql).';
comment on table public.invite_members is
'[App users] Who is in each invite and their answer (pending, in, maybe, out). Only people in the invite can see it.';
comment on function public.due_push_invites() is
'[Team] Invite, nudge, still-in and dropped notifications due now, one row per phone. Read by send-reminders.';

/* ---------- send right away ----------
   An invite, a nudge, someone dropping out and a cancelled plan call send-reminders straight away (?only=invites),
   rather than waiting up to 10 minutes for the next scheduled run. pg_net sends after the change is saved and never
   holds it up; if the call fails, the next scheduled run sends it. send-reminders claims each notification before
   sending, so this and a scheduled run at the same moment don't send it twice. Same Vault secret as push.sql. */
create or replace function public.invite_push_now()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := 'https://sjxxiammvvfxcnukkqhg.supabase.co/functions/v1/send-reminders?only=invites',
    headers := jsonb_build_object('content-type', 'application/json', 'x-ingest-secret',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000);
  return null;
exception when others then
  return null;   -- a notification problem never stops an invite from saving
end $$;
revoke execute on function public.invite_push_now() from public, anon, authenticated;

drop trigger if exists invite_push_added on public.invite_members;
create trigger invite_push_added after insert on public.invite_members
  for each statement execute function public.invite_push_now();
drop trigger if exists invite_push_changed on public.invite_members;
create trigger invite_push_changed after update of nudged_at, dropped_at on public.invite_members
  for each row when (new.nudged_at is distinct from old.nudged_at or new.dropped_at is distinct from old.dropped_at)
  execute function public.invite_push_now();
drop trigger if exists invite_push_cancelled on public.invites;
create trigger invite_push_cancelled after update of cancelled_at on public.invites
  for each row when (new.cancelled_at is not null and old.cancelled_at is null)
  execute function public.invite_push_now();
