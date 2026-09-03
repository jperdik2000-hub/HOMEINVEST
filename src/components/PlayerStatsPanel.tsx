import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Night, PlayerResult } from "@/lib/poker";
import { formatEUDate, formatMoney } from "@/lib/poker";

type Props = { results: PlayerResult[]; nights?: Night[] };

const UP = "hsl(152 60% 48%)";
const DOWN = "hsl(0 72% 58%)";
const GOLD = "hsl(43 74% 55%)";
const NEUTRAL = "hsl(215 16% 55%)";

function niceDate(iso?: string) {
  if (!iso) return "—";
  return formatEUDate(iso);
}

export function PlayerStatsPanel({ results, nights }: Props) {
  const [range, setRange] = useState<"all" | "10" | "5">("all");

  const sorted = useMemo(
    () =>
      [...results].sort((a, b) => {
        const da = a.night_starts_at ? new Date(a.night_starts_at).getTime() : 0;
        const db = b.night_starts_at ? new Date(b.night_starts_at).getTime() : 0;
        return da - db;
      }),
    [results],
  );

  const scoped = useMemo(() => {
    if (range === "all") return sorted;
    const n = range === "10" ? 10 : 5;
    return sorted.slice(-n);
  }, [sorted, range]);

  const series = useMemo(() => {
    let cum = 0;
    let invested = 0;
    return scoped.map((r, i) => {
      const net = Number(r.net_result);
      const stake = Number(r.buy_in) + Number(r.rebuys ?? 0);
      cum += net;
      invested += stake;
      const night = nights?.find((n) => n.id === r.night_id);
      return {
        idx: i + 1,
        label: r.night_starts_at ? niceDate(r.night_starts_at) : `#${i + 1}`,
        title: night?.title ?? "Poker game",
        net,
        stake,
        cum,
        roi: invested > 0 ? (cum / invested) * 100 : 0,
        rank: r.final_rank,
      };
    });
  }, [scoped, nights]);

  const stats = useMemo(() => {
    const nets = scoped.map((r) => Number(r.net_result));
    const games = nets.length;
    const total = nets.reduce((a, b) => a + b, 0);
    const invested = scoped.reduce((s, r) => s + Number(r.buy_in) + Number(r.rebuys ?? 0), 0);
    const wins = nets.filter((n) => n > 0).length;
    const losses = nets.filter((n) => n < 0).length;
    const evens = games - wins - losses;
    const itm = nets.filter((n) => n >= 0).length;
    const avg = games ? total / games : 0;
    const variance = games ? nets.reduce((s, n) => s + (n - avg) ** 2, 0) / games : 0;
    const stdev = Math.sqrt(variance);
    const ranked = scoped.filter((r) => r.final_rank != null);
    const podium = ranked.filter((r) => (r.final_rank ?? 99) <= 3).length;
    const firsts = ranked.filter((r) => r.final_rank === 1).length;
    const avgRank = ranked.length
      ? ranked.reduce((s, r) => s + (r.final_rank as number), 0) / ranked.length
      : 0;
    const rebuys = scoped.reduce((s, r) => s + Number(r.rebuys ?? 0), 0);

    // streaks
    let longestWin = 0, longestLoss = 0, cw = 0, cl = 0;
    for (const n of nets) {
      if (n > 0) { cw++; cl = 0; longestWin = Math.max(longestWin, cw); }
      else if (n < 0) { cl++; cw = 0; longestLoss = Math.max(longestLoss, cl); }
      else { cw = 0; cl = 0; }
    }
    let cur = 0;
    for (let i = nets.length - 1; i >= 0; i--) {
      const n = nets[i];
      if (n > 0) { if (cur >= 0) cur++; else break; }
      else if (n < 0) { if (cur <= 0) cur--; else break; }
      else break;
    }
    const peak = series.length ? Math.max(...series.map((s) => s.cum)) : 0;
    let maxDrawdown = 0, runMax = -Infinity;
    for (const s of series) {
      runMax = Math.max(runMax, s.cum);
      maxDrawdown = Math.min(maxDrawdown, s.cum - runMax);
    }
    return {
      games, total, invested, wins, losses, evens, itm, avg, stdev,
      roi: invested > 0 ? (total / invested) * 100 : 0,
      winRate: games ? (wins / games) * 100 : 0,
      itmRate: games ? (itm / games) * 100 : 0,
      best: games ? Math.max(...nets) : 0,
      worst: games ? Math.min(...nets) : 0,
      longestWin, longestLoss, cur, peak, maxDrawdown,
      podium, firsts, avgRank, rankedGames: ranked.length, rebuys,
      avgStake: games ? invested / games : 0,
    };
  }, [scoped, series]);

  const monthly = useMemo(() => {
    const map = new Map<string, { key: string; label: string; net: number; games: number }>();
    for (const r of scoped) {
      if (!r.night_starts_at) continue;
      const d = new Date(r.night_starts_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleString("en-GB", { month: "short", year: "2-digit" });
      const row = map.get(key) ?? { key, label, net: 0, games: 0 };
      row.net += Number(r.net_result);
      row.games += 1;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [scoped]);

  const weekday = useMemo(() => {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const rows = names.map((label) => ({ label, net: 0, games: 0 }));
    for (const r of scoped) {
      if (!r.night_starts_at) continue;
      const d = new Date(r.night_starts_at).getDay();
      rows[d].net += Number(r.net_result);
      rows[d].games += 1;
    }
    // Mon-first, only days played
    const ordered = [...rows.slice(1), rows[0]];
    return ordered.filter((r) => r.games > 0);
  }, [scoped]);

  const outcomePie = useMemo(
    () =>
      [
        { name: "Winning nights", value: stats.wins, color: UP },
        { name: "Break-even", value: stats.evens, color: NEUTRAL },
        { name: "Losing nights", value: stats.losses, color: DOWN },
      ].filter((s) => s.value > 0),
    [stats],
  );

  const rankDist = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of scoped) {
      if (r.final_rank == null) continue;
      map.set(r.final_rank, (map.get(r.final_rank) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([rank, count]) => ({ label: `#${rank}`, rank, count }));
  }, [scoped]);

  if (sorted.length === 0) {
    return (
      <div className="card-felt shadow-card mt-6 rounded-2xl p-5">
        <div className="mb-2 font-display text-lg font-semibold">Statistics</div>
        <div className="rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
          No completed games yet — stats and graphs appear after the first result is posted.
        </div>
      </div>
    );
  }

  return (
    <section className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Statistics & trends</h2>
        <div className="flex rounded-lg border border-border/60 bg-background/40 p-1 text-xs">
          {([["all", "All time"], ["10", "Last 10"], ["5", "Last 5"]] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setRange(v)}
              className={
                "rounded-md px-3 py-1 transition " +
                (range === v ? "bg-gold/15 text-gold" : "text-muted-foreground hover:text-foreground")
              }
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="ROI" value={`${stats.roi >= 0 ? "+" : ""}${stats.roi.toFixed(1)}%`} tone={stats.roi >= 0 ? "up" : "down"} sub={`on ${formatMoney(stats.invested)} invested`} />
        <Tile label="Win rate" value={`${stats.winRate.toFixed(0)}%`} sub={`${stats.wins}W / ${stats.losses}L${stats.evens ? ` / ${stats.evens}E` : ""}`} />
        <Tile label="ITM %" value={`${stats.itmRate.toFixed(0)}%`} sub={`${stats.itm} of ${stats.games} cashed`} />
        <Tile label="Avg / night" value={formatMoney(stats.avg)} tone={stats.avg >= 0 ? "up" : "down"} sub={`σ ${formatMoney(stats.stdev)}`} />
        <Tile label="Current streak" value={stats.cur === 0 ? "—" : `${Math.abs(stats.cur)} ${stats.cur > 0 ? "W" : "L"}`} tone={stats.cur > 0 ? "up" : stats.cur < 0 ? "down" : undefined} sub={`best ${stats.longestWin}W · worst ${stats.longestLoss}L`} />
        <Tile label="Peak bankroll" value={formatMoney(stats.peak)} sub={`max drawdown ${formatMoney(stats.maxDrawdown)}`} />
        <Tile label="Avg buy-in" value={formatMoney(stats.avgStake)} sub={`${stats.rebuys ? formatMoney(stats.rebuys) + " rebuys" : "no rebuys"}`} />
        <Tile
          label="Podiums"
          value={stats.rankedGames ? `${stats.podium}` : "—"}
          sub={stats.rankedGames ? `${stats.firsts} wins · avg finish ${stats.avgRank.toFixed(1)}` : "no ranked finishes"}
        />
      </div>

      <div className="card-felt shadow-card rounded-2xl p-4">
        <div className="mb-1 font-display text-lg font-semibold">Cumulative profit / loss</div>
        <div className="mb-3 text-xs text-muted-foreground">Bankroll trend across {series.length} game{series.length === 1 ? "" : "s"}</div>
        <ChartBox height={260}>
          <AreaChart data={series} margin={{ top: 5, right: 8, bottom: 0, left: -12 }}>
            <defs>
              <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={GOLD} stopOpacity={0.45} />
                <stop offset="100%" stopColor={GOLD} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 100% / 0.07)" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke={NEUTRAL} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} stroke={NEUTRAL} tickFormatter={(v) => formatMoney(Number(v))} width={62} />
            <ReferenceLine y={0} stroke="hsl(0 0% 100% / 0.25)" />
            <Tooltip content={<PnlTooltip />} />
            <Area type="monotone" dataKey="cum" name="Cumulative" stroke={GOLD} strokeWidth={2} fill="url(#pnlFill)" />
          </AreaChart>
        </ChartBox>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-felt shadow-card rounded-2xl p-4">
          <div className="mb-3 font-display text-lg font-semibold">Result per game</div>
          <ChartBox height={230}>
            <BarChart data={series} margin={{ top: 5, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 100% / 0.07)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke={NEUTRAL} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} stroke={NEUTRAL} tickFormatter={(v) => formatMoney(Number(v))} width={62} />
              <ReferenceLine y={0} stroke="hsl(0 0% 100% / 0.25)" />
              <Tooltip content={<PnlTooltip />} />
              <Bar dataKey="net" name="Net" radius={[3, 3, 0, 0]}>
                {series.map((d, i) => (
                  <Cell key={i} fill={d.net >= 0 ? UP : DOWN} />
                ))}
              </Bar>
            </BarChart>
          </ChartBox>
        </div>

        <div className="card-felt shadow-card rounded-2xl p-4">
          <div className="mb-3 font-display text-lg font-semibold">ROI trend</div>
          <ChartBox height={230}>
            <LineChart data={series} margin={{ top: 5, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 100% / 0.07)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke={NEUTRAL} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} stroke={NEUTRAL} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} width={46} />
              <ReferenceLine y={0} stroke="hsl(0 0% 100% / 0.25)" />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: any) => [`${Number(v).toFixed(1)}%`, "ROI to date"]}
              />
              <Line type="monotone" dataKey="roi" stroke={GOLD} strokeWidth={2} dot={false} />
            </LineChart>
          </ChartBox>
        </div>

        <div className="card-felt shadow-card rounded-2xl p-4">
          <div className="mb-3 font-display text-lg font-semibold">Night outcomes</div>
          <ChartBox height={230}>
            <PieChart>
              <Pie data={outcomePie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={3} stroke="none">
                {outcomePie.map((s, i) => (
                  <Cell key={i} fill={s.color} />
                ))}
              </Pie>
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [`${v} night${Number(v) === 1 ? "" : "s"}`, n]} />
            </PieChart>
          </ChartBox>
        </div>

        <div className="card-felt shadow-card rounded-2xl p-4">
          <div className="mb-3 font-display text-lg font-semibold">Profit by month</div>
          <ChartBox height={230}>
            <BarChart data={monthly} margin={{ top: 5, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 100% / 0.07)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke={NEUTRAL} />
              <YAxis tick={{ fontSize: 10 }} stroke={NEUTRAL} tickFormatter={(v) => formatMoney(Number(v))} width={62} />
              <ReferenceLine y={0} stroke="hsl(0 0% 100% / 0.25)" />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: any, _n: any, p: any) => [`${formatMoney(Number(v))} · ${p?.payload?.games} game(s)`, "Net"]}
              />
              <Bar dataKey="net" radius={[3, 3, 0, 0]}>
                {monthly.map((d, i) => (
                  <Cell key={i} fill={d.net >= 0 ? UP : DOWN} />
                ))}
              </Bar>
            </BarChart>
          </ChartBox>
        </div>

        {weekday.length > 1 && (
          <div className="card-felt shadow-card rounded-2xl p-4">
            <div className="mb-3 font-display text-lg font-semibold">Best day of the week</div>
            <ChartBox height={230}>
              <BarChart data={weekday} margin={{ top: 5, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 100% / 0.07)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke={NEUTRAL} />
                <YAxis tick={{ fontSize: 10 }} stroke={NEUTRAL} tickFormatter={(v) => formatMoney(Number(v))} width={62} />
                <ReferenceLine y={0} stroke="hsl(0 0% 100% / 0.25)" />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: any, _n: any, p: any) => [`${formatMoney(Number(v))} · ${p?.payload?.games} game(s)`, "Net"]}
                />
                <Bar dataKey="net" radius={[3, 3, 0, 0]}>
                  {weekday.map((d, i) => (
                    <Cell key={i} fill={d.net >= 0 ? UP : DOWN} />
                  ))}
                </Bar>
              </BarChart>
            </ChartBox>
          </div>
        )}

        {rankDist.length > 0 && (
          <div className="card-felt shadow-card rounded-2xl p-4">
            <div className="mb-3 font-display text-lg font-semibold">Finishing positions</div>
            <ChartBox height={230}>
              <BarChart data={rankDist} margin={{ top: 5, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 100% / 0.07)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke={NEUTRAL} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke={NEUTRAL} width={28} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${v} time(s)`, "Finished"]} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {rankDist.map((d, i) => (
                    <Cell key={i} fill={d.rank <= 3 ? GOLD : NEUTRAL} />
                  ))}
                </Bar>
              </BarChart>
            </ChartBox>
          </div>
        )}
      </div>
    </section>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "hsl(222 30% 10%)",
  border: "1px solid hsl(0 0% 100% / 0.12)",
  borderRadius: 10,
  fontSize: 12,
};

function PnlTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={tooltipStyle} className="px-3 py-2">
      <div className="font-medium">{d.title}</div>
      <div className="text-muted-foreground">{d.label}</div>
      <div className={d.net >= 0 ? "text-emerald-400" : "text-red-400"}>Night: {formatMoney(d.net)}</div>
      <div className="text-gold">Running: {formatMoney(d.cum)}</div>
    </div>
  );
}

function ChartBox({ height, children }: { height: number; children: React.ReactElement }) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="card-felt shadow-card rounded-xl p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={"font-mono text-lg font-semibold " + (tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : "")}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
