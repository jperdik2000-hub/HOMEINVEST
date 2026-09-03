import { supabase } from "@/integrations/supabase/client";

export type Night = {
  id: string;
  host_id: string;
  title: string;
  starts_at: string;
  location: string | null;
  buy_in: number;
  currency: string;
  notes: string | null;
  status: string;
};

export type PlayerResult = {
  id: string;
  night_id: string;
  user_id: string | null;
  player_name: string;
  buy_in: number;
  rebuys: number;
  cash_out: number;
  net_result: number;
  final_rank: number | null;
  award: string | null;
  notes: string | null;
  night_starts_at?: string;
};

export type Profile = {
  id: string;
  name: string;
  nickname: string | null;
  email: string;
  avatar_url: string | null;
};

export function formatMoney(v: number, _currency = "EUR") {
  const currency = "EUR";
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${v.toFixed(0)} ${currency}`;
  }
}

export function formatDisplayName(name: string | null | undefined, nickname: string | null | undefined, fallback = "Player") {
  const n = (name ?? "").trim() || fallback;
  const nick = (nickname ?? "").trim();
  if (!nick || nick === n) return n;
  return `${n} "${nick}"`;
}

// EU date & 24-hour time formatting helpers
function pad(n: number) { return n.toString().padStart(2, "0"); }
export function formatEUDateTime(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
export function formatEUDate(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()}`;
}
export function formatEUTime(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

export async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase.from("profiles").select("id,name,nickname,email,avatar_url");
  if (error) throw error;
  return data ?? [];
}

export async function fetchAllResults(): Promise<PlayerResult[]> {
  const { data, error } = await supabase
    .from("player_results")
    .select("*, poker_nights!inner(status,starts_at)")
    .eq("poker_nights.status", "completed");
  if (error) throw error;
  return (data ?? []).map(({ poker_nights: night, ...result }) => ({
    ...result,
    night_starts_at: (night as any)?.starts_at,
  })) as PlayerResult[];
}

