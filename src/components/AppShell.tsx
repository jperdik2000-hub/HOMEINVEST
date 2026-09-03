import { Link, useNavigate, useRouterState, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, LayoutDashboard, Trophy, User, History as HistoryIcon, Spade, Heart, Bell, Users, Scale } from "lucide-react";
import { Loader2, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMyUnreadNotificationCount,
  listMyNotifications,
  markAllNotificationsRead,
} from "@/lib/push.functions";
import { getMyUnreadChatCount } from "@/lib/night-chat.functions";

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { pull, refreshing, threshold } = usePullToRefresh();
  const [displayName, setDisplayName] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [bellOpen, setBellOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const unreadFn = useServerFn(getMyUnreadNotificationCount);
  const listFn = useServerFn(listMyNotifications);
  const markAllFn = useServerFn(markAllNotificationsRead);
  const unreadChatFn = useServerFn(getMyUnreadChatCount);
  const { data: unread } = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: () => unreadFn() as Promise<{ count: number }>,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const unreadCount = unread?.count ?? 0;
  const { data: unreadChats } = useQuery({
    queryKey: ["chats-unread-total"],
    queryFn: () => unreadChatFn() as Promise<{ count: number }>,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const unreadChatCount = unreadChats?.count ?? 0;

  // Home-screen app icon badge (installed PWA on iOS 16.4+/Android/desktop).
  useEffect(() => {
    const total = unreadCount + unreadChatCount;
    const nav: any = typeof navigator !== "undefined" ? navigator : null;
    if (!nav || typeof nav.setAppBadge !== "function") return;
    if (total > 0) nav.setAppBadge(total).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [unreadCount, unreadChatCount]);

  // Re-sync badge when the tab becomes visible again.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
      queryClient.invalidateQueries({ queryKey: ["chats-unread-total"] });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [queryClient]);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);
  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId!).eq("role", "admin").maybeSingle();
      return !!data;
    },
  });
  const { data: bellItems } = useQuery({
    queryKey: ["notifications", "bell", "game-time-v2"],
    queryFn: () => listFn() as Promise<Array<{ id: string; title: string; body: string; url: string | null; read_at: string | null; created_at: string }>>,
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
    supabase.auth.getUser().then(async ({ data }) => {
      const u = data.user;
      if (!u) return;
      setDisplayName((u.user_metadata?.nickname as string) || (u.user_metadata?.name as string) || u.email || "");
      const { data: prof } = await supabase.from("profiles").select("avatar_url").eq("id", u.id).maybeSingle();
      const raw = prof?.avatar_url ?? "";
      if (!raw) { setAvatarUrl(""); return; }
      if (/^https?:\/\//i.test(raw)) { setAvatarUrl(raw); return; }
      const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(raw, 60 * 60 * 24 * 7);
      setAvatarUrl(signed?.signedUrl ?? "");
    });
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const refreshNotifications = (event: MessageEvent) => {
      if (event.data?.type !== "poker-club-notification") return;
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "bell", "game-time-v2"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "game-time-v2"] });
      queryClient.invalidateQueries({ queryKey: ["chats-unread-total"] });
    };
    navigator.serviceWorker.addEventListener("message", refreshNotifications);
    return () => navigator.serviceWorker.removeEventListener("message", refreshNotifications);
  }, [queryClient]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const nav = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
    { to: "/history", label: "History", icon: HistoryIcon },
    { to: "/users", label: "Users", icon: Users },
    { to: "/settlements" as const, label: "Settlements", icon: Scale },
  ] as const;

  return (
    <div className="min-h-screen">
      <div
        aria-hidden={pull === 0 && !refreshing}
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center md:hidden"
        style={{
          transform: `translateY(${refreshing ? 24 : Math.min(pull, 80) - 40}px)`,
          opacity: refreshing ? 1 : Math.min(1, pull / threshold),
          transition: refreshing ? "transform 200ms ease" : pull === 0 ? "transform 200ms ease, opacity 200ms ease" : "none",
        }}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background/90 shadow-card ring-1 ring-border/60 backdrop-blur">
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin text-gold" />
          ) : (
            <ArrowDown
              className="h-4 w-4 text-gold transition-transform"
              style={{ transform: `rotate(${Math.min(180, (pull / threshold) * 180)}deg)` }}
            />
          )}
        </div>
      </div>
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center">
              <Spade className="h-5 w-5 text-gold" />
              <Heart className="h-5 w-5 text-gold -ml-1" />
            </div>
            <span className="font-display text-lg font-bold">Poker Club</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((n) => (
              <Link key={n.to} to={n.to}>
                <Button variant={pathname.startsWith(n.to) ? "secondary" : "ghost"} size="sm" className="relative">
                  <n.icon className="mr-1 h-4 w-4" /> {n.label}
                  {"badge" in n && (n as any).badge > 0 && (
                    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-background shadow-gold">
                      {(n as any).badge > 9 ? "9+" : (n as any).badge}
                    </span>
                  )}
                </Button>
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <>
                <Link to="/play" className="hidden md:block">
                  <Button
                    size="sm"
                    className="bg-gradient-to-b from-gold to-amber-600 text-background font-semibold shadow-gold hover:brightness-110"
                  >
                    <Spade className="mr-1 h-4 w-4" /> Enter Casino
                  </Button>
                </Link>
                <Link to="/play" className="md:hidden" aria-label="Enter Casino">
                  <Button
                    size="icon"
                    className="bg-gradient-to-b from-gold to-amber-600 text-background shadow-gold hover:brightness-110"
                  >
                    <Spade className="h-4 w-4" />
                  </Button>
                </Link>
              </>
            )}

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
            <Link to="/profile" className="hidden md:block">
              <Button variant="ghost" size="sm">
                {avatarUrl ? (
                <span
                  className="mr-0.5 inline-block h-6 w-6 rounded-full border border-border/60 bg-cover bg-center"
                  style={{ backgroundImage: `url(${avatarUrl})` }}
                  aria-hidden
                />
                ) : (
                  <User className="mr-1 h-4 w-4" />
                )}
                {displayName || "Profile"}
              </Button>
            </Link>
            <Link to="/profile" className="md:hidden" aria-label="Profile">
              {avatarUrl ? (
                <span
                  className="inline-block h-8 w-8 rounded-full border border-border/60 bg-cover bg-center"
                  style={{ backgroundImage: `url(${avatarUrl})` }}
                />
              ) : (
                <Button variant="ghost" size="icon" title="Profile">
                  <User className="h-4 w-4" />
                </Button>
              )}
            </Link>
            <Button variant="ghost" size="icon" onClick={signOut} title="Sign out"><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 pb-3 md:hidden">
          {nav.map((n) => (
            <Link key={n.to} to={n.to}>
              <Button variant={pathname.startsWith(n.to) ? "secondary" : "ghost"} size="sm" className="relative">
                <n.icon className="mr-1 h-4 w-4" /> {n.label}
                {"badge" in n && (n as any).badge > 0 && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-background shadow-gold">
                    {(n as any).badge > 9 ? "9+" : (n as any).badge}
                  </span>
                )}
              </Button>
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}