// Pure poker engine helpers. No DB access.
// Uses `pokersolver` for hand evaluation (supports Hold'em + Omaha).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore no types
import pkg from "pokersolver";
const { Hand } = pkg as { Hand: any };

export type Variant = "holdem" | "omaha" | "five_one" | "five_two" | "pineapple";

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUITS = ["s", "h", "d", "c"];

export function buildDeck(): string[] {
  const d: string[] = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  return d;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function holeCardCount(variant: Variant) {
  switch (variant) {
    case "omaha": return 4;
    case "five_one":
    case "five_two": return 5;
    case "pineapple": return 3;
    default: return 2;
  }
}

/** Total community cards for this variant (five_two has 2 boards). */
export function boardCardCount(variant: Variant) {
  return variant === "five_two" ? 10 : 5;
}

/** True when the variant requires a pre-flop discard step. */
export function requiresDiscard(variant: Variant) {
  return variant === "pineapple";
}

export function dealHoleCards(deck: string[], seatCount: number, variant: Variant): { hands: string[][]; rest: string[] } {
  const n = holeCardCount(variant);
  const hands: string[][] = Array.from({ length: seatCount }, () => []);
  let idx = 0;
  for (let card = 0; card < n; card++) {
    for (let s = 0; s < seatCount; s++) {
      hands[s].push(deck[idx++]);
    }
  }
  return { hands, rest: deck.slice(idx) };
}

/** Pop N cards off the top of the deck (mutating). */
export function draw(deck: string[], n: number): string[] {
  return deck.splice(0, n);
}

function combos<T>(arr: T[], k: number): T[][] {
  const res: T[][] = [];
  const n = arr.length;
  if (k > n || k <= 0) return k === 0 ? [[]] : res;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    res.push(idx.map((i) => arr[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return res;
}

/**
 * Evaluate the best 5-card hand a seat can make on the given board.
 *   holdem / pineapple: any 5 of hole+board (pokersolver default)
 *   omaha / five_one:  exactly 2 hole + 3 board (enumerate combos)
 *   five_two: caller passes ONE board at a time; evaluated as omaha-style
 */
export function evaluateBest(hole: string[], board: string[], variant: Variant): any {
  if (variant === "omaha" || variant === "five_one" || variant === "five_two") {
    let best: any = null;
    for (const h of combos(hole, 2)) {
      for (const b of combos(board, 3)) {
        const cand = Hand.solve([...h, ...b]);
        if (!best) { best = cand; continue; }
        const win = Hand.winners([best, cand]);
        if (win.length === 1 && win[0] === cand) best = cand;
      }
    }
    return best;
  }
  return Hand.solve([...hole, ...board]);
}

/** Returns indices (into the input array) of winning hands (may be > 1 for ties). */
export function pickWinners(evaluated: any[]): number[] {
  const winners = Hand.winners(evaluated) as any[];
  const idxs: number[] = [];
  for (const w of winners) {
    const i = evaluated.indexOf(w);
    if (i >= 0) idxs.push(i);
  }
  return idxs;
}

/**
 * Compute side pots.
 * @param contributions Map of seat_index -> chips committed this hand
 * @param foldedSeats Set of seat_index that folded (can't win, but their chips are in pot)
 * @returns Array of { amount, eligible_seats[] } from main pot outward.
 */
export function computeSidePots(
  contributions: Map<number, number>,
  foldedSeats: Set<number>,
): { amount: number; eligible: number[] }[] {
  const pots: { amount: number; eligible: number[] }[] = [];
  const remaining = new Map(contributions);
  while (true) {
    // Consider only seats still contributing > 0
    const positive = Array.from(remaining.entries()).filter(([, v]) => v > 0);
    if (positive.length === 0) break;
    const cap = Math.min(...positive.map(([, v]) => v));
    let amount = 0;
    for (const [seat, v] of remaining) {
      const take = Math.min(v, cap);
      amount += take;
      remaining.set(seat, v - take);
    }
    const eligible = positive
      .map(([s]) => s)
      .filter((s) => !foldedSeats.has(s));
    pots.push({ amount, eligible });
  }
  // Merge adjacent pots with identical eligible sets (aesthetic).
  const merged: typeof pots = [];
  for (const p of pots) {
    const last = merged[merged.length - 1];
    if (last && last.eligible.length === p.eligible.length &&
        last.eligible.every((e, i) => e === p.eligible[i])) {
      last.amount += p.amount;
    } else {
      merged.push({ ...p });
    }
  }
  return merged;
}

/** Distribute a pot amount among winning seats (chips are integers; give remainder to first winner). */
export function distributePot(amount: number, winners: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (winners.length === 0 || amount <= 0) return out;
  const share = Math.floor(amount / winners.length);
  const rem = amount - share * winners.length;
  winners.forEach((s, i) => out.set(s, share + (i < rem ? 1 : 0)));
  return out;
}

/** Find next active seat index clockwise, skipping folded/all-in/absent. */
export function nextActiveSeat(
  fromSeat: number,
  seats: { seat_index: number; folded: boolean; all_in: boolean }[],
  maxSeats: number,
): number | null {
  const bySeat = new Map(seats.map((s) => [s.seat_index, s]));
  for (let step = 1; step <= maxSeats; step++) {
    const idx = (fromSeat + step) % maxSeats;
    const s = bySeat.get(idx);
    if (s && !s.folded && !s.all_in) return idx;
  }
  return null;
}

/** Find next seated (playing) seat clockwise. */
export function nextSeatedSeat(
  fromSeat: number,
  seats: { seat_index: number }[],
  maxSeats: number,
): number | null {
  const set = new Set(seats.map((s) => s.seat_index));
  for (let step = 1; step <= maxSeats; step++) {
    const idx = (fromSeat + step) % maxSeats;
    if (set.has(idx)) return idx;
  }
  return null;
}
