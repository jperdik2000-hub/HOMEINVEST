import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Bell, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  listMyNotifications,
  markAllNotificationsRead,
  deleteMyNotification,
} from "@/lib/push.functions";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Poker Club" }] }),
  component: NotificationsPage,
});

type Item = {
  id: string;
  event: string;
  title: string;
  body: string;
  url: string | null;
  read_at: string | null;
  created_at: string;
};

function NotificationsPage() {
  const list = useServerFn(listMyNotifications);
  const markAll = useServerFn(markAllNotificationsRead);
  const del = useServerFn(deleteMyNotification);
  const qc = useQueryClient();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ["notifications", "game-time-v2"],
    queryFn: () => list() as Promise<Item[]>,
    staleTime: 0,
  });

  // Auto mark-all-read on open so the header badge clears.
  useEffect(() => {
    if (!data || data.length === 0) return;
    if (data.every((n) => n.read_at)) return;
    markAll()
      .then(() => qc.invalidateQueries({ queryKey: ["notifications-unread"] }))
      .catch(() => {});
  }, [data, markAll, qc]);

  const deleteMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }) as Promise<unknown>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "game-time-v2"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center gap-2 font-display text-2xl font-bold">
          <Bell className="h-5 w-5 text-gold" /> Notifications
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!isLoading && (!data || data.length === 0) && (
          <div className="card-felt shadow-card rounded-2xl p-8 text-center">
            <Bell className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No notifications yet. You'll see invites, reminders, and results here.
            </p>
          </div>
        )}

        <ul className="space-y-2">
          {data?.map((n) => (
            <li
              key={n.id}
              className={`card-felt shadow-card rounded-2xl p-4 ${
                n.read_at ? "opacity-70" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {n.url ? (
                    <button
                      type="button"
                      onClick={() => router.navigate({ to: n.url! as string })}
                      className="block text-left font-semibold hover:text-gold"
                    >
                      {n.title}
                    </button>
                  ) : (
                    <div className="font-semibold">{n.title}</div>
                  )}
                  <div className="mt-1 text-sm text-muted-foreground">{n.body}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {new Date(n.created_at).toLocaleString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {!n.read_at && (
                      <span className="ml-2 inline-flex items-center gap-1 text-gold">
                        <Check className="h-3 w-3" /> New
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete"
                  onClick={() => deleteMut.mutate(n.id)}
                  disabled={deleteMut.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}