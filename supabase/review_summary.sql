-- Comuna: "92% liked it · Great vibe · Good for groups" on events people have reviewed.
-- Run once in Supabase > SQL Editor; safe to re-run. The app works before and after: until this exists, or until an
-- event has 3 reviews, it shows nothing.
--
-- Reviews are the "How was it?" answers after a check-in (feedback rows with kind 'event': a thumbs up or down and
-- optional tags). Only the totals and the two most-picked good tags leave the database: no names, ids or comments.

create or replace function public.review_summary()
returns table (event_id text, reviews int, liked_pct int, top_tags text[])
language sql stable security definer set search_path = public as $$
  with r as (
    select f.event_id, f.mood, f.tags from feedback f
    where f.kind = 'event' and f.event_id is not null and f.mood in ('up', 'down')
  ), t as (
    select r.event_id, tag, count(*) as n
    from r, unnest(r.tags) tag
    where tag in ('Great vibe', 'Would go again', 'Good for groups', 'Kid-friendly')   -- the good ones only
    group by r.event_id, tag
  )
  select r.event_id, count(*)::int, round(100.0 * count(*) filter (where r.mood = 'up') / count(*))::int,
    coalesce((select array_agg(t.tag order by t.n desc, t.tag) from (select * from t where t.event_id = r.event_id order by n desc, tag limit 2) t), '{}')
  from r
  group by r.event_id
  having count(*) >= 3   -- a score from one or two people says more about them than the event
$$;

-- Supabase grants new functions to anon and authenticated directly, so revoke from them as well as public
revoke execute on function public.review_summary() from public, anon, authenticated;
grant execute on function public.review_summary() to anon, authenticated;

comment on function public.review_summary() is
'[App users] Per event with 3+ reviews: how many, the share who liked it, and the two most-picked good tags. No user ids or comments.';