export async function fetchNights(): Promise<Night[]> {
  const { data, error } = await supabase.from("poker_nights").select("*").order("starts_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Night[];
}

export type LeaderRow = {
  user_id: string | null;
  name: string;
  games: number;
  total: number;
  avg: number;
  best: number;
  worst: number;
};

export function computeLeaderboard(results: PlayerResult[], profiles: Profile[]): LeaderRow[] {
  const byUser = new Map<string, LeaderRow>();
  for (const r of results) {
    const key = r.user_id ?? `name:${r.player_name}`;
    const prof = r.user_id ? profiles.find((p) => p.id === r.user_id) : undefined;
    const name = prof ? formatDisplayName(prof.name, prof.nickname, r.player_name) : r.player_name;
    const row = byUser.get(key) ?? { user_id: r.user_id, name, games: 0, total: 0, avg: 0, best: -Infinity, worst: Infinity };
    row.games += 1;
    row.total += Number(r.net_result);
    row.best = Math.max(row.best, Number(r.net_result));
    row.worst = Math.min(row.worst, Number(r.net_result));
    byUser.set(key, row);
  }
  for (const row of byUser.values()) row.avg = row.games ? row.total / row.games : 0;
  return [...byUser.values()].sort((a, b) => b.total - a.total);
}

export const AWARDS = [
  { value: "bad_beat", label: "Bad Beat of the Night" },
  { value: "bluff_king", label: "Bluff King" },
  { value: "unluckiest", label: "Unluckiest Player" },
  { value: "biggest_donator", label: "Biggest Donator" },
  { value: "comeback_king", label: "Comeback King" },
  { value: "chip_leader", label: "Chip Leader" },
  { value: "shortest_stack", label: "Shortest Stack Survivor" },
  { value: "first_out", label: "First Out" },
  { value: "last_longer", label: "Last Longer" },
  { value: "bubble_boy", label: "Bubble Boy" },
  { value: "iron_man", label: "Iron Man (Longest Session)" },
  { value: "rock", label: "The Rock (Tightest Player)" },
  { value: "maniac", label: "The Maniac (Loosest Player)" },
  { value: "calling_station", label: "Calling Station" },
  { value: "nit", label: "Biggest Nit" },
  { value: "shark", label: "Table Shark" },
  { value: "fish", label: "Table Fish" },
  { value: "whale", label: "The Whale" },
  { value: "hero_call", label: "Hero Call of the Night" },
  { value: "sick_fold", label: "Sickest Fold" },
  { value: "cooler", label: "Cooler of the Night" },
  { value: "suckout", label: "Biggest Suckout" },
  { value: "river_rat", label: "River Rat" },
  { value: "runner_runner", label: "Runner Runner" },
  { value: "one_outer", label: "One-Outer Wonder" },
  { value: "quads", label: "Quads Club" },
  { value: "straight_flush", label: "Straight Flush" },
  { value: "royal_flush", label: "Royal Flush" },
  { value: "aces_cracked", label: "Aces Cracked" },
  { value: "kings_cracked", label: "Kings Cracked" },
  { value: "set_over_set", label: "Set Over Set" },
  { value: "biggest_pot", label: "Biggest Pot Won" },
  { value: "biggest_loss", label: "Biggest Pot Lost" },
  { value: "all_in_king", label: "All-In King" },
  { value: "tilt_master", label: "Tilt Master" },
  { value: "zen_master", label: "Zen Master (Coolest Head)" },
  { value: "trash_talker", label: "Best Trash Talk" },
  { value: "quietest", label: "Quietest Assassin" },
  { value: "showman", label: "Best Showman" },
  { value: "dealer", label: "Best Dealer" },
  { value: "worst_dealer", label: "Worst Dealer" },
  { value: "snack_king", label: "Snack King" },
  { value: "drinker", label: "MVP of the Bar" },
  { value: "late_arrival", label: "Fashionably Late" },
  { value: "early_bird", label: "Early Bird" },
  { value: "no_show", label: "Ghost of the Night" },
  { value: "host_mvp", label: "Host MVP" },
  { value: "rookie", label: "Rookie of the Night" },
  { value: "veteran", label: "Veteran's Wisdom" },
  { value: "lucky", label: "Luckiest Player" },
  { value: "mathematician", label: "The Mathematician" },
  { value: "storyteller", label: "Best Bad Beat Story" },
  { value: "slowroll", label: "Slowroll of the Night" },
  { value: "angle_shooter", label: "Angle Shooter" },
  { value: "gentleman", label: "Gentleman of the Table" },
  { value: "wildcard", label: "Wildcard of the Night" },
] as const;

export type PlayerStats = {
  user_id: string | null;
  name: string;
  games: number;
  total: number;
  avg: number;
  best: number;
  worst: number;
  wins: number; // positive-net nights
  winRate: number; // 0..1
  currentStreak: number; // + winning streak, - losing streak, 0 none
  longestWinStreak: number;
  longestLossStreak: number;
  stdev: number; // std deviation of net results
  consistency: number; // score: avg per game / (1 + stdev), higher = more consistent winner
  itmRate: number; // in-the-money = non-negative
};

export function computePlayerStats(results: PlayerResult[], profiles: Profile[]): PlayerStats[] {
  const groups = new Map<string, PlayerResult[]>();
  for (const r of results) {
    const key = r.user_id ?? `name:${r.player_name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const out: PlayerStats[] = [];
  for (const [key, rs] of groups) {
    const sorted = [...rs].sort((a, b) => {
      const da = a.night_starts_at ? new Date(a.night_starts_at).getTime() : 0;
      const db = b.night_starts_at ? new Date(b.night_starts_at).getTime() : 0;
      return da - db;
    });
    const nets = sorted.map((r) => Number(r.net_result));
    const games = nets.length;
    const total = nets.reduce((a, b) => a + b, 0);
    const avg = games ? total / games : 0;
    const best = nets.length ? Math.max(...nets) : 0;
    const worst = nets.length ? Math.min(...nets) : 0;
    const wins = nets.filter((n) => n > 0).length;
    const itm = nets.filter((n) => n >= 0).length;
    const variance = games ? nets.reduce((s, n) => s + (n - avg) ** 2, 0) / games : 0;
    const stdev = Math.sqrt(variance);

    // streaks
    let longestWin = 0, longestLoss = 0, curWin = 0, curLoss = 0;
    for (const n of nets) {
      if (n > 0) { curWin++; curLoss = 0; longestWin = Math.max(longestWin, curWin); }
      else if (n < 0) { curLoss++; curWin = 0; longestLoss = Math.max(longestLoss, curLoss); }
      else { curWin = 0; curLoss = 0; }
    }
    // current streak = tail
    let currentStreak = 0;
    for (let i = nets.length - 1; i >= 0; i--) {
      const n = nets[i];
      if (n > 0) { if (currentStreak >= 0) currentStreak++; else break; }
      else if (n < 0) { if (currentStreak <= 0) currentStreak--; else break; }
      else break;
    }

    const first = rs[0];
    const prof = first.user_id ? profiles.find((p) => p.id === first.user_id) : undefined;
    const name = prof ? formatDisplayName(prof.name, prof.nickname, first.player_name) : first.player_name;

    out.push({
      user_id: first.user_id,
      name,
      games,
      total,
      avg,
      best,
      worst,
      wins,
      winRate: games ? wins / games : 0,
      currentStreak,
      longestWinStreak: longestWin,
      longestLossStreak: longestLoss,
      stdev,
      consistency: avg / (1 + stdev),
      itmRate: games ? itm / games : 0,
    });
    void key;
  }
  return out;
}

export type Achievements = {
  biggestWinner?: PlayerStats;
  biggestLoser?: PlayerStats;
  bestSingleNight?: PlayerResult;
  worstSingleNight?: PlayerResult;
  longestWinStreak?: PlayerStats;
  hottestRightNow?: PlayerStats; // best current winning streak
  coldestRightNow?: PlayerStats; // worst current losing streak
  mostConsistent?: PlayerStats; // best consistency among 3+ games
  highestWinRate?: PlayerStats; // among 3+ games
};

export function computeAchievements(stats: PlayerStats[], results: PlayerResult[]): Achievements {
  if (!stats.length) return {};
  const min = 3;
  const eligible = stats.filter((s) => s.games >= min);
  const pickMax = <T,>(arr: T[], f: (x: T) => number) =>
    arr.length ? arr.reduce((m, x) => (f(x) > f(m) ? x : m)) : undefined;
  const pickMin = <T,>(arr: T[], f: (x: T) => number) =>
    arr.length ? arr.reduce((m, x) => (f(x) < f(m) ? x : m)) : undefined;
  const bestSingle = results.reduce<PlayerResult | undefined>(
    (m, r) => (!m || Number(r.net_result) > Number(m.net_result) ? r : m),
    undefined,
  );
  const worstSingle = results.reduce<PlayerResult | undefined>(
    (m, r) => (!m || Number(r.net_result) < Number(m.net_result) ? r : m),
    undefined,
  );
  const hot = pickMax(stats.filter((s) => s.currentStreak > 0), (s) => s.currentStreak);
  const cold = pickMin(stats.filter((s) => s.currentStreak < 0), (s) => s.currentStreak);
  return {
    biggestWinner: pickMax(stats, (s) => s.total),
    biggestLoser: pickMin(stats, (s) => s.total),
    bestSingleNight: bestSingle,
    worstSingleNight: worstSingle,
    longestWinStreak: pickMax(stats, (s) => s.longestWinStreak),
    hottestRightNow: hot,
    coldestRightNow: cold,
    mostConsistent: pickMax(eligible.length ? eligible : stats, (s) => s.consistency),
    highestWinRate: pickMax(eligible.length ? eligible : stats, (s) => s.winRate),
  };
}