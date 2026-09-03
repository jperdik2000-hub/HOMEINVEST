import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { computePlayerStats, computeAchievements, fetchAllResults, fetchProfiles, formatMoney, formatDisplayName } from "@/lib/poker";
import { Trophy, TrendingDown, TrendingUp, Skull, Crown, Flame, Snowflake, Target, Percent, Info } from "lucide-react";
import { PlayerLink } from "@/components/PlayerLink";

export const Route = createFileRoute("/_authenticated/leaderboard")({
  head: () => ({ meta: [{ title: "Leaderboard — Poker Club" }] }),
  component: Leaderboard,
});

function Leaderboard() {
  const results = useQuery({ queryKey: ["results"], queryFn: fetchAllResults });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });

  const stats = computePlayerStats(results.data ?? [], profiles.data ?? []);
  const board = [...stats].sort((a, b) => b.total - a.total);
  const a = computeAchievements(stats, results.data ?? []);

  const bestSingleName = a.bestSingleNight
    ? nameFor(a.bestSingleNight, profiles.data ?? [])
    : "—";
  const worstSingleName = a.worstSingleNight
    ? nameFor(a.worstSingleNight, profiles.data ?? [])
    : "—";
  const bestSingleUser = a.bestSingleNight?.user_id ?? null;
  const bestSinglePlayerName = a.bestSingleNight?.player_name ?? null;
  const worstSingleUser = a.worstSingleNight?.user_id ?? null;
  const worstSinglePlayerName = a.worstSingleNight?.player_name ?? null;

  return (
    <AppShell>
      <h1 className="font-display text-3xl font-bold md:text-4xl">Leaderboard</h1>
      <p className="mb-6 text-sm text-muted-foreground">Who really owns the table.</p>

      <h2 className="mb-3 font-display text-xl font-semibold">Achievements</h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Highlight icon={<Crown className="h-5 w-5 text-gold"/>} label="Biggest winner" name={a.biggestWinner?.name ?? "—"} userId={a.biggestWinner?.user_id ?? null} value={a.biggestWinner ? formatMoney(a.biggestWinner.total) : "—"} tone="up" info="Highest total profit across all completed games."/>
        <Highlight icon={<Skull className="h-5 w-5 text-red-400"/>} label="Biggest loser" name={a.biggestLoser?.name ?? "—"} userId={a.biggestLoser?.user_id ?? null} value={a.biggestLoser ? formatMoney(a.biggestLoser.total) : "—"} tone="down" info="Biggest total loss across all completed games."/>
        <Highlight icon={<TrendingUp className="h-5 w-5 text-emerald-400"/>} label="Best single night" name={bestSingleName} userId={bestSingleUser} walkinName={bestSinglePlayerName} value={a.bestSingleNight ? formatMoney(Number(a.bestSingleNight.net_result)) : "—"} tone="up" info="The single biggest win in one game."/>
        <Highlight icon={<TrendingDown className="h-5 w-5 text-red-400"/>} label="Worst single night" name={worstSingleName} userId={worstSingleUser} walkinName={worstSinglePlayerName} value={a.worstSingleNight ? formatMoney(Number(a.worstSingleNight.net_result)) : "—"} tone="down" info="The single biggest loss in one game."/>
        <Highlight icon={<Flame className="h-5 w-5 text-orange-400"/>} label="Hottest right now" name={a.hottestRightNow?.name ?? "—"} userId={a.hottestRightNow?.user_id ?? null} value={a.hottestRightNow ? `${a.hottestRightNow.currentStreak}-night win streak` : "—"} tone="up" info="Currently on the longest active winning streak."/>
        <Highlight icon={<Snowflake className="h-5 w-5 text-sky-400"/>} label="Ice cold" name={a.coldestRightNow?.name ?? "—"} userId={a.coldestRightNow?.user_id ?? null} value={a.coldestRightNow ? `${Math.abs(a.coldestRightNow.currentStreak)}-night losing streak` : "—"} tone="down" info="Currently on the longest active losing streak."/>
        <Highlight icon={<Trophy className="h-5 w-5 text-gold"/>} label="Longest win streak" name={a.longestWinStreak?.name ?? "—"} userId={a.longestWinStreak?.user_id ?? null} value={a.longestWinStreak ? `${a.longestWinStreak.longestWinStreak} nights` : "—"} tone="up" info="Most consecutive wins ever recorded."/>
        <Highlight icon={<Target className="h-5 w-5 text-emerald-400"/>} label="Most consistent" name={a.mostConsistent?.name ?? "—"} userId={a.mostConsistent?.user_id ?? null} value={a.mostConsistent ? `${formatMoney(a.mostConsistent.avg)} / night` : "—"} tone={a.mostConsistent && a.mostConsistent.avg >= 0 ? "up" : "down"} info="Best average profit relative to result swings. Steady beats volatile."/>
        <Highlight icon={<Percent className="h-5 w-5 text-emerald-400"/>} label="Highest win rate" name={a.highestWinRate?.name ?? "—"} userId={a.highestWinRate?.user_id ?? null} value={a.highestWinRate ? `${Math.round(a.highestWinRate.winRate * 100)}% (${a.highestWinRate.wins}/${a.highestWinRate.games})` : "—"} tone="up" info="Highest percentage of games that ended with a positive result."/>
      </div>

      <div className="card-felt shadow-card overflow-hidden rounded-2xl">
        <div className="flex items-center gap-2 border-b border-border/60 p-4">
          <Trophy className="h-5 w-5 text-gold"/>
          <div className="font-display text-lg font-semibold">All-time standings</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Player</th>
                <th className="px-4 py-3 text-right">Games</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Avg / night</th>
                <th className="px-4 py-3 text-right">Win %</th>
                <th className="px-4 py-3 text-right">Streak</th>
                <th className="px-4 py-3 text-right">Best</th>
                <th className="px-4 py-3 text-right">Worst</th>
              </tr>
            </thead>
            <tbody>
              {board.length === 0 && (
                <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No results yet — log a game to populate the board.</td></tr>
              )}
              {board.map((r, i) => (
                <tr key={(r.user_id ?? r.name) + i} className="border-t border-border/40">
                  <td className="px-4 py-3 text-gold">#{i+1}</td>
                  <td className="px-4 py-3">
                    <PlayerLink userId={r.user_id} name={r.name} />
                  </td>
                  <td className="px-4 py-3 text-right">{r.games}</td>
                  <td className={"px-4 py-3 text-right font-mono " + (r.total >= 0 ? "text-emerald-400" : "text-red-400")}>{formatMoney(r.total)}</td>
                  <td className={"px-4 py-3 text-right font-mono " + (r.avg >= 0 ? "text-emerald-400" : "text-red-400")}>{formatMoney(r.avg)}</td>
                  <td className="px-4 py-3 text-right font-mono">{Math.round(r.winRate * 100)}%</td>
                  <td className={"px-4 py-3 text-right font-mono " + (r.currentStreak > 0 ? "text-emerald-400" : r.currentStreak < 0 ? "text-red-400" : "text-muted-foreground")}>
                    {r.currentStreak > 0 ? `W${r.currentStreak}` : r.currentStreak < 0 ? `L${Math.abs(r.currentStreak)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-400">{formatMoney(r.best)}</td>
                  <td className="px-4 py-3 text-right font-mono text-red-400">{formatMoney(r.worst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function nameFor(r: { user_id: string | null; player_name: string }, profiles: { id: string; name: string; nickname: string | null }[]) {
  if (r.user_id) {
    const p = profiles.find((p) => p.id === r.user_id);
    if (p) return formatDisplayName(p.name, p.nickname, r.player_name);
  }
  return r.player_name;
}

function Highlight({ icon, label, name, userId, walkinName, value, tone, info }: { icon: React.ReactNode; label: string; name: string; userId?: string | null; walkinName?: string | null; value: string; tone: "up"|"down"; info: string }) {
  const [show, setShow] = useState(false);
  const linkName = userId ? name : (walkinName ?? name);
  return (
    <div className="card-felt rounded-2xl p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
        <div className="flex items-center gap-2">{icon}{label}</div>
        <button
          type="button"
          aria-label={`What is ${label}?`}
          onClick={() => setShow((s) => !s)}
          className="rounded-full p-1 hover:bg-white/10"
        >
          <Info className="h-4 w-4"/>
        </button>
      </div>
      <div className="mt-2 font-display text-lg font-semibold">
        {name === "—" ? name : (
          <PlayerLink userId={userId} name={linkName}>{name}</PlayerLink>
        )}
      </div>
      <div className={"font-mono text-xl " + (tone === "up" ? "text-emerald-400" : "text-red-400")}>{value}</div>
      {show && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{info}</p>
      )}
    </div>
  );
}