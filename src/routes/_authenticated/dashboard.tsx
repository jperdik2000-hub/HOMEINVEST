import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PlayerLink } from "@/components/PlayerLink";
import { fetchNights, fetchAllResults, fetchProfiles, computeLeaderboard, formatMoney, formatEUDate, formatEUDateTime } from "@/lib/poker";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar, Plus, Trophy, Users, MapPin, Coins, Hourglass } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Poker Club" }] }),
  component: Dashboard,
});

function Dashboard() {
  const nights = useQuery({ queryKey: ["nights"], queryFn: fetchNights });
  const results = useQuery({ queryKey: ["results"], queryFn: fetchAllResults });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });
  const me = useQuery({ queryKey: ["me"], queryFn: async () => (await supabase.auth.getUser()).data.user });
  const isAdmin = useQuery({
    queryKey: ["is-admin", me.data?.id],
    enabled: !!me.data?.id,
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", me.data!.id).eq("role", "admin").maybeSingle();
      return !!data;
    },
  });

  const now = Date.now();
  const upcoming = (nights.data ?? [])
    .filter((n) => {
      if (n.status === "cancelled" || n.status === "completed") return false;
      // Keep visible while in progress: show if not yet started, or started within the last 12h
      return new Date(n.starts_at).getTime() >= now - 12 * 60 * 60 * 1000;
    })
    .slice(0, 5);
  const recent = (nights.data ?? []).filter((n) => n.status === "completed").slice(-5).reverse();
  const leaderboard = computeLeaderboard(results.data ?? [], profiles.data ?? []).slice(0, 5);

  const volume = useMemo(() => {
    const rows = results.data ?? [];
    const total = rows.reduce((s, r) => s + Number(r.buy_in ?? 0) + Number(r.rebuys ?? 0), 0);
    const games = new Set(rows.map((r) => r.night_id)).size;
    return {
      total,
      games,
      avg: games ? total / games : 0,
      entries: rows.length,
      perEntry: rows.length ? total / rows.length : 0,
    };
  }, [results.data]);

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold md:text-4xl">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Welcome back to the club.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin.data && (
            <Link to="/nights/new"><Button className="bg-gold shadow-gold"><Plus className="mr-1 h-4 w-4"/>Create New Game</Button></Link>
          )}
        </div>
      </div>

      <div className="card-felt shadow-card mb-4 rounded-2xl p-5">
        <div className="mb-3 flex items-center gap-2">
          <Coins className="h-5 w-5 text-gold" />
          <div className="font-display text-lg font-semibold">Money played through the club</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="font-display text-3xl font-bold text-gold">{formatMoney(volume.total)}</div>
            <div className="text-xs text-muted-foreground">Total buy-ins + rebuys</div>
          </div>
          <div>
            <div className="font-display text-3xl font-bold">{volume.games}</div>
            <div className="text-xs text-muted-foreground">Completed games</div>
          </div>
          <div>
            <div className="font-display text-3xl font-bold">{formatMoney(volume.avg)}</div>
            <div className="text-xs text-muted-foreground">Average per game</div>
          </div>
          <div>
            <div className="font-display text-3xl font-bold">{formatMoney(volume.perEntry)}</div>
            <div className="text-xs text-muted-foreground">Avg buy-in + rebuy per entry</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Upcoming poker games" icon={<Calendar className="h-5 w-5 text-gold"/>}>
          {upcoming.length === 0 ? (
            <Empty text="No upcoming nights. Create one to get the crew together." />
          ) : (
            <ul className="space-y-2">
              {upcoming.map((n) => (
                <li key={n.id}>
                  <Link to="/nights/$id" params={{ id: n.id }} className="block rounded-lg border border-border/60 bg-background/40 p-3 hover:bg-background/60">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{n.title}</div>
                      <div className="text-xs text-muted-foreground">{formatEUDateTime(n.starts_at)}</div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {n.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3"/>{n.location}</span>}
                      <span className="flex items-center gap-1"><Coins className="h-3 w-3"/>{formatMoney(Number(n.buy_in), n.currency)} buy-in</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Top of the leaderboard" icon={<Trophy className="h-5 w-5 text-gold"/>}>
          {leaderboard.length === 0 ? <Empty text="No results yet. Log a game to seed the leaderboard." /> : (
            <ol className="space-y-1">
              {leaderboard.slice(0, 3).map((r, i) => (
                <li key={(r.user_id ?? r.name) + i} className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2"><span className="w-5 text-gold">#{i+1}</span><PlayerLink userId={r.user_id} name={r.name} /></span>
                  <span className={"font-mono " + (r.total >= 0 ? "text-emerald-400" : "text-red-400")}>{formatMoney(r.total)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Recent games" icon={<Users className="h-5 w-5 text-gold"/>}>
          {recent.length === 0 ? <Empty text="Completed games will show up here." /> : (
            <ul className="space-y-2">
              {recent.map((n) => (
                <li key={n.id}>
                  <Link to="/nights/$id" params={{ id: n.id }} className="block rounded-md bg-background/30 px-3 py-2 text-sm hover:bg-background/50">
                    <div className="font-medium">{n.title}</div>
                    <div className="text-xs text-muted-foreground">{formatEUDate(n.starts_at)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {upcoming.length > 0 && <Countdown nextNight={upcoming[0]} />}
    </AppShell>
  );
}

function Countdown({ nextNight }: { nextNight?: import("@/lib/poker").Night }) {
  const target = useMemo(() => (nextNight ? new Date(nextNight.starts_at).getTime() : 0), [nextNight]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!nextNight || !target) return null;

  const diff = Math.max(0, target - now);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");

  const units = [
    { value: days, label: "Days" },
    { value: hours, label: "Hours" },
    { value: minutes, label: "Mins" },
    { value: seconds, label: "Secs" },
  ];

  return (
    <div className="card-felt shadow-card mx-auto mt-8 max-w-3xl rounded-2xl p-6 text-center">
      <div className="mb-4 flex items-center justify-center gap-2 text-muted-foreground">
        <Hourglass className="h-5 w-5 text-gold" />
        <span className="text-sm uppercase tracking-widest">Next game starts in</span>
      </div>
      <div className="grid grid-cols-4 gap-2 md:gap-4">
        {units.map((unit) => (
          <div key={unit.label} className="flex flex-col items-center">
            <div className="font-display text-4xl font-bold text-gold md:text-6xl">{pad(unit.value)}</div>
            <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground md:text-xs">{unit.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 font-medium">{nextNight.title}</div>
      <div className="text-xs text-muted-foreground">{formatEUDateTime(nextNight.starts_at)}</div>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card-felt shadow-card rounded-2xl p-5">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <div className="font-display text-lg font-semibold">{title}</div>
      </div>
      {children}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-sm text-muted-foreground">{text}</div>;
}