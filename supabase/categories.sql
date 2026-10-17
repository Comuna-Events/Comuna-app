-- Comuna: the six event categories.
-- Run once in Supabase > SQL Editor; safe to re-run.
--  Every event's category is one of these six labels (the app's CATS):
--    Food & Drink · Arts & Entertainment · Classes & Workshops · Active & Outdoors · Markets & Shopping · Community & Social
--  Anything else typed or ingested ("Comedy", "Class/Workshop", "Kids & Family") is mapped on save, and the
--  original wording is kept in tags so the detail isn't lost.

-- one-time copy of what the categories were before the six, so the mapping can be undone
create table if not exists ingest.category_backup as
  select event_id, category, tags, now() as saved_at from public.events;

-- free-text category (plus the event name, for "Sports & Games" that are really trivia nights) -> one of the six
create or replace function public.comuna_category(c text, name text default null) returns text
language sql immutable as $$
  select case
    when lower(t) in ('food & drink','food')                          then 'Food & Drink'
    when lower(t) in ('arts & entertainment','arts','shows')          then 'Arts & Entertainment'
    when lower(t) in ('classes & workshops','classes')                then 'Classes & Workshops'
    when lower(t) in ('active & outdoors','active')                   then 'Active & Outdoors'
    when lower(t) in ('markets & shopping','markets')                 then 'Markets & Shopping'
    when lower(t) in ('community & social','community')               then 'Community & Social'
    when t ~* 'market|\mshop|flea|vintage|fashion|makers fair|swap meet' then 'Markets & Shopping'
    when t ~* 'food|drink|dinner|supper|brunch|coffee|wine|beer|tasting|culinary' then 'Food & Drink'
    when t ~* 'book club'                                             then 'Community & Social'
    when t ~* 'game|trivia' and (t !~* 'sport' or coalesce(name,'') ~* 'trivia|bingo|board game|game night|karaoke|quiz')
                                                                      then 'Community & Social'
    when t ~* 'comedy|improv|theat|perform|drag|film|movie|cinema|screening|concert|music|jazz|opera|dance|nightlife|\mdj\M|open mic|table read'
                                                                      then 'Arts & Entertainment'
    when t ~* 'class|workshop|lecture|talk|learn|educat|book|litera|craft|science|tech|reading'
                                                                      then 'Classes & Workshops'
    when t ~* 'fitness|wellness|yoga|\mrun|health|medit|sport|hike|hiking|outdoor|nature|beach|park|garden|environment|spiritual|bike|cycl|climb|swim|pickle'
                                                                      then 'Active & Outdoors'
    when t ~* 'art|gallery|museum|exhibit|immersive|experien|cultur|show|media|podcast|night|club'
                                                                      then 'Arts & Entertainment'
    else 'Community & Social'
  end
  from (select coalesce(nullif(trim(c),''), name, '') as t) x
$$;

-- on every insert or category change: keep the original wording as a tag, store one of the six
create or replace function public.events_category() returns trigger
language plpgsql as $$
declare six text := public.comuna_category(new.category, new.name);
begin
  if nullif(trim(new.category),'') is not null and new.category <> six
     and not exists (select 1 from unnest(new.tags) t where lower(t) = lower(trim(new.category))) then
    new.tags := coalesce(new.tags,'{}') || trim(new.category);
  end if;
  new.category := six;
  return new;
end $$;

create or replace trigger events_category before insert or update of category on public.events
  for each row execute function public.events_category();

-- map what's there now (the trigger does the work)
update public.events set category = category
  where category is distinct from public.comuna_category(category, name);

alter table public.events drop constraint if exists events_category_six;
alter table public.events add constraint events_category_six check (category in
  ('Food & Drink','Arts & Entertainment','Classes & Workshops','Active & Outdoors','Markets & Shopping','Community & Social'));

-- check-ins and taps store the app's short key; re-key them from their event, and old 'shows' -> 'arts'
create or replace function public.comuna_category_key(label text) returns text
language sql immutable as $$
  select case label when 'Food & Drink' then 'food' when 'Arts & Entertainment' then 'arts'
    when 'Classes & Workshops' then 'classes' when 'Active & Outdoors' then 'active'
    when 'Markets & Shopping' then 'markets' else 'community' end
$$;

update public.checkins k set category = public.comuna_category_key(e.category)
  from public.events e where e.event_id = k.event_id and k.category is distinct from public.comuna_category_key(e.category);
update public.event_actions a set category = public.comuna_category_key(e.category)
  from public.events e where e.event_id = a.event_id and a.category is distinct from public.comuna_category_key(e.category);
update public.checkins      set category = 'arts' where category = 'shows';
update public.event_actions set category = 'arts' where category = 'shows';
update public.event_submissions set category = 'arts' where category = 'shows';
