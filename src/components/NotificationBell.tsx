import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMyUnreadNotificationCount,
  listMyNotifications,
  markAllNotificationsRead,
} from "@/lib/push.functions";

export function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [bellOpen, setBellOpen] = useState(false);
  const unreadFn = useServerFn(getMyUnreadNotificationCount);
  const listFn = useServerFn(listMyNotifications);
  const markAllFn = useServerFn(markAllNotificationsRead);

  const { data: unread } = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: () => unreadFn() as Promise<{ count: number }>,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const unreadCount = unread?.count ?? 0;

  const { data: bellItems } = useQuery({
    queryKey: ["notifications", "bell", "game-time-v2"],
    queryFn: () =>
      listFn() as Promise<
        Array<{
          id: string;
          title: string;
          body: string;
          url: string | null;
          read_at: string | null;
          created_at: string;
        }>
      >,
    enabled: bellOpen,
    staleTime: 0,
  });

  const markAll = useMutation({
    mutationFn: () => markAllFn() as Promise<unknown>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "bell", "game-time-v2"] });
    },
  });

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const refresh = (event: MessageEvent) => {
      if (event.data?.type !== "poker-club-notification") return;
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "bell", "game-time-v2"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "game-time-v2"] });
    };
    navigator.serviceWorker.addEventListener("message", refresh);
    return () => navigator.serviceWorker.removeEventListener("message", refresh);
  }, [queryClient]);

  return (
    <Popover open={bellOpen} onOpenChange={setBellOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-background shadow-gold">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <div className="flex items-center gap-2 font-display text-sm font-semibold">
            <Bell className="h-4 w-4 text-gold" /> Notifications
          </div>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {!bellItems && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</div>
          )}
          {bellItems && bellItems.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No notifications yet.
            </div>
          )}
          <ul className="divide-y divide-border/60">
            {bellItems?.slice(0, 10).map((n) => (
              <li key={n.id} className={n.read_at ? "opacity-70" : ""}>
                <button
                  type="button"
                  onClick={() => {
                    setBellOpen(false);
                    if (n.url) router.navigate({ to: n.url as string });
                  }}
                  className="block w-full px-3 py-2 text-left hover:bg-muted/40"
                >
                  <div className="text-sm font-semibold">{n.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(n.created_at).toLocaleString(undefined, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-border/60 p-2">
          <Link
            to="/notifications"
            onClick={() => setBellOpen(false)}
            className="block rounded-md px-2 py-1.5 text-center text-xs text-muted-foreground hover:bg-muted/40"
          >
            View all
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}