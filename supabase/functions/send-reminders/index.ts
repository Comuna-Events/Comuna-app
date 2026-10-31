// Sends "starts in an hour" reminders to the iPhone app. The database calls this every 10 minutes (see
// ../../push.sql); each run sends every reminder from due_push_reminders() through Apple's push service (APNs)
// and records it in push_reminders_sent, so each plan gets one reminder.
//
// One-time setup, in Supabase > Edge Functions > Secrets (from developer.apple.com > Certificates, IDs & Profiles >
// Keys, a key with "Apple Push Notifications service (APNs)" ticked):
//   APNS_KEY_ID   the key's 10-character Key ID
//   APNS_TEAM_ID  the 10-character Team ID (top right of the developer site)
//   APNS_KEY      the whole .p8 file, including the BEGIN and END lines
// Until all three are set, each run returns "not configured" and sends nothing.
//
// A token from a build run from Xcode only works on Apple's sandbox service, and one from TestFlight or the App Store
// only on production. A token we haven't sent to yet tries production, then sandbox, and remembers which one worked.
//
// Deploy:  npx supabase functions deploy send-reminders --project-ref sjxxiammvvfxcnukkqhg --no-verify-jwt
// (--no-verify-jwt because it checks the x-ingest-secret header itself, the same secret as the nightly ingest.)

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BUNDLE_ID = "com.wearecomuna.app";
const HOSTS = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" };
type Env = keyof typeof HOSTS;

type Due = { user_id: string; event_id: string; occurrence_date: string; title: string; venue: string | null;
  starts_at: string; token: string; environment: Env | null };

const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b as ArrayBuffer)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// APNs accepts a signed token for up to an hour; one per run is plenty
async function apnsJwt(keyId: string, teamId: string, p8: string): Promise<string> {
  const der = Uint8Array.from(atob(p8.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const body = `${b64url(JSON.stringify({ alg: "ES256", kid: keyId }))}.${b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }))}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}

// 6:30 PM, the way the app writes times
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US",
  { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });

async function send(jwt: string, env: Env, r: Due): Promise<{ status: number; reason?: string }> {
  const res = await fetch(`${HOSTS[env]}/3/device/${r.token}`, {
    method: "POST",
    headers: { authorization: `bearer ${jwt}`, "apns-topic": BUNDLE_ID, "apns-push-type": "alert",
      "apns-priority": "10", "apns-expiration": String(Math.floor(new Date(r.starts_at).getTime() / 1000)) },
    body: JSON.stringify({
      aps: { alert: { title: `${r.title} starts at ${clock(r.starts_at)}`,
        body: `${r.venue ? r.venue + ". " : ""}Check in when you get there to collect the stamp.` }, sound: "default" },
      event_id: r.event_id, date: r.occurrence_date,
    }),
  });
  const reason = res.status === 200 ? undefined : (await res.json().catch(() => ({}))).reason;
  return { status: res.status, reason };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-ingest-secret") !== Deno.env.get("INGEST_SECRET")) return new Response("forbidden", { status: 403 });
  const keyId = Deno.env.get("APNS_KEY_ID"), teamId = Deno.env.get("APNS_TEAM_ID"), p8 = Deno.env.get("APNS_KEY");
  if (!keyId || !teamId || !p8) return Response.json({ sent: 0, note: "not configured: set APNS_KEY_ID, APNS_TEAM_ID and APNS_KEY" });

  const { data, error } = await db.rpc("due_push_reminders");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const due = (data ?? []) as Due[];
  if (!due.length) return Response.json({ sent: 0 });

  const jwt = await apnsJwt(keyId, teamId, p8);
  let sent = 0;
  const failed: string[] = [], done = new Set<string>();
  for (const r of due) {
    const envs: Env[] = r.environment ? [r.environment] : ["production", "sandbox"];
    let ok = false, gone = false;
    for (const env of envs) {
      const { status, reason } = await send(jwt, env, r);
      if (status === 200) {
        ok = true;
        if (!r.environment) await db.from("push_tokens").update({ environment: env }).eq("token", r.token);
        break;
      }
      // BadDeviceToken from the wrong service means try the other one; Unregistered means the app was deleted
      gone = status === 410 || reason === "BadDeviceToken";
      if (!gone) { failed.push(`${r.event_id}: ${status} ${reason ?? ""}`.trim()); break; }
    }
    if (ok) sent++;
    else if (gone) await db.from("push_tokens").delete().eq("token", r.token);
    // one record per plan, even when the person has two phones; a failure that isn't the token's fault retries next run
    const plan = `${r.user_id}|${r.event_id}|${r.occurrence_date}`;
    if ((ok || gone) && !done.has(plan)) {
      done.add(plan);
      await db.from("push_reminders_sent").upsert({ user_id: r.user_id, event_id: r.event_id, occurrence_date: r.occurrence_date });
    }
  }
  return Response.json({ sent, failed });
});
