// Sends the apps' notifications. The database calls this every 10 minutes (see ../../push.sql); each run sends what's
// due through Apple's push service (APNs, iPhone) or Firebase Cloud Messaging (FCM, Android) and records it, so
// nothing is sent twice:
//   "starts at 6:30 PM" an hour before each saved plan       due_push_reminders() -> push_reminders_sent
//   "2 plans today", "Tomorrow: ... grab tickets" and "New for you"   due_push_extras() -> push_sent
// Each kind can be turned off in the app (Profile > Reminders, the push_prefs table); the SQL leaves those out.
//
// One-time setup, in Supabase > Edge Functions > Secrets (from developer.apple.com > Certificates, IDs & Profiles >
// Keys, a key with "Apple Push Notifications service (APNs)" ticked):
//   APNS_KEY_ID   the key's 10-character Key ID
//   APNS_TEAM_ID  the 10-character Team ID (top right of the developer site)
//   APNS_KEY      the whole .p8 file, including the BEGIN and END lines
// Android, from Firebase console > Project settings > Service accounts > Generate new private key (ANDROID.md):
//   FCM_SERVICE_ACCOUNT  the whole downloaded .json file
// Until one of the two is set, each run returns "not configured" and sends nothing; with only one, the other kind of
// phone is skipped.
//
// To check the key without waiting for a reminder, call it with ?check (SQL Editor, as in push.sql, with the url
// ending in send-reminders?check). It sends to a made-up phone: "BadDeviceToken" from both services means Apple
// accepted the key; "InvalidProviderToken" or "ExpiredProviderToken" means the key ID, team ID or key is wrong. For
// Firebase, "INVALID_ARGUMENT" means the service account works (the made-up token is what's wrong); an auth error
// means the secret isn't right.
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

type Phone = { user_id: string; token: string; environment: Env | null; platform?: "ios" | "android" };
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

// Firebase: a service account signs a token, Google swaps it for an access token (good for an hour; one per run)
type Fcm = { project: string; access: string };
async function fcmAuth(json: string): Promise<Fcm> {
  const sa = JSON.parse(json);
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body));
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${body}.${b64url(sig)}` }) });
  const j = await res.json();
  if (!j.access_token) throw new Error(`Firebase sign-in failed: ${j.error_description ?? j.error ?? res.status}`);
  return { project: sa.project_id, access: j.access_token };
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

// Android, through Firebase. The "reminders" channel is the one native.js makes; tag replaces an earlier version of the
// same notification, like apns-collapse-id. UNREGISTERED (404) means the app was deleted; INVALID_ARGUMENT here means
// the token is broken (the message itself is always valid), so both remove the token.
async function sendFcm(fcm: Fcm, token: string, p: Push, validateOnly = false): Promise<{ status: number; reason?: string }> {
  const ttl = Math.max(0, p.expires - Math.floor(Date.now() / 1000));
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${fcm.project}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${fcm.access}`, "content-type": "application/json" },
    body: JSON.stringify({ validate_only: validateOnly, message: { token, notification: { title: p.title, body: p.body }, data: p.data,
      android: { priority: "HIGH", ttl: `${ttl}s`, collapse_key: p.collapse,
        notification: { channel_id: "reminders", tag: p.collapse, sound: "default" } } } }),
  });
  if (res.ok) return { status: 200 };
  const e = (await res.json().catch(() => ({}))).error ?? {};
  const code = (e.details ?? []).find((d: { errorCode?: string }) => d.errorCode)?.errorCode ?? e.status;
  return { status: res.status, reason: code };
}

