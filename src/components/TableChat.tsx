import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDisplayName } from "@/lib/poker";
import { listTableMessages, sendTableMessage } from "@/lib/poker-table.functions";
import { Send, MessageSquare, X, Circle } from "lucide-react";
import { usePresence } from "@/hooks/use-presence";

type Message = {
  id: string;
  table_id: string;
  user_id: string | null;
  body: string;
  created_at: string;
  is_bot?: boolean | null;
  bot_name?: string | null;
};

type Profile = { id: string; name: string | null; nickname: string | null; avatar_url: string | null };

type TableChatProps = {
  tableId: string;
  meId: string | null;
  profiles: Profile[];
};

export function TableChat({ tableId, meId, profiles }: TableChatProps) {
  const [open, setOpen] = useState(false);
  const onToggle = () => setOpen((o) => !o);
  const qc = useQueryClient();
  const listFn = useServerFn(listTableMessages);
  const sendFn = useServerFn(sendTableMessage);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // iOS Safari does not resize the layout viewport when the on-screen
  // keyboard opens, so a `position: fixed; inset-y-0` panel keeps its full
  // height and the composer disappears behind the keyboard. Track the
  // visual viewport so we can shrink the mobile panel above the keyboard.
  const [vvHeight, setVvHeight] = useState<number | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setVvHeight(vv.height);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  const { online, typingUsers, broadcastTyping } = usePresence(tableId, meId);
  const onlineOthers = Array.from(online).filter((u) => u !== meId);
  const typingNames = Array.from(typingUsers)
    .map((uid) => {
      const p = profiles.find((x) => x.id === uid);
      return p ? formatDisplayName(p.name, p.nickname) : "Someone";
    })
    .slice(0, 3);

  const { data: messages } = useQuery({
    queryKey: ["table-messages", tableId],
    queryFn: () => listFn({ data: { table_id: tableId } }) as Promise<Message[]>,
  });

  const send = useMutation({
    mutationFn: (body: string) => sendFn({ data: { table_id: tableId, body } }) as Promise<{ ok: boolean }>,
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["table-messages", tableId] });
    },
    onError: (e: any) => {
      // Chat should never break the game.
      console.error("chat send failed", e?.message);
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`table-messages-${tableId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "table_messages", filter: `table_id=eq.${tableId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["table-messages", tableId] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tableId, qc]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function nameFor(m: Message) {
    if (!m.user_id) return "Player";
    const p = profiles.find((x) => x.id === m.user_id);
    return p ? formatDisplayName(p.name, p.nickname) : "Player";
  }

  function submit() {
    const body = draft.trim();
    if (!body || send.isPending) return;
    send.mutate(body);
  }

  const panelInner = (
    <>
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2 font-display text-sm font-semibold">
          <MessageSquare className="h-4 w-4 text-gold" /> Table chat
          {onlineOthers.length > 0 && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              <Circle className="h-1.5 w-1.5 fill-emerald-400 stroke-none" />
              {onlineOthers.length} online
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded p-1 text-muted-foreground hover:bg-muted/40 lg:hidden"
          aria-label="Close chat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {!messages?.length && (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No messages yet. Say hi to the table.
          </div>
        )}
        <div className="space-y-2">
          {messages?.map((m) => {
            const isMe = !m.is_bot && m.user_id === meId;
            return (
              <div key={m.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                    isMe
                      ? "rounded-tr-sm bg-gold text-black"
                      : "rounded-tl-sm bg-muted/60 text-foreground",
                  )}
                >
                  <div className={cn("text-[10px] font-semibold", isMe ? "text-black/70" : "text-gold/80")}>
                    {isMe ? "You" : nameFor(m)}
                  </div>
                  <div className="break-words leading-snug">{m.body}</div>
                </div>
                <div className="mt-0.5 px-1 text-[9px] text-muted-foreground">
                  {new Date(m.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-border/60 p-2">
        <div className="mb-1 h-4 px-1 text-[11px] italic text-muted-foreground">
          {typingNames.length === 1 && `${typingNames[0]} is typing…`}
          {typingNames.length === 2 && `${typingNames[0]} and ${typingNames[1]} are typing…`}
          {typingNames.length >= 3 && `${typingNames.length} people are typing…`}
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="flex items-center gap-2"
        >
          <Input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value.trim().length > 0) broadcastTyping();
            }}
            onFocus={() => {
              // Give iOS a tick to raise the keyboard, then scroll the
              // composer into view above it.
              setTimeout(() => {
                bottomRef.current?.scrollIntoView({ block: "end" });
                inputRef.current?.scrollIntoView({ block: "center" });
              }, 250);
            }}
            placeholder="Message the table…"
            className="h-9 flex-1 bg-background/60"
            maxLength={500}
            disabled={send.isPending}
          />
          <Button
            type="submit"
            size="icon"
            className="h-9 w-9 shrink-0 bg-gold text-black shadow-gold"
            disabled={send.isPending || !draft.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-card backdrop-blur lg:hidden",
          open ? "bg-gold text-black" : "bg-background/90 text-gold border border-gold/40",
        )}
        aria-label={open ? "Close chat" : "Open chat"}
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
      </button>

      {/* Mobile fixed panel */}
      <div
        className={cn(
          "fixed top-0 right-0 z-50 w-[min(100vw,22rem)] transform border-l border-border/60 bg-background/95 p-0 shadow-2xl backdrop-blur transition-transform duration-300 lg:hidden",
          open ? "translate-x-0" : "translate-x-full",
        )}
        style={{ height: vvHeight ? `${vvHeight}px` : "100dvh" }}
      >
        <div className="flex h-full flex-col">{panelInner}</div>
      </div>

      {/* Desktop inline panel */}
      <div className="hidden h-[calc(100dvh-8rem)] flex-col rounded-2xl border border-border/60 bg-card/80 shadow-card lg:flex">
        {panelInner}
      </div>
    </>
  );
}
