import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ChatId = z.object({ chat_id: z.string().uuid() });
const NightId = z.object({ night_id: z.string().uuid() });

// ---------- get / list ----------

export const getNightChat = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => NightId.parse(d))
  .handler(async ({ data, context }) => {
    const { data: chat, error } = await context.supabase
      .from("night_chats" as any)
      .select("id,night_id,status,created_at,closed_at")
      .eq("night_id", data.night_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!chat) throw new Error("Chat not found");
    return chat as any;
  });

export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      chat_id: z.string().uuid(),
      before: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("night_chat_messages" as any)
      .select("id,chat_id,sender_id,kind,body,reply_to_id,system_event,metadata,created_at,edited_at,deleted_at")
      .eq("chat_id", data.chat_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.before) q = q.lt("created_at", data.before);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).reverse();
  });

export const listReactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ChatId.parse(d))
  .handler(async ({ data, context }) => {
    const { data: msgs } = await context.supabase
      .from("night_chat_messages" as any)
      .select("id")
      .eq("chat_id", data.chat_id)
      .order("created_at", { ascending: false })
      .limit(300);
    const ids = (msgs ?? []).map((m: any) => m.id);
    if (!ids.length) return [];
    const { data: rows, error } = await context.supabase
      .from("night_chat_reactions" as any)
      .select("id,message_id,user_id,emoji")
      .in("message_id", ids);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listPins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ChatId.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("night_chat_pins" as any)
      .select("message_id,pinned_by,pinned_at")
      .eq("chat_id", data.chat_id);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------- send / edit / delete ----------

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      chat_id: z.string().uuid(),
      body: z.string().trim().max(2000).optional().default(""),
      reply_to_id: z.string().uuid().nullable().optional(),
      kind: z.enum(["text", "image", "gif"]).optional().default("text"),
      metadata: z.record(z.string(), z.any()).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const body = (data.body ?? "").trim();
    if (data.kind === "text" && !body) {
      throw new Error("Message body is required");
    }
    if ((data.kind === "image" || data.kind === "gif") && !data.metadata) {
      throw new Error("Media metadata is required");
    }
    const { data: row, error } = await context.supabase
      .from("night_chat_messages" as any)
      .insert({
        chat_id: data.chat_id,
        sender_id: context.userId,
        kind: data.kind ?? "text",
        body: body || null,
        reply_to_id: data.reply_to_id ?? null,
        metadata: data.metadata ?? {},
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    // Await push delivery — on Cloudflare Workers, background promises after
    // the response is sent get terminated, so fire-and-forget silently drops.
    const preview =
      data.kind === "image" ? "📷 Photo" : data.kind === "gif" ? "🎞️ GIF" : body;
    try {
      await notifyChatParticipantsOfNewMessage(data.chat_id, context.userId, preview);
    } catch (e) {
      console.error("chat push failed", e);
    }
    return { ok: true, id: (row as any).id };
  });

export const editMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      message_id: z.string().uuid(),
      body: z.string().trim().min(1).max(2000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("night_chat_messages" as any)
      .update({ body: data.body, edited_at: new Date().toISOString() })
      .eq("id", data.message_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ message_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Soft-delete: replace body + mark deleted_at. RLS ensures own-or-admin.
    const { error } = await context.supabase
      .from("night_chat_messages" as any)
      .update({ body: null, deleted_at: new Date().toISOString(), deleted_by: context.userId })
      .eq("id", data.message_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- reactions ----------

export const toggleReaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      message_id: z.string().uuid(),
      emoji: z.string().min(1).max(16),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("night_chat_reactions" as any)
      .select("id")
      .eq("message_id", data.message_id)
      .eq("user_id", context.userId)
      .eq("emoji", data.emoji)
      .maybeSingle();
    if (existing) {
      await context.supabase.from("night_chat_reactions" as any).delete().eq("id", (existing as any).id);
      return { ok: true, removed: true };
    }
    const { error } = await context.supabase.from("night_chat_reactions" as any).insert({
      message_id: data.message_id,
      user_id: context.userId,
      emoji: data.emoji,
    });
    if (error) throw new Error(error.message);
    return { ok: true, removed: false };
  });

// ---------- reads / unread ----------

export const markRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      chat_id: z.string().uuid(),
      last_read_message_id: z.string().uuid().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload = {
      chat_id: data.chat_id,
      user_id: context.userId,
      last_read_message_id: data.last_read_message_id ?? null,
      last_read_at: new Date().toISOString(),
    };
    const { error } = await context.supabase
      .from("night_chat_reads" as any)
      .upsert(payload, { onConflict: "chat_id,user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- pins (admin only via RLS) ----------

export const pinMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ chat_id: z.string().uuid(), message_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("night_chat_pins" as any).insert({
      chat_id: data.chat_id,
      message_id: data.message_id,
      pinned_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unpinMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ chat_id: z.string().uuid(), message_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("night_chat_pins" as any)
      .delete()
      .eq("chat_id", data.chat_id)
      .eq("message_id", data.message_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- list all chats a user can see (for /chats index) ----------

export const listMyChats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // RLS filters night_chats to those the user can access.
    const { data: chats, error } = await context.supabase
      .from("night_chats" as any)
      .select("id,night_id,status,created_at,closed_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const list = (chats ?? []) as any[];
    if (!list.length) return [];

    const nightIds = list.map((c) => c.night_id);
    const { data: nights } = await context.supabase
      .from("poker_nights")
      .select("id,title,starts_at,location,status")
      .in("id", nightIds);

    const chatIds = list.map((c) => c.id);
    const { data: reads } = await context.supabase
      .from("night_chat_reads" as any)
      .select("chat_id,last_read_at")
      .in("chat_id", chatIds)
      .eq("user_id", context.userId);
    const readMap = new Map<string, string>();
    for (const r of (reads ?? []) as any[]) readMap.set(r.chat_id, r.last_read_at);

    // Latest message + unread count per chat.
    const results: any[] = [];
    for (const c of list) {
      const { data: last } = await context.supabase
        .from("night_chat_messages" as any)
        .select("id,kind,body,system_event,created_at,sender_id")
        .eq("chat_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastRead = readMap.get(c.id);
      let unread = 0;
      if (last) {
        const { count } = await context.supabase
          .from("night_chat_messages" as any)
          .select("id", { count: "exact", head: true })
          .eq("chat_id", c.id)
          .neq("sender_id", context.userId)
          .neq("kind", "system")
          .gt("created_at", lastRead ?? "1970-01-01");
        unread = count ?? 0;
      }
      const night = (nights ?? []).find((n: any) => n.id === c.night_id) as any;
      results.push({
        chat_id: c.id,
        night,
        status: c.status,
        last_message: last,
        unread,
      });
    }
    results.sort((a, b) => {
      const ta = a.last_message?.created_at ?? a.night?.starts_at ?? "";
      const tb = b.last_message?.created_at ?? b.night?.starts_at ?? "";
      return tb.localeCompare(ta);
    });
    return results;
  });

// Fetch the participants (host + rsvps + invitations) to render names & unread badges.
export const listChatParticipants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => NightId.parse(d))
  .handler(async ({ data, context }) => {
    const { data: night } = await context.supabase
      .from("poker_nights")
      .select("host_id,rebuy_manager_id")
      .eq("id", data.night_id)
      .maybeSingle();
    const { data: rsvps } = await context.supabase
      .from("rsvps")
      .select("user_id")
      .eq("night_id", data.night_id);
    const { data: invs } = await context.supabase
      .from("invitations")
      .select("invited_user_id")
      .eq("night_id", data.night_id);
    const ids = new Set<string>();
    if (night?.host_id) ids.add(night.host_id);
    if (night?.rebuy_manager_id) ids.add(night.rebuy_manager_id);
    for (const r of (rsvps ?? []) as any[]) if (r.user_id) ids.add(r.user_id);
    for (const i of (invs ?? []) as any[]) if (i.invited_user_id) ids.add(i.invited_user_id);
    if (!ids.size) return { host_id: night?.host_id ?? null, profiles: [] };
    const { data: profiles } = await context.supabase
      .from("profiles")
      .select("id,name,nickname,avatar_url")
      .in("id", Array.from(ids));
    return { host_id: night?.host_id ?? null, profiles: profiles ?? [] };
  });

// ---------- mute a specific chat ----------

export const getChatMuted = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ChatId.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("night_chat_mutes" as any)
      .select("chat_id")
      .eq("chat_id", data.chat_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    return { muted: !!row };
  });

export const setChatMuted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ chat_id: z.string().uuid(), muted: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.muted) {
      const { error } = await context.supabase
        .from("night_chat_mutes" as any)
        .upsert(
          { chat_id: data.chat_id, user_id: context.userId },
          { onConflict: "chat_id,user_id" },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase
        .from("night_chat_mutes" as any)
        .delete()
        .eq("chat_id", data.chat_id)
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ---------- total unread across all my chats (for nav badge) ----------

export const getMyUnreadChatCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // RLS scopes chats to those the user can access.
    const { data: chats } = await context.supabase
      .from("night_chats" as any)
      .select("id")
      .eq("status", "open");
    const chatIds = (chats ?? []).map((c: any) => c.id);
    if (!chatIds.length) return { count: 0 };

    const [{ data: reads }, { data: mutes }] = await Promise.all([
      context.supabase
        .from("night_chat_reads" as any)
        .select("chat_id,last_read_at")
        .in("chat_id", chatIds)
        .eq("user_id", context.userId),
      context.supabase
        .from("night_chat_mutes" as any)
        .select("chat_id")
        .in("chat_id", chatIds)
        .eq("user_id", context.userId),
    ]);
    const readMap = new Map<string, string>();
    for (const r of (reads ?? []) as any[]) readMap.set(r.chat_id, r.last_read_at);
    const muted = new Set<string>((mutes ?? []).map((m: any) => m.chat_id));

    let total = 0;
    for (const cid of chatIds) {
      if (muted.has(cid)) continue;
      const lastRead = readMap.get(cid) ?? "1970-01-01";
      const { count } = await context.supabase
        .from("night_chat_messages" as any)
        .select("id", { count: "exact", head: true })
        .eq("chat_id", cid)
        .neq("sender_id", context.userId)
        .neq("kind", "system")
        .gt("created_at", lastRead);
      total += count ?? 0;
    }
    return { count: total };
  });

// ---------- image upload signing ----------

// Sign a storage path so the sender can view/download the image they uploaded.
export const signChatImage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ path: z.string().min(1).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: signed, error } = await context.supabase.storage
      .from("chat-images")
      .createSignedUrl(data.path, 60 * 60 * 24 * 7); // 7 days
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

// ---------- KLIPY GIF search ----------

export const searchGifs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      q: z.string().trim().max(80).optional().default(""),
      page: z.number().int().min(1).max(20).optional().default(1),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const klipyKey = process.env.KLIPY_API_KEY;
    if (!lovableKey || !klipyKey) throw new Error("GIF search is not configured");
    const customerId = context.userId;
    const base = "https://connector-gateway.lovable.dev/klipy/gifs";
    const endpoint = data.q ? "search" : "trending";
    const params = new URLSearchParams({
      customer_id: customerId,
      page: String(data.page),
      per_page: "24",
    });
    if (data.q) params.set("q", data.q);
    const res = await fetch(`${base}/${endpoint}?${params}`, {
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": klipyKey,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`KLIPY error [${res.status}]: ${body}`);
      throw new Error(`GIF search failed (${res.status})`);
    }
    const json = (await res.json()) as any;
    if (!json.result) {
      console.error("KLIPY 2xx failure:", json);
      throw new Error("GIF search failed");
    }
    const items = ((json.data?.data ?? []) as any[]).map((g) => {
      const file = g.file ?? {};
      const pick = (size: string, fmt: string) => file?.[size]?.[fmt]?.url as string | undefined;
      // Prefer animated .gif URLs — iOS Safari autoplays these reliably.
      // Some sizes on KLIPY can be a still-frame poster; sm/md/hd .gif URLs
      // are the animated variants, so use those explicitly for both preview
      // and full sends.
      const preview =
        pick("md", "gif") || pick("sm", "gif") || pick("hd", "gif") || pick("xs", "gif");
      const full =
        pick("md", "gif") || pick("hd", "gif") || pick("sm", "gif") || pick("xs", "gif");
      const mp4 =
        pick("md", "mp4") || pick("hd", "mp4") || pick("sm", "mp4") || pick("xs", "mp4");
      const webp =
        pick("md", "webp") || pick("hd", "webp") || pick("sm", "webp") || pick("xs", "webp");
      const dims = file?.md?.gif ?? file?.hd?.gif ?? file?.sm?.gif ?? {};
      return {
        id: String(g.id ?? g.slug ?? preview ?? ""),
        slug: g.slug ?? "",
        title: g.title ?? "",
        preview_url: preview ?? full ?? "",
        url: full ?? preview ?? "",
        mp4_url: mp4 ?? "",
        webp_url: webp ?? "",
        width: Number(dims.width ?? 0),
        height: Number(dims.height ?? 0),
      };
    }).filter((x) => x.url);
    return { items, has_next: !!json.data?.has_next };
  });

// ---------- push helper (server-only) ----------

async function notifyChatParticipantsOfNewMessage(
  chatId: string,
  senderId: string,
  body: string,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sendPushToUsers } = await import("./push-send.server");

  console.log("[chat-push] start", { chatId, senderId });
  const { data: chat } = await supabaseAdmin
    .from("night_chats" as any)
    .select("id, night_id, status")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat || (chat as any).status !== "open") {
    console.log("[chat-push] skip: chat missing or closed", { chat });
    return;
  }
  const nightId = (chat as any).night_id as string;

  const [{ data: night }, { data: sender }, { data: rsvps }, { data: invs }, { data: mutes }] =
    await Promise.all([
      supabaseAdmin
        .from("poker_nights")
        .select("id, title, host_id, rebuy_manager_id")
        .eq("id", nightId)
        .maybeSingle(),
      supabaseAdmin
        .from("profiles")
        .select("name, nickname, email")
        .eq("id", senderId)
        .maybeSingle(),
      supabaseAdmin.from("rsvps").select("user_id, status").eq("night_id", nightId),
      supabaseAdmin.from("invitations").select("invited_user_id").eq("night_id", nightId),
      supabaseAdmin.from("night_chat_mutes" as any).select("user_id").eq("chat_id", chatId),
    ]);
  if (!night) return;

  const targets = new Set<string>();
  if ((night as any).host_id) targets.add((night as any).host_id as string);
  if ((night as any).rebuy_manager_id) targets.add((night as any).rebuy_manager_id as string);
  for (const r of (rsvps ?? []) as any[]) {
    if (r.user_id) targets.add(r.user_id);
  }
  for (const i of (invs ?? []) as any[]) if (i.invited_user_id) targets.add(i.invited_user_id);
  targets.delete(senderId);
  for (const m of (mutes ?? []) as any[]) targets.delete(m.user_id);
  console.log("[chat-push] targets", {
    count: targets.size,
    rsvps: (rsvps ?? []).length,
    invs: (invs ?? []).length,
    mutes: (mutes ?? []).length,
  });
  if (targets.size === 0) return;

  const who =
    ((sender as any)?.nickname && (sender as any).nickname.trim()) ||
    ((sender as any)?.name && (sender as any).name.trim()) ||
    (sender as any)?.email ||
    "Someone";
  const preview = body.length > 120 ? body.slice(0, 117) + "…" : body;

  const res = await sendPushToUsers(Array.from(targets), "chat_message", {
    title: `💬 ${who} · ${(night as any).title}`,
    body: preview,
    url: `/nights/${nightId}/chat`,
    tag: `chat-${chatId}`,
  });
  console.log("[chat-push] delivered", res);
}
