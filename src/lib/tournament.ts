/**
 * Shared, client-safe tournament helpers: blind structures, payout splits,
 * prize-pool math and blind-clock math.
 *
 * The clock is intentionally "stateless": we only store when the current level
 * started (and, if paused, when it was paused). Every device derives the
 * remaining time from those timestamps, so phones and the TV stay in sync
 * without a server tick.
 */

export type BlindLevel = {
  /** 1-based level number. Break levels keep their number but have no blinds. */
  level: number;
  small: number;
  big: number;
  ante: number;
  /** Minutes for this level; falls back to the night's level_minutes. */
  minutes?: number;
  /** True for a scheduled break. */
  isBreak?: boolean;
};

export type PayoutSlice = { place: number; pct: number };

export type TournamentEntry = {
  id: string;
  night_id: string;
  user_id: string | null;
  player_name: string;
  chips: number;
  buy_ins: number;
  rebuys: number;
  addons: number;
  place: number | null;
  knocked_out_by: string | null;
  eliminated_at: string | null;
};

export type TournamentConfig = {
  buy_in: number;
  starting_stack: number;
  rebuy_amount: number;
  rebuy_chips: number;
  addon_amount: number;
  addon_chips: number;
  level_minutes: number;
  blind_levels: BlindLevel[];
  payout_split: PayoutSlice[];
  current_level: number;
  level_started_at: string | null;
  clock_paused_at: string | null;
  tournament_status: "not_started" | "running" | "finished";
};

/* ------------------------------------------------------------------ presets */

export const PAYOUT_TEMPLATES: { id: string; label: string; split: PayoutSlice[] }[] = [
  { id: "winner", label: "Winner takes all", split: [{ place: 1, pct: 100 }] },
  { id: "70-30", label: "70 / 30", split: [{ place: 1, pct: 70 }, { place: 2, pct: 30 }] },
  { id: "60-40", label: "60 / 40", split: [{ place: 1, pct: 60 }, { place: 2, pct: 40 }] },
  {
    id: "50-30-20",
    label: "50 / 30 / 20",
    split: [{ place: 1, pct: 50 }, { place: 2, pct: 30 }, { place: 3, pct: 20 }],
  },
  {
    id: "40-30-20-10",
    label: "40 / 30 / 20 / 10",
    split: [{ place: 1, pct: 40 }, { place: 2, pct: 30 }, { place: 3, pct: 20 }, { place: 4, pct: 10 }],
  },
];

function levels(rows: [number, number, number][], opts?: { breakAfter?: number }): BlindLevel[] {
  const out: BlindLevel[] = rows.map(([small, big, ante], i) => ({
    level: i + 1,
    small,
    big,
    ante,
  }));
  if (opts?.breakAfter) {
    const idx = opts.breakAfter;
    out.splice(idx, 0, { level: idx + 1, small: 0, big: 0, ante: 0, isBreak: true, minutes: 10 });
    out.forEach((l, i) => (l.level = i + 1));
  }
  return out;
}

export const STRUCTURE_PRESETS: {
  id: string;
  label: string;
  minutes: number;
  startingStack: number;
  levels: BlindLevel[];
}[] = [
  {
    id: "standard",
    label: "Standard (20 min levels)",
    minutes: 20,
    startingStack: 10000,
    levels: levels(
      [
        [25, 50, 0],
        [50, 100, 0],
        [75, 150, 0],
        [100, 200, 25],
        [150, 300, 25],
        [200, 400, 50],
        [300, 600, 75],
        [400, 800, 100],
        [600, 1200, 150],
        [800, 1600, 200],
        [1000, 2000, 300],
        [1500, 3000, 400],
        [2000, 4000, 500],
        [3000, 6000, 750],
        [4000, 8000, 1000],
      ],
      { breakAfter: 5 },
    ),
  },
  {
    id: "turbo",
    label: "Turbo (10 min levels)",
    minutes: 10,
    startingStack: 5000,
    levels: levels([
      [25, 50, 0],
      [50, 100, 0],
      [100, 200, 0],
      [150, 300, 25],
      [200, 400, 50],
      [300, 600, 75],
      [500, 1000, 100],
      [800, 1600, 200],
      [1200, 2400, 300],
      [2000, 4000, 500],
      [3000, 6000, 750],
      [5000, 10000, 1000],
    ]),
  },
  {
    id: "deep",
    label: "Deep stack (30 min levels)",
    minutes: 30,
    startingStack: 20000,
    levels: levels(
      [
        [25, 50, 0],
        [50, 100, 0],
        [75, 150, 0],
        [100, 200, 0],
        [150, 300, 25],
        [200, 400, 50],
        [250, 500, 50],
        [300, 600, 75],
        [400, 800, 100],
        [500, 1000, 100],
        [700, 1400, 200],
        [1000, 2000, 300],
        [1500, 3000, 400],
        [2000, 4000, 500],
        [3000, 6000, 750],
        [4000, 8000, 1000],
      ],
      { breakAfter: 6 },
    ),
  },
];

