import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";


// Notify attendees that results have been posted.
export const notifyResultsPosted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ nightId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { sendPushToUsers } = await import("./push-send.server");
    const { formatNightDetailsTime } = await import("./push-time.server");
    const { data: night } = await context.supabase
      .from("poker_nights")
      .select("id, title")
      .eq("id", data.nightId)
      .maybeSingle();
    if (!night) return { sent: 0 };
    const { data: results } = await context.supabase
      .from("player_results")
      .select("user_id")
      .eq("night_id", data.nightId);
    const userIds = (results ?? [])
      .map((r: any) => r.user_id)
      .filter((x: string | null): x is string => !!x);
    if (userIds.length === 0) return { sent: 0 };
    return sendPushToUsers(userIds, "results_posted", {
      title: `🏆 Results are in — ${night.title}`,
      body: "Tap to see how the night ended.",
      url: `/nights/${night.id}`,
      tag: `night-results-${night.id}`,
    });
  });

// Notify a single invited user (used when the host adds an invite after creation).
export const notifyInvitesSent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        nightId: z.string().uuid(),
        userIds: z.array(z.string().uuid()).max(100),
        whenText: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sendPushToUsers } = await import("./push-send.server");
    const { formatNightDetailsTime } = await import("./push-time.server");
    const { data: night } = await context.supabase
      .from("poker_nights")
      .select("id, title, starts_at, location")
      .eq("id", data.nightId)
      .maybeSingle();
    if (!night) return { sent: 0 };
    const targets = data.userIds.filter((u) => u !== context.userId);
    if (targets.length === 0) return { sent: 0 };
    const when =
      data.whenText ??
      formatNightDetailsTime(night.starts_at);
    return sendPushToUsers(targets, "invite_received", {
      title: `🃏 You're invited: ${night.title}`,
      body: `${when}${night.location ? " · " + night.location : ""}`,
      url: `/nights/${night.id}`,
      tag: `night-invite-${night.id}`,
    });
  });

// Preferences server functions
export const getMyNotificationPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("notification_preferences")
      .select("invite_received, reminder_24h, reminder_1h, results_posted, chat_message")
      .eq("user_id", context.userId)
      .maybeSingle();
    return (
      data ?? {
        invite_received: true,
        reminder_24h: true,
        reminder_1h: true,
        results_posted: true,
        chat_message: true,
      }
    );
  });

export const updateMyNotificationPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        invite_received: z.boolean(),
        reminder_24h: z.boolean(),
        reminder_1h: z.boolean(),
        results_posted: z.boolean(),
        chat_message: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notification_preferences")
      .upsert({ user_id: context.userId, ...data }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Send a test push to the caller's own subscriptions (ignores preferences).
export const sendTestPushToMe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { sendTestPushRaw } = await import("./push-send.server");
    return sendTestPushRaw(context.userId, {
      title: "🎰 Test notification",
      body: "Push is working on this device. See you at the table!",
      url: "/",
      tag: `test-${Date.now()}`,
    });
  });

// Inbox: list, unread count, mark read, delete
export const listMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { formatNightDetailsTime, getNightIdFromNotificationUrl } = await import("./push-time.server");
    const { data, error } = await context.supabase
      .from("notifications")
      .select("id, event, title, body, url, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const nightIds = Array.from(
      new Set(
        rows
          .filter((row) => row.event === "invite_received")
          .map((row) => getNightIdFromNotificationUrl(row.url))
          .filter((id): id is string => !!id),
      ),
    );

    if (nightIds.length === 0) return rows;

    const { data: nights, error: nightsError } = await context.supabase
      .from("poker_nights")
      .select("id, starts_at, location")
      .in("id", nightIds);
    if (nightsError) throw new Error(nightsError.message);

    const nightById = new Map((nights ?? []).map((night) => [night.id, night]));
    return rows.map((row) => {
      if (row.event !== "invite_received") return row;
      const nightId = getNightIdFromNotificationUrl(row.url);
      const night = nightId ? nightById.get(nightId) : null;
      if (!night?.starts_at) return row;
      return {
        ...row,
        body: `${formatNightDetailsTime(night.starts_at)}${night.location ? " · " + night.location : ""}${/tap to RSVP/i.test(row.body) ? " — tap to RSVP" : ""}`,
      };
    });
  });

