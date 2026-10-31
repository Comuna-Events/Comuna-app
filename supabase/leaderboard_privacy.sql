-- Comuna: people appear on the leaderboard by a nickname unless they choose otherwise, and can hide.
-- Run once in Supabase > SQL Editor; safe to re-run. From the October survey: only 12% were fine appearing under
-- their real name; 44% wanted a nickname and 29% didn't want to appear at all.
--
-- - profiles.nickname: everyone gets a random one ("Golden Coyote 27"), existing accounts too; they can change it.
-- - profiles.lb_show: 'nickname' (the default), 'name' (first name + last initial, as before) or 'hidden'.
--   Hidden people still earn points; they just aren't listed.
-- - leaderboard_top() shows whichever they chose and leaves hidden people out.
-- - my_month_progress(): your verified check-ins and neighborhoods this month, for the monthly challenge.

create or replace function public.random_nickname() returns text
language sql volatile set search_path = '' as $$
  select (array['Sunny','Golden','Breezy','Lucky','Mellow','Cosmic','Groovy','Swift','Bright','Easy',
                'Wild','Hazy','Salty','Electric','Velvet','Neon'])[1 + floor(random() * 16)::int]
    || ' ' || (array['Palm','Taco','Coyote','Canyon','Surfer','Hummingbird','Jacaranda','Poppy','Pelican',
                     'Skater','Owl','Comet','Avocado','Sunset','Mural','Boardwalk'])[1 + floor(random() * 16)::int]
    || ' ' || (10 + floor(random() * 90)::int)::text
$$;

alter table public.profiles add column if not exists nickname text default public.random_nickname();
alter table public.profiles add column if not exists lb_show text not null default 'nickname';
update public.profiles set nickname = public.random_nickname() where nickname is null or btrim(nickname) = '';

alter table public.profiles drop constraint if exists profiles_lb_show_check;
alter table public.profiles add constraint profiles_lb_show_check check (lb_show in ('nickname', 'name', 'hidden'));
alter table public.profiles drop constraint if exists profiles_nickname_check;
alter table public.profiles add constraint profiles_nickname_check check (char_length(btrim(nickname)) between 2 and 24);

comment on column public.profiles.nickname is 'Shown on the leaderboard unless lb_show is ''name''. Random until the person changes it.';
comment on column public.profiles.lb_show is 'How the person appears on the leaderboard: nickname (default), name (first name + last initial) or hidden.';

-- profiles are readable and writable column by column; the person can see and change these two on their own row
grant select (nickname, lb_show), insert (nickname, lb_show), update (nickname, lb_show) on public.profiles to authenticated;

create or replace function public.leaderboard_top(p_board text, p_limit int default 5)
returns table (display_name text, points int, is_me boolean, title text)
language sql stable security definer set search_path = public as $$
  select case when p.lb_show = 'name' then l.display_name else coalesce(nullif(btrim(p.nickname), ''), 'Explorer') end,
    l.points, l.user_id = auth.uid(), a.title
  from leaderboard_month l
  left join profiles p on p.id = l.user_id
  left join achievements a on a.key = p.title_key
  where l.neighborhood = p_board and coalesce(p.lb_show, 'nickname') <> 'hidden'
  order by l.points desc
  limit least(greatest(coalesce(p_limit, 5), 1), 50)
$$;
revoke execute on function public.leaderboard_top(text, int) from public, anon, authenticated;
grant execute on function public.leaderboard_top(text, int) to anon, authenticated;
comment on function public.leaderboard_top(text, int) is
'[App users] A neighborhood''s monthly top list, without user ids: nicknames unless someone chose their name; hidden people left out.';

create or replace function public.my_month_progress()
returns table (checkins int, neighborhoods int)
language sql stable security definer set search_path = public as $$
  select count(*)::int, count(distinct neighborhood)::int
  from checkins
  where user_id = auth.uid() and distance_m is not null
    and checkin_date >= date_trunc('month', now() at time zone 'America/Los_Angeles')::date
$$;
revoke execute on function public.my_month_progress() from public, anon, authenticated;
grant execute on function public.my_month_progress() to authenticated;
comment on function public.my_month_progress() is '[App users] Your verified check-ins and neighborhoods this month (LA time), for the monthly challenge.';
