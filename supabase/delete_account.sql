-- Comuna: people can delete their own account from Profile (an App Store requirement).
-- Run once in Supabase > SQL Editor; safe to re-run.
--
-- What deleting an account removes: the sign-in, profile, points, check-ins, plans (RSVPs), viewing and
-- search history, and event submissions that weren't approved.
-- What stays, with no link back to the person: approved events they shared (they're part of the public
-- listings), written feedback, and the guest-session counts from before they signed up.
-- Points live only in those rows (leaderboard_month is computed from them), so they go with the account.

-- An approved event outlives the account that shared it: it loses its owner instead of being deleted.
alter table public.event_submissions alter column user_id drop not null;
alter table public.event_submissions drop constraint if exists event_submissions_user_id_fkey;
alter table public.event_submissions add constraint event_submissions_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

-- Deletes the signed-in person's account. Everything else follows from the foreign keys on auth.users:
-- profiles, rsvps, checkins, event_actions and search_queries are deleted with it; feedback,
-- guest_sessions and approved event_submissions keep their rows without the user.
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

comment on function public.delete_my_account() is
'[App users] Deletes the signed-in account, its points and history. Approved events it shared stay, without an owner.';
