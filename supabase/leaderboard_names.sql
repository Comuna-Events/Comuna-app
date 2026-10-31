-- Comuna: the leaderboard shows people by their name (first name + last initial) unless they choose otherwise.
-- Run once in Supabase > SQL Editor; safe to re-run. Replaces the random nicknames from leaderboard_privacy.sql:
-- a nickname is now only one a person writes themselves (Profile > Leaderboard name), and they can still hide.
--
-- - New profiles: no nickname, lb_show 'name'.
-- - Existing profiles that still have their random nickname go back to their name; anyone who wrote their own
--   nickname or changed the setting keeps it.
-- - leaderboard_top() shows the nickname only for lb_show 'nickname' with a nickname set.

alter table public.profiles alter column nickname drop default;
alter table public.profiles alter column lb_show set default 'name';

update public.profiles set nickname = null, lb_show = 'name'
where lb_show = 'nickname'
  and nickname ~ '^(Sunny|Golden|Breezy|Lucky|Mellow|Cosmic|Groovy|Swift|Bright|Easy|Wild|Hazy|Salty|Electric|Velvet|Neon) (Palm|Taco|Coyote|Canyon|Surfer|Hummingbird|Jacaranda|Poppy|Pelican|Skater|Owl|Comet|Avocado|Sunset|Mural|Boardwalk) [0-9]{2}$';

drop function if exists public.random_nickname();

comment on column public.profiles.nickname is 'A nickname the person chose for the leaderboard; shown when lb_show is ''nickname''.';
comment on column public.profiles.lb_show is 'How the person appears on the leaderboard: name (first name + last initial, the default), nickname or hidden.';

create or replace function public.leaderboard_top(p_board text, p_limit int default 5)
returns table (display_name text, points int, is_me boolean, title text)
language sql stable security definer set search_path = public as $$
  select case when p.lb_show = 'nickname' and nullif(btrim(p.nickname), '') is not null then btrim(p.nickname) else l.display_name end,
    l.points, l.user_id = auth.uid(), a.title
  from leaderboard_month l
  left join profiles p on p.id = l.user_id
  left join achievements a on a.key = p.title_key
  where l.neighborhood = p_board and coalesce(p.lb_show, 'name') <> 'hidden'
  order by l.points desc
  limit least(greatest(coalesce(p_limit, 5), 1), 50)
$$;
revoke execute on function public.leaderboard_top(text, int) from public, anon, authenticated;
grant execute on function public.leaderboard_top(text, int) to anon, authenticated;
comment on function public.leaderboard_top(text, int) is
'[App users] A neighborhood''s monthly top list, without user ids: first name + last initial, or a nickname the person chose; hidden people left out.';
