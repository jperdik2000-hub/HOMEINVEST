// Texas Hold'em hand evaluator + Monte Carlo win probability.
// Card codes: rank + suit, e.g. "As", "Td", "2c". Suits: s h d c.

const RANKS = "23456789TJQKA";
const SUITS = "shdc";

function rv(c: string): number { return RANKS.indexOf(c[0]); }
function sv(c: string): number { return SUITS.indexOf(c[1]); }

// Rank category names
export type HandCat =
  | "High Card" | "Pair" | "Two Pair" | "Three of a Kind" | "Straight"
  | "Flush" | "Full House" | "Four of a Kind" | "Straight Flush" | "Royal Flush";

const RANK_NAME = ["Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Jack","Queen","King","Ace"];
const RANK_NAME_PL = ["Twos","Threes","Fours","Fives","Sixes","Sevens","Eights","Nines","Tens","Jacks","Queens","Kings","Aces"];

export interface HandEval {
  score: number;         // higher is better
  category: HandCat;
  label: string;         // e.g. "Pair of Kings"
}

// Evaluate exactly 5 cards → score
function eval5(cards: string[]): number {
  const ranks = cards.map(rv).sort((a, b) => b - a); // desc
  const suits = cards.map(sv);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // group by count desc, then rank desc
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  const isFlush = suits.every(s => s === suits[0]);

  // Detect straight (including wheel A-2-3-4-5)
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh = -1;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 12 && uniq[1] === 3 && uniq[2] === 2 && uniq[3] === 1 && uniq[4] === 0) straightHigh = 3; // 5-high
  }

  // Score packed with category at fixed high bits, then 5 rank nibbles (pad with 0).
  const pack = (cat: number, ks: number[]) => {
    const padded = [...ks, 0, 0, 0, 0, 0].slice(0, 5);
    let s = cat & 0xf;
    for (const k of padded) s = (s << 4) | (k & 0xf);
    return s;
  };

  if (isFlush && straightHigh >= 0) return pack(8, [straightHigh]);
  if (groups[0][1] === 4) return pack(7, [groups[0][0], groups[1][0]]);
  if (groups[0][1] === 3 && groups[1] && groups[1][1] >= 2) return pack(6, [groups[0][0], groups[1][0]]);
  if (isFlush) return pack(5, ranks);
  if (straightHigh >= 0) return pack(4, [straightHigh]);
  if (groups[0][1] === 3) return pack(3, [groups[0][0], ...ranks.filter(r => r !== groups[0][0])]);
  if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) {
    const hi = Math.max(groups[0][0], groups[1][0]);
    const lo = Math.min(groups[0][0], groups[1][0]);
    const kicker = ranks.find(r => r !== hi && r !== lo)!;
    return pack(2, [hi, lo, kicker]);
  }
  if (groups[0][1] === 2) return pack(1, [groups[0][0], ...ranks.filter(r => r !== groups[0][0])]);
  return pack(0, ranks);
}

// Enumerate best 5-of-N (N up to 7)
export function evaluateBest(cards: string[]): HandEval {
  if (cards.length < 5) {
    // partial (preflop or flop-incomplete not typical) — best possible from what we have
    return partialEval(cards);
  }
  let best = -1;
  const n = cards.length;
  const idx = [0,1,2,3,4];
  const combos: number[][] = [];
  // simple generator
  function gen(start: number, depth: number, acc: number[]) {
    if (acc.length === 5) { combos.push([...acc]); return; }
    for (let i = start; i < n; i++) { acc.push(i); gen(i+1, depth+1, acc); acc.pop(); }
  }
  void idx;
  gen(0, 0, []);
  let bestCards: string[] = [];
  for (const c of combos) {
    const five = c.map(i => cards[i]);
    const s = eval5(five);
    if (s > best) { best = s; bestCards = five; }
  }
  return describe(best, bestCards);
}

