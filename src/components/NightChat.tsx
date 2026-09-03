import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDisplayName } from "@/lib/poker";
import {
  getNightChat,
  listMessages,
  listReactions,
  listPins,
  sendMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  markRead,
  pinMessage,
  unpinMessage,
  listChatParticipants,
  getChatMuted,
  setChatMuted,
  signChatImage,
  searchGifs,
} from "@/lib/night-chat.functions";
import { usePresence } from "@/hooks/use-presence";
import {
  Send, MessageSquare, Circle, Reply, Smile, Trash2, Pencil, Pin, PinOff,
  X, ChevronDown, Check, CheckCheck, Bell, BellOff, ImagePlus, Sparkles, Loader2, Search,
} from "lucide-react";
import { toast } from "sonner";

type Msg = {
  id: string;
  chat_id: string;
  sender_id: string | null;
  kind: string;
  body: string | null;
  reply_to_id: string | null;
  system_event: string | null;
  metadata: Record<string, any>;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

type Reaction = { id: string; message_id: string; user_id: string; emoji: string };
type Pin = { message_id: string; pinned_by: string | null; pinned_at: string };
type Profile = { id: string; name: string | null; nickname: string | null; avatar_url: string | null };

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "😮", "😢", "🙏"];

// True on coarse-pointer devices (touch phones/tablets). Used to swap hover
// action bars for tap-to-open bars so iPhone users can react, reply, etc.
export function useIsTouch() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: none), (pointer: coarse)");
    const upd = () => setTouch(mq.matches);
    upd();
    mq.addEventListener?.("change", upd);
    return () => mq.removeEventListener?.("change", upd);
  }, []);
  return touch;
}

