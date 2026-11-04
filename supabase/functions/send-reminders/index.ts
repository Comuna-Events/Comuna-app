// Sends the iPhone app's notifications. The database calls this every 10 minutes (see ../../push.sql); each run sends
// what's due through Apple's push service (APNs) and records it, so nothing is sent twice:
//   "starts at 6:30 PM" an hour before each saved plan       due_push_reminders() -> push_reminders_sent
//   "2 plans today", "Tomorrow: ... grab tickets" and "New for you"   due_push_extras() -> push_sent
// Each kind can be turned off in the app (Profile > Reminders, the push_prefs table); the SQL leaves those out.
//
// One-time setup, in Supabase > Edge Functions > Secrets (from developer.apple.com > Certificates, IDs & Profiles >
// Keys, a key with "Apple Push Notifications service (APNs)" ticked):
//   APNS_KEY_ID   the key's 10-character Key ID
//   APNS_TEAM_ID  the 10-character Team ID (top right of the developer site)
//   APNS_KEY      the whole .p8 file, including the BEGIN and END lines
// Until all three are set, each run returns "not configured" and sends nothing.
//
// To check the key without waiting for a reminder, call it with ?check (SQL Editor, as in push.sql, with the url
// ending in send-reminders?check). It sends to a made-up phone: "BadDeviceToken" from both services means Apple
// accepted the key; "InvalidProviderToken" or "ExpiredProviderToken" means the key ID, team ID or key is wrong.
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

type Phone = { user_id: string; token: string; environment: Env | null };
type Due = Phone & { event_id: string; occurrence_date: string; title: string; venue: string | null; starts_at: string };
type Item = { event_id: string; name: string; venue: string | null; date: string | null; starts_at: string | null };
type Extra = Phone & { kind: "plans_today" | "tickets" | "new_for_you"; ref: string; items: Item[] };
type Push = { title: string; body: string; data: Record<string, string>; expires: number; collapse: string };

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
// event names come from hosts and can run long
const short = (s: string, n = 60) => s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
const hours = (h: number) => Math.floor(Date.now() / 1000) + h * 3600;

function hourBefore(r: Due): Push {
  return { title: `${short(r.title)} starts at ${clock(r.starts_at)}`,
    body: `${r.venue ? r.venue + ". " : ""}Check in when you get there to collect the stamp.`,
    data: { event_id: r.event_id, date: r.occurrence_date },
    expires: Math.floor(new Date(r.starts_at).getTime() / 1000), collapse: `hour:${r.event_id}:${r.occurrence_date}` };
}

function extra(r: Extra): Push {
  const [first] = r.items, one = r.items.length === 1, at = (i: Item) => i.starts_at ? clock(i.starts_at) : "";
  const collapse = `${r.kind}:${r.ref}`.slice(0, 64), expires = hours(3);
  if (r.kind === "plans_today") return one
    ? { title: `Today: ${short(first.name)}`, collapse, expires,
        body: [at(first), first.venue].filter(Boolean).join(" at ") + ". Check in when you get there for the stamp.",
        data: { event_id: first.event_id, date: first.date ?? "" } }
    : { title: `${r.items.length} plans today`, collapse, expires,
        body: r.items.map((i) => at(i) ? `${short(i.name, 40)} at ${at(i)}` : short(i.name, 40)).join(" · "),
        data: { screen: "plans" } };
  if (r.kind === "tickets") return { title: `Tomorrow: ${short(first.name)}`, collapse, expires,
    body: `${at(first) ? `Starts at ${at(first)}. ` : ""}It needs an RSVP or tickets, so grab yours on the host's page before it fills up.`,
    data: { event_id: first.event_id, date: first.date ?? "" } };
  return one
    ? { title: `New for you: ${short(first.name)}`, body: `${first.venue ? first.venue + ". " : ""}Just added to Comuna.`,
        data: { event_id: first.event_id }, collapse, expires: hours(12) }
    : { title: `${r.items.length} new for you this week`, body: r.items.map((i) => short(i.name, 40)).join(" · "),
        data: {}, collapse, expires: hours(12) };
}