// Omaha-style: must use EXACTLY 2 hole and 3 board cards.
export function evaluateOmaha(hole: string[], board: string[]): HandEval {
  if (board.length < 3 || hole.length < 2) return partialEval(hole);
  let best = -1;
  let bestCards: string[] = [];
  for (let a = 0; a < hole.length; a++) {
    for (let b = a + 1; b < hole.length; b++) {
      // choose 3 of board
      for (let i = 0; i < board.length; i++) {
        for (let j = i + 1; j < board.length; j++) {
          for (let k = j + 1; k < board.length; k++) {
            const five = [hole[a], hole[b], board[i], board[j], board[k]];
            const s = eval5(five);
            if (s > best) { best = s; bestCards = five; }
          }
        }
      }
    }
  }
  return describe(best, bestCards);
}

export type EvalVariant = "holdem" | "omaha" | "five_one" | "five_two" | "pineapple";

// Evaluate best hand for a given variant.
// For five_two, board is expected to be a flat combined board; splitBoards is applied.
export function evaluateVariant(
  variant: EvalVariant,
  hole: string[],
  board: string[],
): HandEval {
  if (variant === "omaha" || variant === "five_one") return evaluateOmaha(hole, board);
  if (variant === "five_two") {
    const [b1, b2] = splitTwoBoards(board);
    const e1 = b1.length >= 3 ? evaluateOmaha(hole, b1) : partialEval(hole);
    const e2 = b2.length >= 3 ? evaluateOmaha(hole, b2) : partialEval(hole);
    return e1.score >= e2.score ? e1 : e2;
  }
  return evaluateBest([...hole, ...board]);
}

function splitTwoBoards(board: string[]): [string[], string[]] {
  const b1: string[] = [];
  const b2: string[] = [];
  if (board.length >= 3) b1.push(...board.slice(0, 3));
  if (board.length >= 6) b2.push(...board.slice(3, 6));
  if (board.length >= 7) b1.push(board[6]);
  if (board.length >= 8) b2.push(board[7]);
  if (board.length >= 9) b1.push(board[8]);
  if (board.length >= 10) b2.push(board[9]);
  return [b1, b2];
}

// Opponent hole card count per variant (before any discards).
export function opponentHoleCount(variant: EvalVariant): number {
  switch (variant) {
    case "omaha": return 4;
    case "five_one":
    case "five_two": return 5;
    case "pineapple": return 3;
    default: return 2;
  }
}

// Generic Monte Carlo win probability supporting all variants.
export function winProbabilityVariant(
  variant: EvalVariant,
  hole: string[],
  board: string[],
  opponents: number,
  iterations = 1500,
): { win: number; tie: number } {
  if (opponents < 1) return { win: 1, tie: 0 };
  const oppHoleCount = opponentHoleCount(variant);
  const totalBoard = variant === "five_two" ? 10 : 5;
  const known = new Set([...hole, ...board]);
  const deckBase = fullDeck().filter(c => !known.has(c));
  const boardNeeded = Math.max(0, totalBoard - board.length);

  let wins = 0, ties = 0;
  const rng = Math.random;
  for (let it = 0; it < iterations; it++) {
    const deck = deckBase.slice();
    shuffleInPlace(deck, rng);
    let take = 0;
    const b = board.concat(deck.slice(take, take + boardNeeded));
    take += boardNeeded;
    const myEval = evaluateVariant(variant, hole, b);
    let bestOpp = -1;
    for (let o = 0; o < opponents; o++) {
      const oh = deck.slice(take, take + oppHoleCount);
      take += oppHoleCount;
      const s = evaluateVariant(variant, oh, b).score;
      if (s > bestOpp) bestOpp = s;
    }
    if (myEval.score > bestOpp) wins++;
    else if (myEval.score === bestOpp) ties++;
  }
  return { win: wins / iterations, tie: ties / iterations };
}

function partialEval(cards: string[]): HandEval {
  // With <5 cards, describe based on multiplicity + high card
  const ranks = cards.map(rv).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (groups[0][1] === 2) {
    return { score: 0, category: "Pair", label: `Pair of ${RANK_NAME_PL[groups[0][0]]}` };
  }
  return { score: 0, category: "High Card", label: `High Card — ${RANK_NAME[ranks[0]]}` };
}