export function NightChat({
  nightId,
  meId,
  isAdmin,
  variant = "inline",
  onClose,
}: {
  nightId: string;
  meId: string | null;
  isAdmin: boolean;
  variant?: "inline" | "full";
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const getChatFn = useServerFn(getNightChat);
  const listMsgFn = useServerFn(listMessages);
  const listRxFn = useServerFn(listReactions);
  const listPinsFn = useServerFn(listPins);
  const sendFn = useServerFn(sendMessage);
  const editFn = useServerFn(editMessage);
  const delFn = useServerFn(deleteMessage);
  const reactFn = useServerFn(toggleReaction);
  const readFn = useServerFn(markRead);
  const pinFn = useServerFn(pinMessage);
  const unpinFn = useServerFn(unpinMessage);
  const partsFn = useServerFn(listChatParticipants);
  const mutedFn = useServerFn(getChatMuted);
  const setMutedFn = useServerFn(setChatMuted);
  const signImgFn = useServerFn(signChatImage);
  const searchGifsFn = useServerFn(searchGifs);

  const chatQ = useQuery({
    queryKey: ["night-chat", nightId],
    queryFn: () => getChatFn({ data: { night_id: nightId } }) as Promise<any>,
  });
  const chatId: string | undefined = chatQ.data?.id;
  const closed = chatQ.data?.status !== "open";

  const mutedQ = useQuery({
    queryKey: ["night-chat-muted", chatId],
    enabled: !!chatId,
    queryFn: () => mutedFn({ data: { chat_id: chatId! } }) as Promise<{ muted: boolean }>,
  });
  const muted = !!mutedQ.data?.muted;
  const muteMut = useMutation({
    mutationFn: (next: boolean) =>
      setMutedFn({ data: { chat_id: chatId!, muted: next } }) as Promise<unknown>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["night-chat-muted", chatId] });
      qc.invalidateQueries({ queryKey: ["chats-unread"] });
    },
  });

  const messagesQ = useQuery({
    queryKey: ["night-chat-msgs", chatId],
    enabled: !!chatId,
    queryFn: () => listMsgFn({ data: { chat_id: chatId!, limit: 100 } }) as unknown as Promise<Msg[]>,
  });
  const reactionsQ = useQuery({
    queryKey: ["night-chat-rx", chatId],
    enabled: !!chatId,
    queryFn: () => listRxFn({ data: { chat_id: chatId! } }) as unknown as Promise<Reaction[]>,
  });
  const pinsQ = useQuery({
    queryKey: ["night-chat-pins", chatId],
    enabled: !!chatId,
    queryFn: () => listPinsFn({ data: { chat_id: chatId! } }) as unknown as Promise<Pin[]>,
  });
  const participantsQ = useQuery({
    queryKey: ["night-chat-parts", nightId],
    queryFn: () => partsFn({ data: { night_id: nightId } }) as Promise<{ host_id: string | null; profiles: Profile[] }>,
  });
  const profiles = participantsQ.data?.profiles ?? [];
  const nameFor = (uid: string | null) => {
    if (!uid) return "System";
    const p = profiles.find((x) => x.id === uid);
    return p ? formatDisplayName(p.name, p.nickname) : "Player";
  };

  // Realtime
  useEffect(() => {
    if (!chatId) return;
    const ch = supabase
      .channel(`night-chat-${chatId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "night_chat_messages", filter: `chat_id=eq.${chatId}` },
        () => qc.invalidateQueries({ queryKey: ["night-chat-msgs", chatId] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "night_chat_reactions" },
        () => qc.invalidateQueries({ queryKey: ["night-chat-rx", chatId] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "night_chat_pins", filter: `chat_id=eq.${chatId}` },
        () => qc.invalidateQueries({ queryKey: ["night-chat-pins", chatId] }))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "night_chats", filter: `id=eq.${chatId}` },
        () => qc.invalidateQueries({ queryKey: ["night-chat", nightId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [chatId, nightId, qc]);

  const { online, typingUsers, broadcastTyping } = usePresence(chatId ?? null, meId);
  const onlineOthers = Array.from(online).filter((u) => u !== meId);
  const typingNames = Array.from(typingUsers)
    .map((u) => nameFor(u)).filter((n) => n !== "System").slice(0, 3);

  // Reactions grouped per message
  const reactionsByMsg = useMemo(() => {
    const map = new Map<string, { emoji: string; users: string[] }[]>();
    for (const r of reactionsQ.data ?? []) {
      const arr = map.get(r.message_id) ?? [];
      const bucket = arr.find((b) => b.emoji === r.emoji);
      if (bucket) bucket.users.push(r.user_id);
      else arr.push({ emoji: r.emoji, users: [r.user_id] });
      map.set(r.message_id, arr);
    }
    return map;
  }, [reactionsQ.data]);

  const pinnedIds = useMemo(() => new Set((pinsQ.data ?? []).map((p) => p.message_id)), [pinsQ.data]);
  const pinnedMessages = (messagesQ.data ?? []).filter((m) => pinnedIds.has(m.id));

  // Composer
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [emojiFor, setEmojiFor] = useState<string | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [showPinned, setShowPinned] = useState(false);
  const isTouch = useIsTouch();
  // Close open action/emoji bars on outside tap (mobile)
  useEffect(() => {
    if (!actionsFor && !emojiFor) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("[data-msg-actions]")) return;
      setActionsFor(null); setEmojiFor(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [actionsFor, emojiFor]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [vvHeight, setVvHeight] = useState<number | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const upd = () => setVvHeight(vv.height);
    upd(); vv.addEventListener("resize", upd); vv.addEventListener("scroll", upd);
    return () => { vv.removeEventListener("resize", upd); vv.removeEventListener("scroll", upd); };
  }, []);

  useEffect(() => {
    if (!autoScroll) return;
    const el = listRef.current;
    if (!el) return;
    // Scroll only the messages container — never call scrollIntoView, which
    // walks scrollable ancestors and shoves the whole page around on iOS.
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messagesQ.data, autoScroll]);

  // Mark read whenever we see the newest message
  useEffect(() => {
    if (!chatId || !meId || !autoScroll) return;
    const last = (messagesQ.data ?? [])[(messagesQ.data ?? []).length - 1];
    if (!last) return;
    readFn({ data: { chat_id: chatId, last_read_message_id: last.id } })
      .then(() => qc.invalidateQueries({ queryKey: ["chats-unread"] }))
      .catch(() => {});
  }, [messagesQ.data, autoScroll, chatId, meId, readFn]);

  const sendMut = useMutation({
    mutationFn: async () => {
      if (!chatId) return;
      const body = draft.trim();
      if (!body) return;
      if (editing) {
        await editFn({ data: { message_id: editing.id, body } });
      } else {
        await sendFn({ data: { chat_id: chatId, body, reply_to_id: replyTo?.id ?? null } });
      }
    },
    onSuccess: () => {
      setDraft(""); setReplyTo(null); setEditing(null);
      qc.invalidateQueries({ queryKey: ["night-chat-msgs", chatId] });
      setAutoScroll(true);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to send"),
  });

  function submit() { if (!sendMut.isPending) sendMut.mutate(); }

  // ------- Image upload -------
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  async function onPickImage() { fileInputRef.current?.click(); }
  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so same file can be picked again
    if (!file || !chatId || !meId) return;
    if (!file.type.startsWith("image/")) { toast.error("Please pick an image"); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("Image too large (max 8 MB)"); return; }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
      const path = `${meId}/${chatId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("chat-images")
        .upload(path, file, { contentType: file.type, cacheControl: "31536000" });
      if (upErr) throw upErr;
      // Best-effort image dims for aspect ratio
      let width = 0, height = 0;
      try {
        const bmp = await createImageBitmap(file);
        width = bmp.width; height = bmp.height; bmp.close();
      } catch { /* ignore */ }
      await sendFn({
        data: {
          chat_id: chatId,
          body: "",
          kind: "image",
          reply_to_id: replyTo?.id ?? null,
          metadata: { path, width, height, size: file.size, mime: file.type },
        },
      });
      setReplyTo(null);
      qc.invalidateQueries({ queryKey: ["night-chat-msgs", chatId] });
      setAutoScroll(true);
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // ------- GIF picker -------
  const [gifOpen, setGifOpen] = useState(false);
  async function onPickGif(gif: { url: string; preview_url: string; mp4_url?: string; webp_url?: string; width: number; height: number; id: string }) {
    if (!chatId) return;
    try {
      await sendFn({
        data: {
          chat_id: chatId,
          body: "",
          kind: "gif",
          reply_to_id: replyTo?.id ?? null,
          metadata: {
            url: gif.url,
            preview_url: gif.preview_url,
            mp4_url: gif.mp4_url ?? "",
            webp_url: gif.webp_url ?? "",
            width: gif.width,
            height: gif.height,
            provider: "klipy",
            id: gif.id,
          },
        },
      });
      setGifOpen(false);
      setReplyTo(null);
      qc.invalidateQueries({ queryKey: ["night-chat-msgs", chatId] });
      setAutoScroll(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send GIF");
    }
  }

  async function onReact(messageId: string, emoji: string) {
    setEmojiFor(null);
    try { await reactFn({ data: { message_id: messageId, emoji } }); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  async function onDelete(m: Msg) {
    if (!confirm("Delete this message?")) return;
    try { await delFn({ data: { message_id: m.id } }); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  async function onTogglePin(m: Msg) {
    if (!chatId) return;
    try {
      if (pinnedIds.has(m.id)) await unpinFn({ data: { chat_id: chatId, message_id: m.id } });
      else await pinFn({ data: { chat_id: chatId, message_id: m.id } });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  function scrollListener() {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAutoScroll(near);
  }

  const msgs = messagesQ.data ?? [];

  return (
    <div
      className={cn(
        "flex flex-col bg-card/80 backdrop-blur border border-border/60 rounded-2xl overflow-hidden",
        variant === "full" ? "h-full rounded-none border-0" : "h-[calc(100dvh-10rem)] min-h-[400px]",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2 font-display text-sm font-semibold">
          <MessageSquare className="h-4 w-4 text-gold" /> Night chat
          {onlineOthers.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              <Circle className="h-1.5 w-1.5 fill-emerald-400 stroke-none" />
              {onlineOthers.length} online
            </span>
          )}
          {closed && (
            <span className="rounded-full bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground">Closed</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {chatId && !closed && (
            <button
              type="button"
              onClick={() => muteMut.mutate(!muted)}
              disabled={muteMut.isPending}
              className="rounded p-1 text-muted-foreground hover:bg-muted/40"
              title={muted ? "Unmute notifications" : "Mute notifications"}
              aria-label={muted ? "Unmute notifications" : "Mute notifications"}
            >
              {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            </button>
          )}
          {pinnedMessages.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPinned((v) => !v)}
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/40"
            >
              <Pin className="h-3 w-3" /> {pinnedMessages.length}
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted/40" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Pinned drawer */}
      {showPinned && pinnedMessages.length > 0 && (
        <div className="border-b border-border/60 bg-muted/20 px-3 py-2 text-xs">
          <div className="mb-1 font-semibold text-gold">Pinned</div>
          <div className="space-y-1">
            {pinnedMessages.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-2">
                <div className="flex-1 truncate">
                  <span className="text-gold/80">{nameFor(m.sender_id)}:</span>{" "}
                  <span className="text-foreground">{m.body ?? "(deleted)"}</span>
                </div>
                {isAdmin && !closed && (
                  <button onClick={() => onTogglePin(m)} className="text-muted-foreground hover:text-foreground">
                    <PinOff className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={listRef}
        onScroll={scrollListener}
        className="relative flex-1 overflow-y-auto overscroll-contain px-3 py-2 [-webkit-overflow-scrolling:touch]"
      >
        {!msgs.length && (
          <div className="py-8 text-center text-xs text-muted-foreground">No messages yet. Say hi to the crew.</div>
        )}
        <div className="space-y-1.5">
          {msgs.filter((m) => !m.deleted_at).map((m, i, arr) => {
            const prev = arr[i - 1];
            const showDate = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
            const grouped = !!prev && prev.sender_id === m.sender_id && !prev.system_event && !m.system_event &&
              new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 3 * 60 * 1000;

            return (
              <div key={m.id}>
                {showDate && (
                  <div className="my-2 flex justify-center">
                    <span className="rounded-full bg-muted/40 px-3 py-0.5 text-[10px] text-muted-foreground">
                      {new Date(m.created_at).toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "short" })}
                    </span>
                  </div>
                )}
                {m.kind === "system" ? (
                  <SystemBubble m={m} nameFor={nameFor} />
                ) : (
                  <UserBubble
                    m={m}
                    meId={meId}
                    grouped={grouped}
                    nameFor={nameFor}
                    reactions={reactionsByMsg.get(m.id) ?? []}
                    pinned={pinnedIds.has(m.id)}
                    replyTarget={msgs.find((x) => x.id === m.reply_to_id) ?? null}
                    isAdmin={isAdmin}
                    closed={closed}
                    onReply={() => { setReplyTo(m); setActionsFor(null); setEmojiFor(null); }}
                    onEmoji={() => setEmojiFor((cur) => (cur === m.id ? null : m.id))}
                    onDelete={() => { setActionsFor(null); onDelete(m); }}
                    onEdit={() => { setEditing(m); setDraft(m.body ?? ""); setReplyTo(null); setActionsFor(null); inputRef.current?.focus(); }}
                    onPin={() => { setActionsFor(null); onTogglePin(m); }}
                    onReact={(e) => { onReact(m.id, e); setEmojiFor(null); setActionsFor(null); }}
                    emojiOpen={emojiFor === m.id}
                    actionsOpen={actionsFor === m.id}
                    onOpenActions={() => { setActionsFor(m.id); setEmojiFor(null); }}
                    isTouch={isTouch}
                    signImage={(path) => signImgFn({ data: { path } }) as Promise<{ url: string }>}
                  />
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {!autoScroll && (
          <button
            onClick={() => {
              setAutoScroll(true);
              const el = listRef.current;
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            }}
            className="sticky bottom-2 left-full z-10 -mr-1 flex w-max items-center gap-1 rounded-full bg-gold px-3 py-1.5 text-xs font-semibold text-black shadow-lg"
          >
            <ChevronDown className="h-3 w-3" /> New
          </button>
        )}
      </div>

      {/* Reply/edit preview */}
      {(replyTo || editing) && (
        <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-3 py-1.5 text-xs">
          <div className="min-w-0 flex-1 truncate">
            <span className="text-gold">{editing ? "Editing" : `Replying to ${nameFor(replyTo?.sender_id ?? null)}`}</span>
            <span className="text-muted-foreground"> · {(editing?.body ?? replyTo?.body ?? "").slice(0, 80)}</span>
          </div>
          <button onClick={() => { setReplyTo(null); setEditing(null); setDraft(""); }} className="text-muted-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Composer */}
      <div
        className="border-t border-border/60 p-2"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        {closed ? (
          <div className="rounded-md bg-muted/30 px-3 py-2 text-center text-xs text-muted-foreground">
            This chat is closed. You can still read messages.
          </div>
        ) : (
          <>
            <div className="mb-1 h-4 px-1 text-[11px] italic text-muted-foreground">
              {typingNames.length === 1 && `${typingNames[0]} is typing…`}
              {typingNames.length === 2 && `${typingNames[0]} and ${typingNames[1]} are typing…`}
              {typingNames.length >= 3 && `${typingNames.length} people are typing…`}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onFileChosen}
              />
              <button
                type="button"
                onClick={onPickImage}
                disabled={uploading || sendMut.isPending}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground hover:text-foreground active:bg-muted/40 disabled:opacity-50 touch-manipulation"
                title="Attach a photo"
                aria-label="Attach a photo"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setGifOpen(true)}
                disabled={uploading || sendMut.isPending}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground hover:text-foreground active:bg-muted/40 disabled:opacity-50 touch-manipulation"
                title="Send a GIF"
                aria-label="Send a GIF"
              >
                <Sparkles className="h-4 w-4" />
              </button>
              <Input
                ref={inputRef}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); if (e.target.value.trim()) broadcastTyping(); }}
                onFocus={() => setTimeout(() => {
                  const el = listRef.current;
                  if (el) el.scrollTo({ top: el.scrollHeight });
                }, 250)}
                placeholder={editing ? "Edit message…" : "Message the night…"}
                className="h-11 flex-1 bg-background/60 text-base"
                maxLength={2000}
                disabled={sendMut.isPending}
                enterKeyHint="send"
                autoCapitalize="sentences"
                autoCorrect="on"
                autoComplete="off"
                inputMode="text"
              />
              <Button type="submit" size="icon" className="h-11 w-11 shrink-0 bg-gold text-black shadow-gold touch-manipulation"
                disabled={sendMut.isPending || !draft.trim()}>
                {editing ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </>
        )}
      </div>
      {gifOpen && (
        <GifPicker
          onPick={onPickGif}
          onClose={() => setGifOpen(false)}
          searchFn={(args) => searchGifsFn({ data: args })}
        />
      )}
    </div>
  );
}

export function SystemBubble({ m, nameFor }: { m: Msg; nameFor: (uid: string | null) => string }) {
  const meta = m.metadata ?? {};
  let text = m.system_event ?? "Update";
  switch (m.system_event) {
    case "night_created": text = `Night created — ${meta.title ?? ""}`; break;
    case "date_changed": text = `Date changed to ${new Date(meta.new).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`; break;
    case "location_changed": text = `Location changed to ${meta.new ?? "—"}`; break;
    case "buy_in_changed": text = `Buy-in changed to ${meta.new}`; break;
    case "night_completed": text = "Night completed 🏁"; break;
    case "night_cancelled": text = "Night cancelled"; break;
    case "invited": text = `${meta.name ?? "Someone"} was invited`; break;
    case "rsvp_attending": text = `${meta.name ?? nameFor(m.sender_id)} is attending ✅`; break;
    case "rsvp_maybe": text = `${meta.name ?? nameFor(m.sender_id)} might attend 🤔`; break;
    case "rsvp_declined": text = `${meta.name ?? nameFor(m.sender_id)} declined ❌`; break;
  }
  return (
    <div className="my-1 flex justify-center">
      <span className="rounded-full bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">{text}</span>
    </div>
  );
}

export function UserBubble({
  m, meId, grouped, nameFor, reactions, pinned, replyTarget, isAdmin, closed,
  onReply, onEmoji, onDelete, onEdit, onPin, onReact, emojiOpen,
  actionsOpen, onOpenActions, isTouch, signImage,
}: {
  m: Msg; meId: string | null; grouped: boolean; nameFor: (uid: string | null) => string;
  reactions: { emoji: string; users: string[] }[]; pinned: boolean; replyTarget: Msg | null;
  isAdmin: boolean; closed: boolean;
  onReply: () => void; onEmoji: () => void; onDelete: () => void; onEdit: () => void; onPin: () => void;
  onReact: (e: string) => void; emojiOpen: boolean;
  actionsOpen: boolean; onOpenActions: () => void; isTouch: boolean;
  signImage: (path: string) => Promise<{ url: string }>;
}) {
  const isMe = m.sender_id === meId;
  const deleted = !!m.deleted_at;
  const isImage = m.kind === "image" && !deleted;
  const isGif = m.kind === "gif" && !deleted;
  const meta = (m.metadata ?? {}) as any;
  // Long-press to open actions on touch devices
  const pressTimer = useRef<number | null>(null);
  const startPress = () => {
    if (!isTouch || deleted || closed) return;
    pressTimer.current = window.setTimeout(() => {
      onOpenActions();
      // haptic tick where available (Android; iOS ignores)
      if ("vibrate" in navigator) try { navigator.vibrate?.(15); } catch {}
    }, 350);
  };
  const cancelPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };
  return (
    <div
      data-msg-actions
      className={cn("group relative flex flex-col", isMe ? "items-end" : "items-start", grouped ? "mt-0.5" : "mt-2")}
    >
      <div
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onTouchMove={cancelPress}
        onTouchCancel={cancelPress}
        onContextMenu={(e) => { if (isTouch) { e.preventDefault(); onOpenActions(); } }}
        className={cn("relative max-w-[85%] rounded-2xl px-3 py-2 text-sm select-none [-webkit-touch-callout:none]",
        isMe ? "rounded-tr-sm bg-gold text-black" : "rounded-tl-sm bg-muted/60 text-foreground",
        pinned && "ring-1 ring-gold/50",
        (isImage || isGif) && "p-1",
      )}>
        {!grouped && !isMe && !(isImage || isGif) && (
          <div className="text-[10px] font-semibold text-gold/80">{nameFor(m.sender_id)}</div>
        )}
        {(isImage || isGif) && !grouped && !isMe && (
          <div className="px-2 pt-1 text-[10px] font-semibold text-gold/80">{nameFor(m.sender_id)}</div>
        )}
        {replyTarget && (
          <div className={cn("mb-1 border-l-2 pl-2 text-[11px] opacity-80",
            (isImage || isGif) && "mx-2 mt-1",
            isMe ? "border-black/40" : "border-gold/60")}>
            <div className="font-semibold">{nameFor(replyTarget.sender_id)}</div>
            <div className="truncate">{replyTarget.body ?? "(deleted)"}</div>
          </div>
        )}
        {deleted ? (
          <div className="whitespace-pre-wrap break-words px-2 py-1 italic leading-snug opacity-60">Message deleted</div>
        ) : isImage ? (
          <ChatImage path={meta.path} width={meta.width} height={meta.height} signImage={signImage} />
        ) : isGif ? (
          <ChatGif meta={meta} />
        ) : (
          <div className="whitespace-pre-wrap break-words leading-snug">
            {m.body}
            {m.edited_at && <span className="ml-1 text-[9px] opacity-60">(edited)</span>}
          </div>
        )}

        {reactions.length > 0 && (
          <div className={cn("mt-1 flex flex-wrap gap-1", (isImage || isGif) && "px-2 pb-1")}>
            {reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReact(r.emoji)}
                className={cn("flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
                  r.users.includes(meId ?? "") ? "border-gold/80 bg-gold/20" : "border-border/60 bg-background/40",
                  isMe && "text-foreground",
                )}
              >
                <span>{r.emoji}</span><span>{r.users.length}</span>
              </button>
            ))}
          </div>
        )}

        {/* Hover actions */}
        {!deleted && !closed && (
          <div
            data-msg-actions
            className={cn(
              "absolute -top-4 z-10 gap-0.5 rounded-full border border-border/60 bg-background/95 px-1 py-0.5 shadow-md",
              actionsOpen ? "flex" : "hidden group-hover:flex",
              isMe ? "right-0" : "left-0",
            )}
          >
            <button onClick={onEmoji} className="p-2 text-muted-foreground hover:text-foreground" title="React">
              <Smile className="h-4 w-4" />
            </button>
            <button onClick={onReply} className="p-2 text-muted-foreground hover:text-foreground" title="Reply">
              <Reply className="h-4 w-4" />
            </button>
            {isMe && (
              <button onClick={onEdit} className="p-2 text-muted-foreground hover:text-foreground" title="Edit">
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {isAdmin && (
              <button onClick={onPin} className="p-2 text-muted-foreground hover:text-foreground" title={pinned ? "Unpin" : "Pin"}>
                {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </button>
            )}
            {(isMe || isAdmin) && (
              <button onClick={onDelete} className="p-2 text-red-400 hover:text-red-300" title="Delete">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {emojiOpen && (
          <div
            data-msg-actions
            className={cn("absolute z-20 mt-1 flex gap-1 rounded-full border border-border/60 bg-background/95 px-2 py-1.5 shadow-lg",
              isMe ? "right-0 top-full" : "left-0 top-full")}
          >
            {QUICK_EMOJIS.map((e) => (
              <button key={e} onClick={() => onReact(e)} className="min-w-[32px] px-1 text-lg leading-none hover:scale-125 transition">{e}</button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-1 px-1 text-[9px] text-muted-foreground">
        <span>{new Date(m.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
        {isMe && <CheckCheck className="h-2.5 w-2.5" />}
      </div>
    </div>
  );
}

// ---------- ChatImage: renders a private storage image via signed URL ----------
export function ChatImage({
  path, width, height, signImage,
}: {
  path?: string; width?: number; height?: number;
  signImage: (path: string) => Promise<{ url: string }>;
}) {
  const [lightbox, setLightbox] = useState(false);
  const q = useQuery({
    queryKey: ["chat-image-url", path],
    enabled: !!path,
    staleTime: 1000 * 60 * 60, // 1h cache (URL valid 7 days)
    queryFn: () => signImage(path!),
  });
  if (!path) return <div className="p-2 text-xs italic opacity-60">Image unavailable</div>;
  if (q.isLoading || !q.data) {
    const aspect = width && height ? width / height : 1.4;
    return (
      <div
        className="flex items-center justify-center rounded-xl bg-background/40"
        style={{ width: 240, height: 240 / aspect }}
      >
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setLightbox(true)} className="block">
        <img
          src={q.data.url}
          alt="Photo"
          width={width || undefined}
          height={height || undefined}
          className="block max-h-80 max-w-full rounded-xl object-contain"
          loading="lazy"
        />
      </button>
      {lightbox && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
          style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          onClick={() => setLightbox(false)}
        >
          <img src={q.data.url} alt="Photo" className="max-h-full max-w-full object-contain" />
          <button
            className="absolute right-4 rounded-full bg-white/10 p-2 text-white"
            style={{ top: "max(1rem, env(safe-area-inset-top))" }}
            onClick={(e) => { e.stopPropagation(); setLightbox(false); }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  );
}

// ---------- GifPicker: KLIPY-backed modal ----------
export function ChatGif({ meta }: { meta: any }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mp4 = typeof meta.mp4_url === "string" && meta.mp4_url ? meta.mp4_url : "";
  const webp = typeof meta.webp_url === "string" && meta.webp_url ? meta.webp_url : "";
  const gif = meta.url as string | undefined;
  const preview = typeof meta.preview_url === "string" && meta.preview_url ? meta.preview_url : "";
  const w = meta.width || undefined;
  const h = meta.height || undefined;

  // Prefer real animated image formats for chat bubbles. iOS can keep muted
  // videos on their poster frame in Low Power Mode / strict autoplay states,
  // while animated GIF/WebP images play without needing a media gesture.
  const imageSrc = gif || webp || preview;

  // Last fallback: if the provider only returned video, keep trying to start it
  // when the bubble mounts / re-enters view.
  useEffect(() => {
    if (imageSrc) return;
    const v = videoRef.current;
    if (!v) return;
    const tryPlay = () => { v.play().catch(() => {}); };
    tryPlay();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) tryPlay();
    }, { threshold: 0.1 });
    io.observe(v);
    return () => io.disconnect();
  }, [imageSrc, mp4]);

  if (imageSrc) {
    return (
      <img
        key={imageSrc}
        src={imageSrc}
        alt={meta.title ?? "GIF"}
        width={w}
        height={h}
        className="block max-h-72 max-w-full rounded-xl object-contain"
        loading="eager"
        decoding="auto"
        style={{ transform: "translateZ(0)", WebkitTransform: "translateZ(0)" }}
      />
    );
  }
  if (mp4) {
    return (
      <video
        ref={videoRef}
        src={mp4}
        poster={preview || undefined}
        width={w}
        height={h}
        className="block max-h-72 max-w-full rounded-xl object-contain"
        autoPlay
        muted
        loop
        playsInline
        {...({ "webkit-playsinline": "true" } as any)}
        disablePictureInPicture
        controls={false}
        preload="auto"
      />
    );
  }
  return <div className="p-2 text-xs italic opacity-60">GIF unavailable</div>;
}

export type GifItem = {
  id: string; url: string; preview_url: string; mp4_url?: string; webp_url?: string; width: number; height: number; title?: string;
};
export function GifPicker({
  onPick, onClose, searchFn,
}: {
  onPick: (g: GifItem) => void;
  onClose: () => void;
  searchFn: (args: { q: string; page: number }) => Promise<{ items: GifItem[]; has_next: boolean }>;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [vv, setVv] = useState<{ h: number; top: number } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setVv({ h: viewport.height, top: viewport.offsetTop });
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const gifsQ = useQuery({
    queryKey: ["klipy-gifs", debounced],
    queryFn: () => searchFn({ q: debounced, page: 1 }),
    staleTime: 1000 * 60 * 5,
  });
  return (
    <div
      className="fixed inset-x-0 z-[100] flex items-end justify-center bg-black/60 sm:items-center"
      style={{
        top: vv ? `${vv.top}px` : 0,
        height: vv ? `${vv.h}px` : "100dvh",
      }}
      onClick={onClose}
    >
      <div
        className="flex h-[min(75dvh,560px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border/60 bg-card text-card-foreground shadow-2xl sm:h-[70vh] sm:rounded-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          <Sparkles className="h-4 w-4 text-gold" />
          <span className="text-sm font-semibold">GIFs</span>
          <span className="ml-auto text-[10px] text-muted-foreground">via KLIPY</span>
          <button onClick={onClose} className="ml-1 rounded p-2 text-muted-foreground hover:bg-muted/40 touch-manipulation" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="border-b border-border/60 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setTimeout(() => inputRef.current?.scrollIntoView({ block: "nearest" }), 80)}
              placeholder="Search GIFs…"
              className="h-11 bg-background pl-8 text-base text-card-foreground caret-gold placeholder:text-muted-foreground [-webkit-text-fill-color:var(--card-foreground)]"
              style={{ color: "var(--card-foreground)", WebkitTextFillColor: "var(--card-foreground)" } as React.CSSProperties}
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              inputMode="search"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-2 [-webkit-overflow-scrolling:touch]">
          {gifsQ.isLoading && (
            <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          )}
          {gifsQ.error && (
            <div className="p-4 text-center text-xs text-red-400">Couldn't load GIFs. Try again.</div>
          )}
          {gifsQ.data && gifsQ.data.items.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">No GIFs found.</div>
          )}
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {(gifsQ.data?.items ?? []).map((g) => (
              <button
                key={g.id}
                onClick={() => onPick(g)}
                className="group relative overflow-hidden rounded-md bg-background/40 transition hover:ring-2 hover:ring-gold"
                style={{ aspectRatio: g.width && g.height ? `${g.width} / ${g.height}` : "1 / 1" }}
              >
                <img
                  src={g.preview_url || g.url}
                  alt={g.title || "GIF"}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
