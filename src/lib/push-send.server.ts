import webpush from "web-push";
import { formatNightDetailsTime, getNightIdFromNotificationUrl } from "./push-time.server";

type Preferences = {
  invite_received: boolean;
  reminder_24h: boolean;
  reminder_1h: boolean;
  results_posted: boolean;
  chat_message: boolean;
};

export type PushEvent = keyof Preferences;

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

async function normalizeInvitePayload(supabaseAdmin: any, payload: PushPayload) {
  const nightId = getNightIdFromNotificationUrl(payload.url);
  if (!nightId) return payload;

  const { data: night } = await supabaseAdmin
    .from("poker_nights")
    .select("starts_at, location")
    .eq("id", nightId)
    .maybeSingle();

  if (!night?.starts_at) return payload;

  const when = formatNightDetailsTime(night.starts_at);

  return {
    ...payload,
    body: `${when}${night.location ? " · " + night.location : ""}${/tap to RSVP/i.test(payload.body) ? " — tap to RSVP" : ""}`,
  };
}

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT || "mailto:notifications@example.com";
  if (!pub || !priv) throw new Error("VAPID keys not configured");
  webpush.setVapidDetails(sub, pub, priv);
  configured = true;
}

export async function sendPushToUsers(
  userIds: string[],
  event: PushEvent,
  payload: PushPayload,
) {
  if (userIds.length === 0) return { sent: 0, pruned: 0 };
  ensureConfigured();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const uniq = Array.from(new Set(userIds));

  // Load preferences; default to true when row missing
  const { data: prefsRows } = await supabaseAdmin
    .from("notification_preferences")
    .select("user_id, invite_received, reminder_24h, reminder_1h, results_posted")
    .in("user_id", uniq);
  const prefsMap = new Map<string, Preferences>();
  for (const p of prefsRows ?? []) prefsMap.set(p.user_id as string, p as unknown as Preferences);

  const allowed = uniq.filter((u) => {
    const p = prefsMap.get(u);
    if (!p) return true; // default all on
    if (event === "chat_message") return true; // chat pushes always go through
    return p[event];
  });
  if (allowed.length === 0) return { sent: 0, pruned: 0 };

  const finalPayload = event === "invite_received"
    ? await normalizeInvitePayload(supabaseAdmin, payload)
    : payload;

  // Persist to notifications inbox for every allowed user (independent of delivery).
  await supabaseAdmin.from("notifications").insert(
    allowed.map((uid) => ({
      user_id: uid,
      event,
      title: finalPayload.title,
      body: finalPayload.body,
      url: finalPayload.url ?? null,
    })),
  );

  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", allowed);

  if (!subs || subs.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(finalPayload);
  let sent = 0;
  const stale: string[] = [];
  await Promise.all(
    subs.map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (err: any) {
        const code = err?.statusCode;
        if (code === 404 || code === 410) stale.push(s.id);
        else console.error("push send failed", code, err?.message);
      }
    }),
  );
  if (stale.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", stale);
  }
  return { sent, pruned: stale.length };
}

// Send a push to all of a single user's subscriptions, bypassing preferences.
// Used for the "Send test" button so users can verify delivery.
export async function sendTestPushRaw(userId: string, payload: PushPayload) {
  return sendPushToUserIdsRaw([userId], "test", payload);
}

// Send a push to a list of users, bypassing preferences. Used for admin-only
// system notifications (e.g. new user signed up).
export async function sendPushToUserIdsRaw(
  userIds: string[],
  event: string,
  payload: PushPayload,
) {
  if (userIds.length === 0) return { sent: 0, pruned: 0, noSubs: true };
  ensureConfigured();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const uniq = Array.from(new Set(userIds));
  await supabaseAdmin.from("notifications").insert(
    uniq.map((uid) => ({
      user_id: uid,
      event,
      title: payload.title,
      body: payload.body,
      url: payload.url ?? null,
    })),
  );
  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", uniq);
  if (!subs || subs.length === 0) return { sent: 0, pruned: 0, noSubs: true };
  const body = JSON.stringify(payload);
  let sent = 0;
  const stale: string[] = [];
  await Promise.all(
    subs.map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 },
        );
        sent++;
      } catch (err: any) {
        const code = err?.statusCode;
        if (code === 404 || code === 410) stale.push(s.id);
        else console.error("raw push failed", code, err?.message);
      }
    }),
  );
  if (stale.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", stale);
  }
  return { sent, pruned: stale.length, noSubs: false };
}