export const getMyUnreadNotificationCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count, error } = await context.supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMyNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notifications")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Notify all admins when someone RSVPs to a night.
export const notifyAdminsRsvp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        nightId: z.string().uuid(),
        status: z.enum(["attending", "maybe", "declined"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sendPushToUserIdsRaw } = await import("./push-send.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Load night title for context
    const { data: night } = await supabaseAdmin
      .from("poker_nights")
      .select("id, title")
      .eq("id", data.nightId)
      .maybeSingle();
    if (!night) return { sent: 0 };

    // Actor profile (who RSVPed)
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("name, nickname, email")
      .eq("id", context.userId)
      .maybeSingle();
    const who =
      (profile?.nickname && profile.nickname.trim()) ||
      (profile?.name && profile.name.trim()) ||
      profile?.email ||
      "Someone";

    const label =
      data.status === "attending" ? "I'm in" : data.status === "maybe" ? "Maybe" : "Can't";
    const emoji =
      data.status === "attending" ? "✅" : data.status === "maybe" ? "🤔" : "❌";

    // Find all admins
    const { data: admins } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIds = (admins ?? [])
      .map((r: any) => r.user_id as string)
      .filter((id) => !!id);
    if (adminIds.length === 0) return { sent: 0 };

    return sendPushToUserIdsRaw(adminIds, "rsvp_received", {
      title: `${emoji} ${who} RSVPed: ${label}`,
      body: `${night.title}`,
      url: `/nights/${night.id}`,
      tag: `rsvp-${night.id}-${context.userId}`,
    });
  });

// Admin-only: send a reminder push to every registered invitee who hasn't RSVPed or is still on maybe.
export const remindPendingInvitees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ nightId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { sendPushToUserIdsRaw } = await import("./push-send.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const [{ data: night }, { data: invites }, { data: rsvps }] = await Promise.all([
      supabaseAdmin.from("poker_nights").select("id, title, starts_at, location").eq("id", data.nightId).maybeSingle(),
      supabaseAdmin.from("invitations").select("invited_user_id").eq("night_id", data.nightId),
      supabaseAdmin.from("rsvps").select("user_id, status").eq("night_id", data.nightId),
    ]);
    if (!night) return { sent: 0 };

    const rsvpByUserId = new Map((rsvps ?? []).map((r: any) => [r.user_id, r.status]));
    const targets = Array.from(
      new Set(
        (invites ?? [])
          .map((i: any) => i.invited_user_id as string)
          .filter((id): id is string => {
            if (!id) return false;
            const status = rsvpByUserId.get(id);
            return !status || status === "maybe";
          }),
      ),
    );
    if (targets.length === 0) return { sent: 0, targets: 0 };

    const { formatNightDetailsTime } = await import("./push-time.server");
    const when = formatNightDetailsTime(night.starts_at);

    const res = await sendPushToUserIdsRaw(targets, "invite_received", {
      title: `⏰ Reminder: ${night.title}`,
      body: `${when}${night.location ? " · " + night.location : ""} — tap to RSVP`,
      url: `/nights/${night.id}`,
      tag: `reminder-${night.id}-${Date.now()}`,
    });
    return { ...res, targets: targets.length };
  });

// Admin-only: notify everyone invited / RSVPed that a night's buy-in changed.
export const notifyBuyInChanged = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        nightId: z.string().uuid(),
        oldBuyIn: z.number().min(0).max(1_000_000).nullable().optional(),
        newBuyIn: z.number().min(0).max(1_000_000),
        currency: z.string().length(3).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sendPushToUserIdsRaw } = await import("./push-send.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const [{ data: night }, { data: invites }, { data: rsvps }] = await Promise.all([
      supabaseAdmin.from("poker_nights").select("id, title, currency").eq("id", data.nightId).maybeSingle(),
      supabaseAdmin.from("invitations").select("invited_user_id").eq("night_id", data.nightId),
      supabaseAdmin.from("rsvps").select("user_id").eq("night_id", data.nightId),
    ]);
    if (!night) return { sent: 0, targets: 0 };

    const targets = Array.from(
      new Set(
        [
          ...((invites ?? []).map((i: any) => i.invited_user_id as string)),
          ...((rsvps ?? []).map((r: any) => r.user_id as string)),
        ].filter((id): id is string => !!id && id !== context.userId),
      ),
    );
    if (targets.length === 0) return { sent: 0, targets: 0 };

    const cur = (data.currency ?? night.currency ?? "EUR").toUpperCase();
    const fmt = (n: number) => `${n} ${cur}`;
    const body =
      data.oldBuyIn != null && data.oldBuyIn !== data.newBuyIn
        ? `New buy-in: ${fmt(data.newBuyIn)} (was ${fmt(data.oldBuyIn)})`
        : `New buy-in: ${fmt(data.newBuyIn)}`;

    const res = await sendPushToUserIdsRaw(targets, "buyin_changed", {
      title: `💰 Buy-in changed — ${night.title}`,
      body,
      url: `/nights/${night.id}`,
      tag: `buyin-${night.id}-${Date.now()}`,
    });
    return { ...res, targets: targets.length };
  });

