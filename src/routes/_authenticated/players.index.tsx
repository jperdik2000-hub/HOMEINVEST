import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { computeLeaderboard, fetchAllResults, fetchProfiles, formatMoney } from "@/lib/poker";
import { Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/players/")({
  head: () => ({ meta: [{ title: "Players — Poker Club" }] }),
  component: PlayersIndex,
});

function PlayersIndex() {
  const results = useQuery({ queryKey: ["results"], queryFn: fetchAllResults });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });

  const board = computeLeaderboard(results.data ?? [], profiles.data ?? []);
  const registered = board.filter((r) => r.user_id);

  // Aggregate walk-ins by name (case-insensitive).
  const walkinAgg = new Map<string, { name: string; games: number; total: number }>();
  for (const r of (results.data ?? []) as any[]) {
    if (r.user_id) continue;
    const raw = (r.player_name || "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const cur = walkinAgg.get(key) ?? { name: raw, games: 0, total: 0 };
    cur.games += 1;
    cur.total += Number(r.net_result || 0);
    walkinAgg.set(key, cur);
  }
  const walkins = [...walkinAgg.values()].sort(
    (a, b) => b.games - a.games || a.name.localeCompare(b.name),
  );

  return (
    <AppShell>
      <div className="animate-in fade-in duration-500 mb-6">
        <h1 className="font-display text-3xl font-bold md:text-4xl">Players</h1>
        <p className="text-sm text-muted-foreground">Tap any player to see their personal stats.</p>
      </div>

      {registered.length === 0 ? (
        <div className="card-felt rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          No players with recorded results yet.
        </div>
      ) : (
        <div className="animate-in fade-in duration-500 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {registered.map((r) => (
            <Link
              key={r.user_id!}
              to="/players/$id"
              params={{ id: r.user_id! }}
              className="card-felt shadow-card rounded-2xl p-4 transition duration-200 hover:-translate-y-0.5 hover:border-gold/60"
            >
              <div className="flex items-center gap-3">
                <div className="chip-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-gold">
                  <Users className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-base font-semibold">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.games} game{r.games === 1 ? "" : "s"}
                  </div>
                </div>
                <div
                  className={
                    "font-mono text-sm " + (r.total >= 0 ? "text-emerald-400" : "text-red-400")
                  }
                >
                  {formatMoney(r.total)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {walkins.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 font-display text-xl font-semibold">
            Walk-ins{" "}
            <span className="text-xs font-normal text-muted-foreground">({walkins.length})</span>
          </h2>
          <div className="animate-in fade-in duration-500 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {walkins.map((w) => (
              <Link
                key={w.name}
                to="/players/walkin/$name"
                params={{ name: encodeURIComponent(w.name) }}
                className="card-felt shadow-card rounded-2xl p-4 transition duration-200 hover:-translate-y-0.5 hover:border-gold/60"
              >
                <div className="flex items-center gap-3">
                  <div className="chip-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-gold">
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-base font-semibold">
                      {w.name}{" "}
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-gold">
                        walk-in
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {w.games} game{w.games === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div
                    className={
                      "font-mono text-sm " + (w.total >= 0 ? "text-emerald-400" : "text-red-400")
                    }
                  >
                    {formatMoney(w.total)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </AppShell>
  );
}
