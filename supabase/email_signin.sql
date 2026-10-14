-- Comuna: email sign-in (run once in Supabase > SQL Editor; safe to re-run).
-- Before running: Authentication > Sign In / Providers > turn OFF anonymous sign-ins,
-- keep Email on, and make the "Magic link or OTP" email template show {{ .Token }}.

-- Signing in on a new phone loads your own profile (name, neighborhood, interests) back.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (auth.uid() = id);

-- Optional, to start fresh: remove the old anonymous test accounts.
-- Their RSVPs, check-ins and other rows go with them wherever the table uses "on delete cascade".
-- delete from auth.users where is_anonymous;