async function send(jwt: string, env: Env, token: string, p: Push): Promise<{ status: number; reason?: string }> {
  const res = await fetch(`${HOSTS[env]}/3/device/${token}`, {
    method: "POST",
    headers: { authorization: `bearer ${jwt}`, "apns-topic": BUNDLE_ID, "apns-push-type": "alert",
      "apns-priority": "10", "apns-expiration": String(p.expires), "apns-collapse-id": p.collapse },
    body: JSON.stringify({ aps: { alert: { title: p.title, body: p.body }, sound: "default",
      "thread-id": p.collapse.split(":")[0] }, ...p.data }),
  });
  const reason = res.status === 200 ? undefined : (await res.json().catch(() => ({}))).reason;
  return { status: res.status, reason };
}

// Sends each row to its phone. A token we haven't sent to yet tries production, then sandbox, and remembers which
// worked; a dead token (the app was deleted) is removed. `record` runs once per notification (key), even when someone
// has two phones; a failure that isn't the token's fault isn't recorded, so the next run tries again.
async function deliver<R extends Phone>(jwt: string, rows: R[], push: (r: R) => Push, key: (r: R) => string,
  record: (r: R) => PromiseLike<unknown>) {
  let sent = 0;
  const failed: string[] = [], done = new Set<string>();
  for (const r of rows) {
    const p = push(r), envs: Env[] = r.environment ? [r.environment] : ["production", "sandbox"];
    let ok = false, gone = false;
    for (const env of envs) {
      const { status, reason } = await send(jwt, env, r.token, p);
      if (status === 200) {
        ok = true;
        if (!r.environment) await db.from("push_tokens").update({ environment: env }).eq("token", r.token);
        break;
      }
      // BadDeviceToken from the wrong service means try the other one; Unregistered means the app was deleted
      gone = status === 410 || reason === "BadDeviceToken";
      if (!gone) { failed.push(`${key(r)}: ${status} ${reason ?? ""}`.trim()); break; }
    }
    if (ok) sent++;
    else if (gone) await db.from("push_tokens").delete().eq("token", r.token);
    if ((ok || gone) && !done.has(key(r))) { done.add(key(r)); await record(r); }
  }
  return { sent, failed };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-ingest-secret") !== Deno.env.get("INGEST_SECRET")) return new Response("forbidden", { status: 403 });
  const keyId = Deno.env.get("APNS_KEY_ID"), teamId = Deno.env.get("APNS_TEAM_ID"), p8 = Deno.env.get("APNS_KEY");
  if (!keyId || !teamId || !p8) return Response.json({ sent: 0, note: "not configured: set APNS_KEY_ID, APNS_TEAM_ID and APNS_KEY" });

  if (new URL(req.url).searchParams.has("check")) {
    const jwt = await apnsJwt(keyId, teamId, p8).catch(() => "");
    if (!jwt) return Response.json({ check: "APNS_KEY isn't a readable .p8 key" });
    const test: Push = { title: "Test", body: "Test", data: {}, expires: hours(1), collapse: "check" };
    const [production, sandbox] = await Promise.all([send(jwt, "production", "0".repeat(64), test), send(jwt, "sandbox", "0".repeat(64), test)]);
    return Response.json({ check: { production, sandbox } });
  }

  const [hour, more] = await Promise.all([db.rpc("due_push_reminders"), db.rpc("due_push_extras")]);
  if (hour.error) return Response.json({ error: hour.error.message }, { status: 500 });
  const due = (hour.data ?? []) as Due[];
  // until push.sql is re-run there's no due_push_extras(): keep sending the hour-before reminders
  const extras = (more.error ? [] : more.data ?? []) as Extra[];
  if (!due.length && !extras.length) return Response.json({ sent: 0, ...(more.error ? { note: more.error.message } : {}) });

  const jwt = await apnsJwt(keyId, teamId, p8);
  const a = await deliver(jwt, due, hourBefore, (r) => `${r.user_id}|${r.event_id}|${r.occurrence_date}`,
    (r) => db.from("push_reminders_sent").upsert({ user_id: r.user_id, event_id: r.event_id, occurrence_date: r.occurrence_date }));
  const b = await deliver(jwt, extras, extra, (r) => `${r.user_id}|${r.kind}|${r.ref}`,
    (r) => db.from("push_sent").upsert({ user_id: r.user_id, kind: r.kind, ref: r.ref }));
  return Response.json({ sent: a.sent + b.sent, failed: [...a.failed, ...b.failed] });
});