export const DEFAULT_STRUCTURE = STRUCTURE_PRESETS[0]!;

/* --------------------------------------------------------------- prize pool */

export function prizePool(cfg: Pick<TournamentConfig, "buy_in" | "rebuy_amount" | "addon_amount">, entries: TournamentEntry[]) {
  return entries.reduce(
    (sum, e) =>
      sum +
      (e.buy_ins || 0) * Number(cfg.buy_in || 0) +
      (e.rebuys || 0) * Number(cfg.rebuy_amount || 0) +
      (e.addons || 0) * Number(cfg.addon_amount || 0),
    0,
  );
}

export function investedBy(cfg: Pick<TournamentConfig, "buy_in" | "rebuy_amount" | "addon_amount">, e: TournamentEntry) {
  return (
    (e.buy_ins || 0) * Number(cfg.buy_in || 0) +
    (e.rebuys || 0) * Number(cfg.rebuy_amount || 0) +
    (e.addons || 0) * Number(cfg.addon_amount || 0)
  );
}

export function normalizeSplit(split: PayoutSlice[] | null | undefined): PayoutSlice[] {
  const rows = (split ?? []).filter((s) => Number(s?.pct) > 0);
  return rows
    .map((s) => ({ place: Number(s.place), pct: Number(s.pct) }))
    .sort((a, b) => a.place - b.place);
}

export function splitTotal(split: PayoutSlice[] | null | undefined) {
  return normalizeSplit(split).reduce((s, r) => s + r.pct, 0);
}

/** Money per paid place, rounded to whole units with the remainder to 1st. */
export function payoutsForPool(pool: number, split: PayoutSlice[] | null | undefined): { place: number; amount: number }[] {
  const rows = normalizeSplit(split);
  if (!rows.length || pool <= 0) return [];
  const raw = rows.map((r) => ({ place: r.place, amount: Math.floor((pool * r.pct) / 100) }));
  const remainder = pool - raw.reduce((s, r) => s + r.amount, 0);
  if (remainder > 0 && raw[0]) raw[0].amount += remainder;
  return raw;
}

export function payoutForPlace(pool: number, split: PayoutSlice[] | null | undefined, place: number | null) {
  if (place == null) return 0;
  return payoutsForPool(pool, split).find((p) => p.place === place)?.amount ?? 0;
}

/* -------------------------------------------------------------- clock math */

export function levelAt(cfg: Pick<TournamentConfig, "blind_levels">, level: number): BlindLevel | null {
  const rows = cfg.blind_levels ?? [];
  return rows[level - 1] ?? null;
}

export function levelSeconds(cfg: Pick<TournamentConfig, "blind_levels" | "level_minutes">, level: number) {
  const l = levelAt(cfg, level);
  const minutes = l?.minutes ?? cfg.level_minutes ?? 20;
  return Math.max(1, Math.round(minutes * 60));
}

/**
 * Seconds left in the current level given "now". Negative values mean the level
 * has expired (the host hasn't advanced yet), which the UI shows as 00:00.
 */
export function secondsLeft(
  cfg: Pick<TournamentConfig, "blind_levels" | "level_minutes" | "current_level" | "level_started_at" | "clock_paused_at">,
  nowMs: number,
) {
  if (!cfg.level_started_at) return levelSeconds(cfg, cfg.current_level || 1);
  const started = new Date(cfg.level_started_at).getTime();
  const ref = cfg.clock_paused_at ? new Date(cfg.clock_paused_at).getTime() : nowMs;
  const elapsed = Math.max(0, Math.floor((ref - started) / 1000));
  return levelSeconds(cfg, cfg.current_level || 1) - elapsed;
}

export function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function formatBlinds(l: BlindLevel | null) {
  if (!l) return "—";
  if (l.isBreak) return "Break";
  return l.ante > 0 ? `${l.small} / ${l.big} (${l.ante})` : `${l.small} / ${l.big}`;
}

export function isTournament(night: { format?: string | null } | null | undefined) {
  return (night?.format ?? "cash") === "tournament";
}

export function averageStack(entries: TournamentEntry[]) {
  const alive = entries.filter((e) => e.place == null);
  if (!alive.length) return 0;
  return Math.round(alive.reduce((s, e) => s + (e.chips || 0), 0) / alive.length);
}
