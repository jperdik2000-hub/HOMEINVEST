export type TvSettings = {
  showMoney: boolean;
  showChips: boolean;
  showRankings: boolean;
  sounds: boolean;
  animations: boolean;
  showFeed: boolean;
  theme: "dark" | "light";
  overlayEvents: string[];
};

export const DEFAULT_TV_SETTINGS: TvSettings = {
  showMoney: true,
  showChips: false,
  showRankings: true,
  sounds: true,
  animations: true,
  showFeed: true,
  theme: "dark",
  overlayEvents: [
    "player_joined",
    "buy_in",
    "rebuy",
    "addon",
    "eliminated",
    "cash_out",
    "break_start",
    "break_end",
    "blind_up",
    "game_paused",
    "game_resumed",
    "winner",
    "announcement",
  ],
};

export const TV_EVENT_TYPES: { value: string; label: string }[] = [
  { value: "player_joined", label: "Player joined" },
  { value: "buy_in", label: "Player bought in" },
  { value: "rebuy", label: "Player rebought" },
  { value: "addon", label: "Player added on" },
  { value: "eliminated", label: "Player eliminated" },
  { value: "cash_out", label: "Player cashed out" },
  { value: "break_start", label: "Break started" },
  { value: "break_end", label: "Break ended" },
  { value: "blind_up", label: "Blind level increased" },
  { value: "game_paused", label: "Game paused" },
  { value: "game_resumed", label: "Game resumed" },
  { value: "winner", label: "Final winner declared" },
  { value: "announcement", label: "Announcement" },
];

export function mergeTvSettings(raw: unknown): TvSettings {
  const s = (raw ?? {}) as Partial<TvSettings>;
  return { ...DEFAULT_TV_SETTINGS, ...s, overlayEvents: s.overlayEvents ?? DEFAULT_TV_SETTINGS.overlayEvents };
}

export function generateTvCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function tvEventHeadline(type: string, meta: Record<string, any>): string {
  const name = (meta?.name as string) || "Player";
  switch (type) {
    case "player_joined": return `${name} joined`;
    case "buy_in": return `${name} buys in`;
    case "rebuy": return `${name} rebuys`;
    case "addon": return `${name} adds on`;
    case "eliminated": return `${name} eliminated`;
    case "cash_out": return `${name} cashed out`;
    case "winner": return `${name} wins!`;
    case "break_start": return "Break time";
    case "break_end": return "Back to play";
    case "blind_up": return "Blinds up";
    case "game_paused": return "Game paused";
    case "game_resumed": return "Game resumed";
    case "game_started": return "Game started";
    case "game_completed": return "Game finished";
    case "announcement": return (meta?.text as string) || "Announcement";
    default: return type.replace(/_/g, " ");
  }
}

export function tvFeedLine(type: string, meta: Record<string, any>, amount: number, money: (n: number) => string) {
  const name = (meta?.name as string) || "Player";
  switch (type) {
    case "player_joined": return `${name} joined the game`;
    case "buy_in": return `${name} bought in for ${money(amount)}`;
    case "rebuy": return `${name} rebought ${money(amount)}`;
    case "addon": return `${name} added on ${money(amount)}`;
    case "cash_out": return `${name} cashed out ${money(amount)}`;
    case "eliminated": return `${name} was eliminated`;
    case "winner": return `${name} won the game`;
    default: return tvEventHeadline(type, meta);
  }
}

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
export type BreakState = { until: string; minutes: number; label: string | null };

/**
 * Derive the current break from the game event log. A `break_start` event with
 * `metadata.until` opens a break; a later `break_end` (or the clock running
 * out) closes it. Events may be in any order.
 */
export function activeBreakFrom(
  events: { type: string; metadata: Record<string, any>; createdAt: string }[],
  now: number = Date.now(),
): BreakState | null {
  const relevant = events
    .filter((e) => e.type === "break_start" || e.type === "break_end")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const latest = relevant[0];
  if (!latest || latest.type !== "break_start") return null;
  const until = String(latest.metadata?.until ?? "");
  if (!until) return null;
  if (new Date(until).getTime() <= now) return null;
  return {
    until,
    minutes: Number(latest.metadata?.minutes ?? 0),
    label: (latest.metadata?.label as string | null) ?? null,
  };
}

export function breakCountdown(untilIso: string, now: number = Date.now()) {
  const s = Math.max(0, Math.round((new Date(untilIso).getTime() - now) / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