// Nudge a debtor that they still owe money on a specific settlement. Caller
// must be the creditor on that settlement (verified via RLS-scoped read).
export const remindSettlementDebtor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ settlementId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { sendPushToUserIdsRaw } = await import("./push-send.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Read as the caller — RLS ensures they can only see their own settlements.
    const { data: s, error } = await context.supabase
      .from("settlements")
      .select("id, amount, status, debtor_id, creditor_id, session_name")
      .eq("id", data.settlementId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!s) throw new Error("Settlement not found");
    if (s.creditor_id !== context.userId) throw new Error("Only the creditor can send a reminder");
    if (!s.debtor_id) throw new Error("No debtor to notify");
    if (["fully_withdrawn", "cancelled", "payment_confirmed", "partially_withdrawn"].includes(s.status as string)) {
      throw new Error("This debt is already settled");
    }

    // Creditor display name for context in the push.
    const { data: me } = await supabaseAdmin
      .from("profiles")
      .select("name, nickname, email")
      .eq("id", context.userId)
      .maybeSingle();
    const who =
      (me?.nickname && me.nickname.trim()) ||
      (me?.name && me.name.trim()) ||
      me?.email ||
      "A player";

    return sendPushToUserIdsRaw([s.debtor_id], "debt_reminder", {
      title: `💸 Reminder from ${who}`,
      body: `You still owe ${Number(s.amount)} from ${s.session_name}. Tap to settle up.`,
      url: `/play/settlements#s-${s.id}`,
      tag: `debt-reminder-${s.id}`,
    });
  });

// Admin-only: notify everyone invited / RSVPed that a night's location changed.
export const notifyLocationChanged = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        nightId: z.string().uuid(),
        oldLocation: z.string().max(200).nullable().optional(),
        newLocation: z.string().max(200).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sendPushToUserIdsRaw } = await import("./push-send.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const [{ data: night }, { data: invites }, { data: rsvps }] = await Promise.all([
      supabaseAdmin.from("poker_nights").select("id, title, starts_at, location").eq("id", data.nightId).maybeSingle(),
      supabaseAdmin.from("invitations").select("invited_user_id").eq("night_id", data.nightId),
      supabaseAdmin.from("rsvps").select("user_id").eq("night_id", data.nightId),
    ]);
    if (!night) return { sent: 0, targets: 0 };

    const targets = Array.from(
      new Set(
        [
          ...((invites ?? []).map((i: any) => i.invited_user_id as string)),
          ...((rsvps ?? []).map((r: any) => r.user_id as string)),
        ].filter((id): id is string => !!id && id !== context.userId),
      ),
    );
    if (targets.length === 0) return { sent: 0, targets: 0 };

    const newLoc = (data.newLocation ?? night.location ?? "").trim();
    const oldLoc = (data.oldLocation ?? "").trim();
    const body = newLoc
      ? oldLoc
        ? `New location: ${newLoc} (was ${oldLoc})`
        : `New location: ${newLoc}`
      : "The location for this game has been updated.";

    const res = await sendPushToUserIdsRaw(targets, "location_changed", {
      title: `📍 Location changed — ${night.title}`,
      body,
      url: `/nights/${night.id}`,
      tag: `location-${night.id}-${Date.now()}`,
    });
    return { ...res, targets: targets.length };
  });

// Admin-only: notify everyone invited / RSVPed (and the caller) that a night's date/time changed.
export const notifyDateChanged = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        nightId: z.string().uuid(),
        oldStartsAt: z.string().datetime().nullable().optional(),
        newStartsAt: z.string().datetime(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sendPushToUserIdsRaw } = await import("./push-send.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { formatNightDetailsTime } = await import("./push-time.server");

    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const [{ data: night }, { data: invites }, { data: rsvps }] = await Promise.all([
      supabaseAdmin.from("poker_nights").select("id, title, starts_at, location").eq("id", data.nightId).maybeSingle(),
      supabaseAdmin.from("invitations").select("invited_user_id").eq("night_id", data.nightId),
      supabaseAdmin.from("rsvps").select("user_id").eq("night_id", data.nightId),
    ]);
    if (!night) return { sent: 0, targets: 0 };

    // Include the caller ("including me") plus all invited / RSVPed users.
    const targets = Array.from(
      new Set(
        [
          context.userId,
          ...((invites ?? []).map((i: any) => i.invited_user_id as string)),
          ...((rsvps ?? []).map((r: any) => r.user_id as string)),
        ].filter((id): id is string => !!id),
      ),
    );
    if (targets.length === 0) return { sent: 0, targets: 0 };

    const newWhen = formatNightDetailsTime(data.newStartsAt);
    const oldWhen = data.oldStartsAt ? formatNightDetailsTime(data.oldStartsAt) : null;
    const body = oldWhen
      ? `New date: ${newWhen} (was ${oldWhen})${night.location ? " · " + night.location : ""}`
      : `New date: ${newWhen}${night.location ? " · " + night.location : ""}`;

    const res = await sendPushToUserIdsRaw(targets, "date_changed", {
      title: `📅 Date changed — ${night.title}`,
      body,
      url: `/nights/${night.id}`,
      tag: `date-${night.id}-${Date.now()}`,
    });
    return { ...res, targets: targets.length };
  });