function describe(score: number, five: string[]): HandEval {
  const cat = (score >> 20) & 0xf;
  // cat now consistently at bits 20-23 since pack pads to 5 nibbles
  const ranks = five.map(rv).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  switch (cat) {
    case 8: {
      const hi = (score >> 16) & 0xf;
      if (hi === 12) return { score, category: "Royal Flush", label: "Royal Flush" };
      return { score, category: "Straight Flush", label: `Straight Flush — ${RANK_NAME[hi]} High` };
    }
    case 7: return { score, category: "Four of a Kind", label: `Four of a Kind — ${RANK_NAME_PL[groups[0][0]]}` };
    case 6: return { score, category: "Full House", label: `Full House — ${RANK_NAME_PL[groups[0][0]]} over ${RANK_NAME_PL[groups[1][0]]}` };
    case 5: return { score, category: "Flush", label: `Flush — ${RANK_NAME[ranks[0]]} High` };
    case 4: {
      const hi = (score >> 16) & 0xf;
      return { score, category: "Straight", label: `Straight — ${RANK_NAME[hi]} High` };
    }
    case 3: return { score, category: "Three of a Kind", label: `Three of a Kind — ${RANK_NAME_PL[groups[0][0]]}` };
    case 2: {
      const hi = Math.max(groups[0][0], groups[1][0]);
      const lo = Math.min(groups[0][0], groups[1][0]);
      return { score, category: "Two Pair", label: `Two Pair — ${RANK_NAME_PL[hi]} and ${RANK_NAME_PL[lo]}` };
    }
    case 1: return { score, category: "Pair", label: `Pair of ${RANK_NAME_PL[groups[0][0]]}` };
    default: return { score, category: "High Card", label: `High Card — ${RANK_NAME[ranks[0]]}` };
  }
}

function fullDeck(): string[] {
  const d: string[] = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  return d;
}

function shuffleInPlace<T>(a: T[], rng: () => number) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

// Monte Carlo win probability against `opponents` random hands.
// Returns {win, tie} as fractions.
export function winProbability(
  hole: string[],
  board: string[],
  opponents: number,
  iterations = 1500,
): { win: number; tie: number } {
  if (hole.length !== 2 || opponents < 1) return { win: 1, tie: 0 };
  const known = new Set([...hole, ...board]);
  const deckBase = fullDeck().filter(c => !known.has(c));
  const boardNeeded = Math.max(0, 5 - board.length);

  // Exact enumeration on river when 1 opponent (fast: C(45,2)=990)
  if (boardNeeded === 0 && opponents === 1) {
    let wins = 0, ties = 0, total = 0;
    for (let i = 0; i < deckBase.length; i++) {
      for (let j = i + 1; j < deckBase.length; j++) {
        const my = evaluateBest([...hole, ...board]).score;
        const opp = evaluateBest([deckBase[i], deckBase[j], ...board]).score;
        if (my > opp) wins++;
        else if (my === opp) ties++;
        total++;
      }
    }
    return { win: wins / total, tie: ties / total };
  }

  let wins = 0, ties = 0;
  const rng = Math.random;
  for (let it = 0; it < iterations; it++) {
    const deck = deckBase.slice();
    shuffleInPlace(deck, rng);
    const b = board.concat(deck.slice(0, boardNeeded));
    let take = boardNeeded;
    const myScore = evaluateBest([...hole, ...b]).score;
    let bestOpp = -1;
    for (let o = 0; o < opponents; o++) {
      const oh = [deck[take++], deck[take++]];
      const s = evaluateBest([...oh, ...b]).score;
      if (s > bestOpp) bestOpp = s;
    }
    if (myScore > bestOpp) wins++;
    else if (myScore === bestOpp) ties++;
  }
  return { win: wins / iterations, tie: ties / iterations };
}