// Lets Apple's App Review sign in. Reviewers can't receive our emailed sign-in codes, so the review address
// (REVIEW_EMAIL below, also in index.html) takes a fixed code instead: the app sends it here, and if it matches the
// REVIEW_CODE secret this signs in that one account, creating it first if needed. Reviewers try Delete account,
// so the account coming back on the next sign-in keeps the login working for every review.
//
// One-time setup: Supabase > Edge Functions > Secrets > REVIEW_CODE, 8 digits. Put the same code in App Store
// Connect > App Review Information > Sign-in required, with the review address as the user name.
// To turn the review login off, delete the secret.
//
// Deploy:  npx supabase functions deploy review-login --project-ref sjxxiammvvfxcnukkqhg --no-verify-jwt
// (--no-verify-jwt because the app calls it before anyone is signed in; the code is the check.)

import { createClient } from "npm:@supabase/supabase-js@2";

const REVIEW_EMAIL = "appreview@wearecomuna.com";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } });
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, apikey, content-type, x-client-info" };

// compares without stopping at the first wrong digit, so the time taken gives nothing away
const same = (a: string, b: string) => a.length === b.length && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
  const code = Deno.env.get("REVIEW_CODE");
  const { email, token } = await req.json().catch(() => ({}));
  if (!code || email !== REVIEW_EMAIL || typeof token !== "string" || !same(token, code)) return reply({ error: "That code didn't work." }, 401);

  // a one-time sign-in link for the account, which the app turns into a session
  let link = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) {
    const made = await db.auth.admin.createUser({ email, email_confirm: true });
    if (made.error) return reply({ error: made.error.message }, 500);
    link = await db.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) return reply({ error: link.error.message }, 500);
  }
  return reply({ token_hash: link.data.properties.hashed_token });
});