// Sends each row to its phone. An iPhone token we haven't sent to yet tries production, then sandbox, and remembers
// which worked; a dead token (the app was deleted) is removed. `record` runs once per notification (key), even when
// someone has two phones; a failure that isn't the token's fault isn't recorded, so the next run tries again. A phone
// whose service isn't set up (no APNs or no Firebase secret) is skipped.
async function deliver<R extends Phone>(jwt: string, fcm: Fcm | null, rows: R[], push: (r: R) => Push, key: (r: R) => string,
  record: (r: R) => PromiseLike<unknown>) {
  let sent = 0;
  const failed: string[] = [], done = new Set<string>();
  for (const r of rows) {
    const p = push(r);
    let ok = false, gone = false;
    if (r.platform === "android") {
      if (!fcm) continue;
      const { status, reason } = await sendFcm(fcm, r.token, p);
      ok = status === 200;
      gone = reason === "UNREGISTERED" || reason === "INVALID_ARGUMENT" || status === 404;
      if (!ok && !gone) failed.push(`${key(r)}: ${status} ${reason ?? ""}`.trim());
    } else if (!jwt) continue;
    const envs: Env[] = r.platform === "android" ? [] : r.environment ? [r.environment] : ["production", "sandbox"];
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
  const fcmJson = Deno.env.get("FCM_SERVICE_ACCOUNT");
  const apns = !!(keyId && teamId && p8);
  if (!apns && !fcmJson) return Response.json({ sent: 0, note: "not configured: set APNS_KEY_ID, APNS_TEAM_ID and APNS_KEY, or FCM_SERVICE_ACCOUNT" });

  if (new URL(req.url).searchParams.has("check")) {
    const test: Push = { title: "Test", body: "Test", data: {}, expires: hours(1), collapse: "check" };
    let ios: unknown = "not configured", android: unknown = "not configured";
    if (apns) {
      const jwt = await apnsJwt(keyId!, teamId!, p8!).catch(() => "");
      ios = !jwt ? "APNS_KEY isn't a readable .p8 key" : Object.fromEntries(await Promise.all((["production", "sandbox"] as Env[])
        .map(async (env) => [env, await send(jwt, env, "0".repeat(64), test)])));
    }
    if (fcmJson) android = await fcmAuth(fcmJson).then((f) => sendFcm(f, "made-up-token", test, true), (e) => String(e.message ?? e));
    return Response.json({ check: { ios, android } });
  }

  const [hour, more] = await Promise.all([db.rpc("due_push_reminders"), db.rpc("due_push_extras")]);
  if (hour.error) return Response.json({ error: hour.error.message }, { status: 500 });
  const due = (hour.data ?? []) as Due[];
  // until push.sql is re-run there's no due_push_extras(): keep sending the hour-before reminders
  const extras = (more.error ? [] : more.data ?? []) as Extra[];
  if (!due.length && !extras.length) return Response.json({ sent: 0, ...(more.error ? { note: more.error.message } : {}) });

  // which phones are Android (the due_* functions return tokens, not platforms)
  const tokens = [...new Set([...due, ...extras].map((r) => r.token))];
  const { data: kinds } = await db.from("push_tokens").select("token, platform").in("token", tokens);
  const platform = new Map((kinds ?? []).map((k: { token: string; platform: "ios" | "android" }) => [k.token, k.platform]));
  for (const r of [...due, ...extras]) r.platform = platform.get(r.token) ?? "ios";

  const jwt = apns ? await apnsJwt(keyId!, teamId!, p8!) : "";
  let fcm: Fcm | null = null, fcmError = "";
  if (fcmJson && [...due, ...extras].some((r) => r.platform === "android")) {
    try { fcm = await fcmAuth(fcmJson); } catch (e) { fcmError = String((e as Error).message ?? e); }
  }
  const a = await deliver(jwt, fcm, due, hourBefore, (r) => `${r.user_id}|${r.event_id}|${r.occurrence_date}`,
    (r) => db.from("push_reminders_sent").upsert({ user_id: r.user_id, event_id: r.event_id, occurrence_date: r.occurrence_date }));
  const b = await deliver(jwt, fcm, extras, extra, (r) => `${r.user_id}|${r.kind}|${r.ref}`,
    (r) => db.from("push_sent").upsert({ user_id: r.user_id, kind: r.kind, ref: r.ref }));
  return Response.json({ sent: a.sent + b.sent, failed: [...a.failed, ...b.failed], ...(fcmError ? { note: fcmError } : {}) });
});
