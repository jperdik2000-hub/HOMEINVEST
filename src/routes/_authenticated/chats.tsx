import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyChats } from "@/lib/night-chat.functions";
import { AppShell } from "@/components/AppShell";
import { MessageSquare, Calendar, MapPin } from "lucide-react";
import { formatEUDateTime } from "@/lib/poker";

export const Route = createFileRoute("/_authenticated/chats")({
  head: () => ({ meta: [{ title: "Chats — Poker Club" }] }),
  component: ChatsPage,
});

function ChatsPage() {
  const listFn = useServerFn(listMyChats);
  const q = useQuery({
    queryKey: ["my-chats"],
    queryFn: () => listFn() as unknown as Promise<any[]>,
    refetchInterval: 30_000,
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-gold" />
          <h1 className="font-display text-2xl font-bold">Night chats</h1>
        </div>

        {q.isLoading && (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        )}
        {q.data && q.data.length === 0 && (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-8 text-center text-sm text-muted-foreground">
            No poker nights yet. When you're invited to one, its chat will appear here.
          </div>
        )}

        <ul className="space-y-2">
          {q.data?.map((c) => {
            const preview = c.last_message?.kind === "system"
              ? systemPreview(c.last_message)
              : (c.last_message?.body ?? "No messages yet");
            return (
              <li key={c.chat_id}>
                <Link
                  to="/nights/$id/chat"
                  params={{ id: c.night?.id ?? "" }}
                  className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/70 p-3 hover:bg-card"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate font-semibold">{c.night?.title ?? "Poker night"}</div>
                      {c.unread > 0 && (
                        <span className="rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold text-background">
                          {c.unread > 99 ? "99+" : c.unread}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                      {c.night?.starts_at && (
                        <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{formatEUDateTime(c.night.starts_at)}</span>
                      )}
                      {c.night?.location && (
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{c.night.location}</span>
                      )}
                      {c.status !== "open" && (
                        <span className="rounded bg-muted/50 px-1.5 py-0.5">Closed</span>
                      )}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{preview}</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </AppShell>
  );
}

function systemPreview(m: any): string {
  const meta = m?.metadata ?? {};
  switch (m?.system_event) {
    case "night_created": return "Night created";
    case "date_changed": return "Date changed";
    case "location_changed": return `Location: ${meta.new ?? "—"}`;
    case "buy_in_changed": return "Buy-in changed";
    case "night_completed": return "Night completed 🏁";
    case "night_cancelled": return "Night cancelled";
    case "invited": return `${meta.name ?? "Someone"} invited`;
    case "rsvp_attending": return `${meta.name ?? "Someone"} is in ✅`;
    case "rsvp_maybe": return `${meta.name ?? "Someone"} maybe 🤔`;
    case "rsvp_declined": return `${meta.name ?? "Someone"} declined ❌`;
    default: return "Update";
  }
}
