import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  buildDeck, shuffle, dealHoleCards, draw, evaluateBest, pickWinners,
  computeSidePots, distributePot, nextActiveSeat, nextSeatedSeat, type Variant,
  boardCardCount, requiresDiscard,
} from "./poker-engine";

// =====================================================================
// Host peek — reveal all hole cards + upcoming community cards
// =====================================================================
export const hostPeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ hand_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin;
    const { data: hand } = await admin
      .from("poker_hands")
      .select("id,table_id,variant,street,board,side_pots")
      .eq("id", data.hand_id)
      .maybeSingle();
    if (!hand) throw new Error("Hand not found");
    const { data: table } = await admin
      .from("poker_tables").select("host_id").eq("id", hand.table_id).maybeSingle();
    if (!table || table.host_id !== context.userId) throw new Error("Host only");
    const { data: holes } = await admin
      .from("poker_hole_cards")
      .select("seat_index,cards")
      .eq("hand_id", hand.id);
    const deck = ((hand.side_pots as any)?._deck ?? []) as string[];
    const twoBoards = hand.variant === "five_two";
    const perStreet = twoBoards ? 2 : 1;
    const board = (hand.board ?? []) as string[];
    const dealtLen = board.length;
    const full = boardCardCount(hand.variant as Variant);
    // Simulate the remaining draws exactly like advanceStreet:
    // flop = 3 (x boards), turn/river = 1 each (x boards).
    let cursor = 0;
    const take = (n: number) => {
      const out = deck.slice(cursor, cursor + n);
      cursor += n;
      return out;
    };
    const upcoming: { label: string; cards: string[] }[] = [];
    // How much has already been dealt determines what's next.
    const flopSize = 3 * perStreet;
    if (dealtLen < flopSize) {
      upcoming.push({ label: twoBoards ? "Flop (Board 1)" : "Flop", cards: take(3) });
      if (twoBoards) upcoming.push({ label: "Flop (Board 2)", cards: take(3) });
    }
    if (dealtLen < flopSize + perStreet) {
      upcoming.push({ label: twoBoards ? "Turn (Board 1)" : "Turn", cards: take(1) });
      if (twoBoards) upcoming.push({ label: "Turn (Board 2)", cards: take(1) });
    }
    if (dealtLen < full) {
      upcoming.push({ label: twoBoards ? "River (Board 1)" : "River", cards: take(1) });
      if (twoBoards) upcoming.push({ label: "River (Board 2)", cards: take(1) });
    }
    return {
      holes: (holes ?? []).map((h: any) => ({ seat_index: h.seat_index, cards: h.cards as string[] })),
      upcoming,
    };
  });

type HandSeatRow = {
  hand_id: string; seat_index: number; user_id: string;
  starting_stack: number; stack: number;
  committed_hand: number; committed_street: number;
  folded: boolean; all_in: boolean; last_action: string | null; has_acted: boolean;
};

/** Load full hand state for engine work. */
async function loadHandState(admin: any, hand_id: string) {
  const [{ data: hand }, { data: seats }] = await Promise.all([
    admin.from("poker_hands").select("*").eq("id", hand_id).maybeSingle(),
    admin.from("poker_hand_seats").select("*").eq("hand_id", hand_id),
  ]);
  if (!hand) throw new Error("Hand not found");
  return { hand, seats: (seats ?? []) as HandSeatRow[] };
}

function toInt(x: any): number { return Math.round((Number(x) || 0) * 100) / 100; }

/** Seconds allowed per turn / per discard cycle. */
const TURN_SECONDS = 60;
function nextDeadline(): string {
  return new Date(Date.now() + TURN_SECONDS * 1000).toISOString();
}

/** How many seconds a player can burn from their bank in one press. */
const TIME_BANK_CHUNK_SECONDS = 15;

/** Split the concatenated board for 5-card 2-board variant. */
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

/**
 * Start a new hand at a table. Only the dealer for the next hand may call this.
 * If no prior hand exists, the host is the dealer for hand #1.
 */
const StartHandSchema = z.object({
  table_id: z.string().uuid(),
  variant: z.enum(["holdem", "omaha", "five_one", "five_two", "pineapple"]),
});

export const startHand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StartHandSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin;

    const { data: table, error: tErr } = await admin
      .from("poker_tables").select("*").eq("id", data.table_id).maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!table) throw new Error("Table not found");
    if (table.status === "ended") throw new Error("Table has ended");
    if ((table as any).paused) {
      return {
        ok: false,
        reason: "table_paused",
        message: "Table is paused by the host",
        variant: data.variant,
      };
    }

    // No active hand allowed. Multiple viewers may auto-deal at the same time
    // (bot driver / dealer-ready race); return a benign no-op instead of
    // throwing so the losing callers don't blow up the UI.
    const { data: active } = await admin
      .from("poker_hands").select("id").eq("table_id", data.table_id).eq("status", "active").maybeSingle();
    if (active) {
      return {
        ok: false,
        reason: "hand_in_progress",
        message: "A hand is already in progress",
        hand_id: active.id,
        variant: data.variant,
      };
    }

    // Seated, active seats with stack > 0
    const { data: seatRows } = await admin.from("poker_seats").select("*").eq("table_id", data.table_id).eq("status", "active");
    const playing = (seatRows ?? []).filter((s: any) => Number(s.stack) > 0).sort((a: any, b: any) => a.seat_index - b.seat_index);
    if (playing.length < 2) {
      return {
        ok: false,
        reason: "need_players",
        message: "Need at least 2 seated players with chips",
        hand_id: null,
        variant: data.variant,
      };
    }

    // Determine dealer: previous hand's dealer + 1 (rotates); else host's seat.
    const { data: prev } = await admin
      .from("poker_hands").select("hand_no, dealer_seat")
      .eq("table_id", data.table_id)
      .order("hand_no", { ascending: false }).limit(1).maybeSingle();
    let dealer_seat: number;
    if (prev) {
      const nxt = nextSeatedSeat(prev.dealer_seat, playing, table.max_seats);
      if (nxt === null) throw new Error("No seated players");
      dealer_seat = nxt;
    } else {
      const hostSeat = playing.find((s: any) => s.user_id === table.host_id);
      dealer_seat = hostSeat ? hostSeat.seat_index : playing[0].seat_index;
    }
    const dealerRow = playing.find((s: any) => s.seat_index === dealer_seat);
    if (!dealerRow) throw new Error("Dealer seat missing");
    if (dealerRow.user_id !== context.userId) {
      throw new Error("Only the dealer can start the next hand");
    }

    // Blinds
    const sb_seat = nextSeatedSeat(dealer_seat, playing, table.max_seats);
    const bb_seat = playing.length === 2
      ? nextSeatedSeat(sb_seat!, playing, table.max_seats) // heads-up: dealer is SB, other is BB
      : nextSeatedSeat(sb_seat!, playing, table.max_seats);
    if (sb_seat === null || bb_seat === null) throw new Error("Could not assign blinds");

    // Heads-up rule: dealer posts SB, other player BB. So swap:
    const headsUp = playing.length === 2;
    const trueSb = headsUp ? dealer_seat : sb_seat;
    const trueBb = headsUp ? sb_seat : bb_seat;
    const firstToActPreflop = headsUp ? dealer_seat : (nextSeatedSeat(trueBb, playing, table.max_seats) ?? trueSb);

    // Deal
    const seatOrder = playing.map((s: any) => s.seat_index);
    const deck = shuffle(buildDeck());
    const dealt = dealHoleCards(deck, seatOrder.length, data.variant);
    const holes: string[][] = dealt.hands;
    let rest: string[] = dealt.rest;
    // Reserve remaining deck for community cards; we'll draw as streets advance.

    // Compute contributions
    const sbAmount = Math.min(table.small_blind, Number(playing.find((s: any) => s.seat_index === trueSb)!.stack));
    const bbAmount = Math.min(table.big_blind, Number(playing.find((s: any) => s.seat_index === trueBb)!.stack));

    // Insert hand
    const nextHandNo = prev ? prev.hand_no + 1 : 1;
    const preDiscard = requiresDiscard(data.variant);
    const startStreet = preDiscard ? "discard" : "preflop";
    const startCurrent = preDiscard ? null : firstToActPreflop;
    const { data: hand, error: hErr } = await admin.from("poker_hands").insert({
      table_id: data.table_id,
      hand_no: nextHandNo,
      dealer_seat,
      current_seat: startCurrent,
      street: startStreet,
      board: [],
      pot: sbAmount + bbAmount,
      current_bet: bbAmount,
      min_raise: table.big_blind,
      variant: data.variant,
      status: "active",
      turn_deadline: nextDeadline(),
      discards: {},
    }).select().single();
    if (hErr) throw new Error(hErr.message);

    // Insert per-hand seat rows
    const hsRows = playing.map((s: any, i: number) => {
      const idx = seatOrder[i];
      const startStack = Number(s.stack);
      let commit = 0;
      if (idx === trueSb) commit = sbAmount;
      if (idx === trueBb) commit = bbAmount;
      const allIn = commit > 0 && commit >= startStack;
      return {
        hand_id: hand.id,
        seat_index: idx,
        user_id: s.user_id,
        starting_stack: startStack,
        stack: startStack - commit,
        committed_hand: commit,
        committed_street: commit,
        folded: false,
        all_in: allIn,
        last_action: commit > 0 ? (idx === trueSb ? "post_sb" : "post_bb") : null,
        has_acted: false,
      };
    });
    const { error: hsErr } = await admin.from("poker_hand_seats").insert(hsRows);
    if (hsErr) throw new Error(hsErr.message);

    // Insert hole cards
    const holeRows = playing.map((s: any, i: number) => ({
      hand_id: hand.id,
      seat_index: seatOrder[i],
      user_id: s.user_id,
      cards: holes[i],
      revealed: false,
      mucked: false,
    }));
    await admin.from("poker_hole_cards").insert(holeRows);

    // Update seat stacks (persistent chips subtract blinds)
    for (const r of hsRows) {
      await admin.from("poker_seats").update({ stack: r.stack }).eq("table_id", data.table_id).eq("seat_index", r.seat_index);
    }

    // Record actions
    let seq = 1;
    const actionRows: any[] = [
      { hand_id: hand.id, seq: seq++, seat_index: trueSb, action: "post_sb", amount: sbAmount, street: "preflop" },
      { hand_id: hand.id, seq: seq++, seat_index: trueBb, action: "post_bb", amount: bbAmount, street: "preflop" },
      { hand_id: hand.id, seq: seq++, seat_index: dealer_seat, action: "deal", amount: 0, street: "preflop" },
    ];
    await admin.from("poker_hand_actions").insert(actionRows);

    // Update table status
    if (table.status === "waiting") {
      await admin.from("poker_tables").update({ status: "active" }).eq("id", data.table_id);
    }

    // Store remaining deck? We reshuffle each street draw; simpler: store the leftover.
    // We keep it in-memory: not needed. We'll draw fresh from `rest` sequentially.
    // Persist rest in hand.side_pots? Better to store as a dedicated field.
    // Use side_pots jsonb temporarily to also hold `_deck` for engine use.
    await admin.from("poker_hands").update({ side_pots: { _deck: rest } as any }).eq("id", hand.id);

    return { ok: true, hand_id: hand.id, variant: data.variant };
  });

/**
 * Player action within an active hand.
 */
const ActionSchema = z.object({
  hand_id: z.string().uuid(),
  action: z.enum(["fold", "check", "call", "bet", "raise", "all_in"]),
  amount: z.number().finite().min(0).optional(),
});

export const playerAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ActionSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin;
    const { hand, seats } = await loadHandState(admin, data.hand_id);
    if (hand.status !== "active") throw new Error("Hand is not active");

    const { data: table } = await admin.from("poker_tables").select("*").eq("id", hand.table_id).maybeSingle();
    if (!table) throw new Error("Table missing");
    if ((table as any).paused) throw new Error("Table is paused by the host");

    const seat = seats.find((s) => s.seat_index === hand.current_seat);
    if (!seat) throw new Error("No current seat");
    if (seat.user_id !== context.userId) throw new Error("It's not your turn");
    if (seat.folded || seat.all_in) throw new Error("You cannot act");

    const toCall = Math.max(0, toInt(hand.current_bet) - toInt(seat.committed_street));
    let commitDelta = 0;
    let newAllIn: boolean = seat.all_in;
    let newFolded: boolean = seat.folded;
    let newCurrentBet = toInt(hand.current_bet);
    let newMinRaise = toInt(hand.min_raise);

    const stack = toInt(seat.stack);

    switch (data.action) {
      case "fold":
        newFolded = true;
        break;
      case "check":
        if (toCall !== 0) throw new Error("Cannot check; you must call or fold");
        break;
      case "call": {
        commitDelta = Math.min(toCall, stack);
        if (commitDelta === stack) newAllIn = true;
        break;
      }
      case "bet": {
        if (newCurrentBet !== 0) throw new Error("There is a bet; use raise");
        const amt = data.amount ?? 0;
        if (amt < table.big_blind && amt < stack) throw new Error(`Bet must be at least ${table.big_blind}`);
        commitDelta = Math.min(amt, stack);
        newCurrentBet = toInt(seat.committed_street) + commitDelta;
        newMinRaise = commitDelta;
        if (commitDelta === stack) newAllIn = true;
        // Everyone else has to act again
        break;
      }
      case "raise": {
        if (newCurrentBet === 0) throw new Error("Nothing to raise; use bet");
        const total = data.amount ?? 0; // total street commit after raise
        const raiseDelta = total - newCurrentBet;
        if (raiseDelta < newMinRaise && (total - toInt(seat.committed_street)) < stack) {
          throw new Error(`Raise must be at least ${newMinRaise} more`);
        }
        commitDelta = total - toInt(seat.committed_street);
        if (commitDelta > stack) commitDelta = stack;
        const newTotalStreet = toInt(seat.committed_street) + commitDelta;
        if (newTotalStreet > newCurrentBet) {
          newMinRaise = newTotalStreet - newCurrentBet;
          newCurrentBet = newTotalStreet;
        }
        if (commitDelta === stack) newAllIn = true;
        break;
      }
      case "all_in": {
        commitDelta = stack;
        const newTotalStreet = toInt(seat.committed_street) + commitDelta;
        if (newTotalStreet > newCurrentBet) {
          const delta = newTotalStreet - newCurrentBet;
          if (delta >= newMinRaise) newMinRaise = delta;
          newCurrentBet = newTotalStreet;
        }
        newAllIn = true;
        break;
      }
    }

    // Persist seat + action
    const newCommittedStreet = toInt(seat.committed_street) + commitDelta;
    const newCommittedHand = toInt(seat.committed_hand) + commitDelta;
    const newStack = stack - commitDelta;
    const actionLabel = data.action === "all_in" ? "all_in" : data.action;
    await admin.from("poker_hand_seats").update({
      stack: newStack,
      committed_street: newCommittedStreet,
      committed_hand: newCommittedHand,
      folded: newFolded,
      all_in: newAllIn,
      has_acted: true,
      last_action: actionLabel,
    }).eq("hand_id", hand.id).eq("seat_index", seat.seat_index);

    // Update persistent seat stack
    if (commitDelta > 0) {
      await admin.from("poker_seats").update({ stack: newStack }).eq("table_id", hand.table_id).eq("seat_index", seat.seat_index);
    }

    // Record action
    const { data: lastSeqRow } = await admin.from("poker_hand_actions")
      .select("seq").eq("hand_id", hand.id).order("seq", { ascending: false }).limit(1).maybeSingle();
    const nextSeq = (lastSeqRow?.seq ?? 0) + 1;
    await admin.from("poker_hand_actions").insert({
      hand_id: hand.id, seq: nextSeq, seat_index: seat.seat_index,
      action: actionLabel, amount: commitDelta, street: hand.street,
    });

    // If bet/raise/all-in raised the current bet, reset has_acted on others so they act again
    const bumpedBet = (data.action === "bet" || data.action === "raise" || (data.action === "all_in" && commitDelta > 0 && newCurrentBet > toInt(hand.current_bet)));
    if (bumpedBet) {
      await admin.from("poker_hand_seats").update({ has_acted: false })
        .eq("hand_id", hand.id).neq("seat_index", seat.seat_index);
    }

    // Reload seats
    const fresh = await loadHandState(admin, hand.id);
    const activeSeats = fresh.seats.filter((s) => !s.folded);
    const nonAllInActive = activeSeats.filter((s) => !s.all_in);

    // Hand ends if only 1 non-folded remains
    if (activeSeats.length <= 1) {
      await admin.from("poker_hands").update({ current_bet: newCurrentBet, min_raise: newMinRaise }).eq("id", hand.id);
      return finishHand(admin, hand.id);
    }

    // Round ends if all non-all-in players have acted AND matched the current_bet
    const roundClosed = nonAllInActive.every((s) => s.has_acted && toInt(s.committed_street) === newCurrentBet);

    if (roundClosed) {
      return advanceStreet(admin, hand.id, newCurrentBet, newMinRaise);
    }

    // Otherwise move current_seat to next actor
    const nxt = nextActiveSeat(seat.seat_index, fresh.seats, table.max_seats);
    if (nxt === null) {
      return advanceStreet(admin, hand.id, newCurrentBet, newMinRaise);
    }

    // Update pot / current_bet / current_seat
    const potTotal = fresh.seats.reduce((s, r) => s + toInt(r.committed_hand), 0);
    await admin.from("poker_hands").update({
      current_seat: nxt,
      current_bet: newCurrentBet,
      min_raise: newMinRaise,
      pot: potTotal,
      turn_deadline: nextDeadline(),
    }).eq("id", hand.id);

    return { ok: true, hand_id: hand.id };
  });

async function advanceStreet(admin: any, hand_id: string, currentBet: number, minRaise: number) {
  const { hand, seats } = await loadHandState(admin, hand_id);
  const table = (await admin.from("poker_tables").select("*").eq("id", hand.table_id).single()).data;
  const potTotal = seats.reduce((s: number, r: HandSeatRow) => s + toInt(r.committed_hand), 0);

  // Reset street commits + has_acted
  await admin.from("poker_hand_seats").update({
    committed_street: 0, has_acted: false,
  }).eq("hand_id", hand_id);

  // Draw board cards
  const deckState: string[] = ((hand.side_pots as any)?._deck ?? []) as string[];
  const newDeck = deckState.slice();
  const board = [...(hand.board as string[])];
  const twoBoards = hand.variant === "five_two";
  let nextStreet: string = hand.street;
  if (hand.street === "preflop") {
    board.push(...newDeck.splice(0, 3));
    if (twoBoards) board.push(...newDeck.splice(0, 3));
    nextStreet = "flop";
  } else if (hand.street === "flop") {
    board.push(...newDeck.splice(0, 1));
    if (twoBoards) board.push(...newDeck.splice(0, 1));
    nextStreet = "turn";
  } else if (hand.street === "turn") {
    board.push(...newDeck.splice(0, 1));
    if (twoBoards) board.push(...newDeck.splice(0, 1));
    nextStreet = "river";
  } else if (hand.street === "river") {
    // Go to showdown
    await admin.from("poker_hands").update({
      board, pot: potTotal, current_bet: 0, min_raise: table.big_blind,
      street: "showdown", side_pots: { _deck: newDeck },
    }).eq("id", hand_id);
    return finishHand(admin, hand_id);
  }

  // If only 1 non-folded player remains OR everyone else is all-in — deal all remaining board and go to showdown
  const fresh = await loadHandState(admin, hand_id);
  const nonFolded = fresh.seats.filter((s) => !s.folded);
  const canStillAct = nonFolded.filter((s) => !s.all_in);
  if (canStillAct.length <= 1) {
    // Deal remaining board
    const fullBoard = boardCardCount(hand.variant as Variant);
    const remaining = fullBoard - board.length;
    if (remaining > 0) board.push(...newDeck.splice(0, remaining));
    await admin.from("poker_hands").update({
      board, pot: potTotal, current_bet: 0, min_raise: table.big_blind,
      street: "showdown", side_pots: { _deck: newDeck },
    }).eq("id", hand_id);
    return finishHand(admin, hand_id);
  }

  // First to act post-flop = first non-folded, non-all-in seat left of dealer
  const first = nextActiveSeat(hand.dealer_seat, fresh.seats, table.max_seats);
  await admin.from("poker_hands").update({
    board, street: nextStreet, current_bet: 0, min_raise: table.big_blind,
    current_seat: first, pot: potTotal, side_pots: { _deck: newDeck },
    turn_deadline: nextDeadline(),
  }).eq("id", hand_id);

  // Record deal action
  const { data: lastSeqRow } = await admin.from("poker_hand_actions")
    .select("seq").eq("hand_id", hand_id).order("seq", { ascending: false }).limit(1).maybeSingle();
  await admin.from("poker_hand_actions").insert({
    hand_id, seq: (lastSeqRow?.seq ?? 0) + 1,
    seat_index: hand.dealer_seat, action: "deal", amount: 0, street: nextStreet,
  });

  return { ok: true, hand_id };
}

async function finishHand(admin: any, hand_id: string) {
  const { hand, seats } = await loadHandState(admin, hand_id);
  const table = (await admin.from("poker_tables").select("*").eq("id", hand.table_id).single()).data;

  const nonFolded = seats.filter((s) => !s.folded);
  const board = (hand.board as string[]);

  // Load hole cards for the non-folded seats
  const { data: holes } = await admin.from("poker_hole_cards")
    .select("seat_index,cards")
    .eq("hand_id", hand_id);
  const holeBySeat = new Map<number, string[]>((holes ?? []).map((h: any) => [h.seat_index, h.cards]));

  // Compute side pots based on committed_hand
  const contribs = new Map<number, number>();
  const folded = new Set<number>();
  for (const s of seats) {
    contribs.set(s.seat_index, toInt(s.committed_hand));
    if (s.folded) folded.add(s.seat_index);
  }
  const pots = computeSidePots(contribs, folded);

  const winners: any[] = [];
  const stackAdds = new Map<number, number>();

  if (nonFolded.length === 1) {
    const only = nonFolded[0];
    // Everyone else folded — take entire pot
    const total = seats.reduce((s, r) => s + toInt(r.committed_hand), 0);
    stackAdds.set(only.seat_index, total);
    winners.push({ seats: [only.seat_index], amount: total, hand_name: "uncontested" });
  } else if (hand.variant === "five_two") {
    // Split-pot per side pot: half to best-on-board1, half to best-on-board2
    const [b1, b2] = splitTwoBoards(board);
    const evalsB1 = nonFolded.map((s) => ({
      seat_index: s.seat_index,
      hand: evaluateBest(holeBySeat.get(s.seat_index) ?? [], b1, "five_two"),
    }));
    const evalsB2 = nonFolded.map((s) => ({
      seat_index: s.seat_index,
      hand: evaluateBest(holeBySeat.get(s.seat_index) ?? [], b2, "five_two"),
    }));
    for (const p of pots) {
      const eligible = p.eligible.filter((s) => nonFolded.some((n) => n.seat_index === s));
      if (eligible.length === 0) continue;
      const half1 = Math.floor(p.amount / 2);
      const half2 = p.amount - half1;
      for (const [side, amt, evals, label] of [
        [1, half1, evalsB1, "Board 1"],
        [2, half2, evalsB2, "Board 2"],
      ] as const) {
        const evalsForPot = evals.filter((e) => eligible.includes(e.seat_index));
        const winnerIdxs = pickWinners(evalsForPot.map((e) => e.hand));
        const winSeats = winnerIdxs.map((i) => evalsForPot[i].seat_index);
        const dist = distributePot(amt, winSeats);
        for (const [seatIdx, add] of dist) {
          stackAdds.set(seatIdx, (stackAdds.get(seatIdx) ?? 0) + add);
        }
        const firstHandName = evalsForPot[winnerIdxs[0]]?.hand?.name ?? "";
        winners.push({ seats: winSeats, amount: amt, hand_name: `${label} · ${firstHandName}` });
      }
    }
  } else {
    // Evaluate hands
    const evals = nonFolded.map((s) => {
      const h = holeBySeat.get(s.seat_index) ?? [];
      return { seat_index: s.seat_index, hand: evaluateBest(h, board, hand.variant as Variant) };
    });
    for (const p of pots) {
      const eligible = p.eligible.filter((s) => nonFolded.some((n) => n.seat_index === s));
      if (eligible.length === 0) continue;
      const evalsForPot = evals.filter((e) => eligible.includes(e.seat_index));
      const winnerIdxs = pickWinners(evalsForPot.map((e) => e.hand));
      const winSeats = winnerIdxs.map((i) => evalsForPot[i].seat_index);
      const dist = distributePot(p.amount, winSeats);
      for (const [seatIdx, amt] of dist) {
        stackAdds.set(seatIdx, (stackAdds.get(seatIdx) ?? 0) + amt);
      }
      const firstHandName = evalsForPot[winnerIdxs[0]]?.hand?.name ?? "";
      winners.push({ seats: winSeats, amount: p.amount, hand_name: firstHandName });
    }
  }

  // Credit persistent seat stacks + record win actions
  const { data: lastSeqRow } = await admin.from("poker_hand_actions")
    .select("seq").eq("hand_id", hand_id).order("seq", { ascending: false }).limit(1).maybeSingle();
  let seq = (lastSeqRow?.seq ?? 0) + 1;

  for (const [seatIdx, amount] of stackAdds) {
    // Update persistent stack from CURRENT seat state (already subtracted)
    const { data: seatRow } = await admin.from("poker_seats")
      .select("stack").eq("table_id", hand.table_id).eq("seat_index", seatIdx).maybeSingle();
    const cur = Number(seatRow?.stack ?? 0);
    await admin.from("poker_seats").update({ stack: cur + amount })
      .eq("table_id", hand.table_id).eq("seat_index", seatIdx);
    await admin.from("poker_hand_actions").insert({
      hand_id, seq: seq++, seat_index: seatIdx, action: "win", amount, street: "showdown",
    });
  }

  await admin.from("poker_hands").update({
    status: "ended", ended_at: new Date().toISOString(),
    street: "ended", current_seat: null, winners,
    // Strip the internal deck once done, keep side_pots empty
    side_pots: pots.map(({ amount, eligible }) => ({ amount, eligible })),
  }).eq("id", hand_id);

  // Auto-reveal hole cards for anyone still in at showdown (multi-way pots need reveal)
  if (nonFolded.length > 1) {
    await admin.from("poker_hole_cards").update({ revealed: true })
      .eq("hand_id", hand_id)
      .in("seat_index", nonFolded.map((s) => s.seat_index));
  }

  return { ok: true, hand_id, ended: true };
}

/** Reveal your own hole cards (voluntary show) after a hand ends. */
export const revealMyCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ hand_id: z.string().uuid(), reveal: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: hand } = await supabaseAdmin.from("poker_hands").select("status").eq("id", data.hand_id).maybeSingle();
    if (!hand) throw new Error("Hand not found");
    if (hand.status !== "ended") throw new Error("Hand is still active");
    // Folded players may not reveal their cards.
    const { data: mySeat } = await supabaseAdmin.from("poker_hand_seats")
      .select("folded").eq("hand_id", data.hand_id).eq("user_id", context.userId).maybeSingle();
    if (mySeat?.folded && data.reveal) throw new Error("Folded hands cannot be revealed");
    await supabaseAdmin.from("poker_hole_cards")
      .update({ revealed: data.reveal, mucked: !data.reveal })
      .eq("hand_id", data.hand_id).eq("user_id", context.userId);
    return { ok: true };
  });

/** Hand history for a table (last 50). */
export const getTableHandHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ table_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Verify viewer
    const { data: table } = await supabaseAdmin.from("poker_tables").select("host_id").eq("id", data.table_id).maybeSingle();
    if (!table) throw new Error("Table not found");
    const { data: invited } = await supabaseAdmin.from("poker_table_invitations")
      .select("id").eq("table_id", data.table_id).eq("invited_user_id", context.userId).maybeSingle();
    if (table.host_id !== context.userId && !invited) throw new Error("Not allowed");

    const { data: hands } = await supabaseAdmin
      .from("poker_hands")
      .select("id,hand_no,variant,dealer_seat,board,pot,winners,ended_at,status")
      .eq("table_id", data.table_id)
      .eq("status", "ended")
      .order("hand_no", { ascending: false })
      .limit(50);
    return hands ?? [];
  });

/** Determine which seat should call startHand next (used by UI to show the deal prompt). */
export const getNextDealer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ table_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin.from("poker_tables").select("*").eq("id", data.table_id).maybeSingle();
    if (!table) throw new Error("Table not found");
    const { data: seatRows } = await supabaseAdmin.from("poker_seats").select("*").eq("table_id", data.table_id).eq("status", "active");
    const playing = (seatRows ?? []).filter((s: any) => Number(s.stack) > 0).sort((a: any, b: any) => a.seat_index - b.seat_index);
    if (playing.length < 2) return { dealer_seat: null, dealer_user_id: null };
    const { data: prev } = await supabaseAdmin
      .from("poker_hands").select("hand_no,dealer_seat")
      .eq("table_id", data.table_id)
      .order("hand_no", { ascending: false }).limit(1).maybeSingle();
    let dealer_seat: number;
    if (prev) {
      dealer_seat = nextSeatedSeat(prev.dealer_seat, playing, table.max_seats) ?? playing[0].seat_index;
    } else {
      const hostSeat = playing.find((s: any) => s.user_id === table.host_id);
      dealer_seat = hostSeat ? hostSeat.seat_index : playing[0].seat_index;
    }
    const dealerRow = playing.find((s: any) => s.seat_index === dealer_seat);
    return {
      dealer_seat,
      dealer_user_id: dealerRow?.user_id ?? null,
    };
  });

// ================= Pineapple discard =================

/**
 * After all pineapple players have discarded (or been auto-discarded),
 * transition the hand from "discard" to "preflop" and set current_seat.
 */
async function tryFinishDiscard(admin: any, hand_id: string) {
  const { hand, seats } = await loadHandState(admin, hand_id);
  if (hand.street !== "discard") return;
  const { data: holes } = await admin
    .from("poker_hole_cards").select("seat_index,cards")
    .eq("hand_id", hand_id);
  const targetCount = 2; // pineapple: 3 → 2 after discard
  const stillPending = (holes ?? []).some(
    (h: any) => (h.cards as string[]).length > targetCount,
  );
  if (stillPending) return;

  const { data: table } = await admin
    .from("poker_tables").select("*").eq("id", hand.table_id).single();
  const playing = seats.slice().sort((a, b) => a.seat_index - b.seat_index);
  // Reconstruct first-to-act preflop from dealer position (same rules as startHand)
  const headsUp = playing.length === 2;
  const sb = nextSeatedSeat(hand.dealer_seat, playing, table.max_seats)!;
  const bb = nextSeatedSeat(sb, playing, table.max_seats)!;
  const trueBb = headsUp ? sb : bb;
  const firstToActPreflop = headsUp
    ? hand.dealer_seat
    : nextSeatedSeat(trueBb, playing, table.max_seats) ?? sb;
  await admin.from("poker_hands").update({
    street: "preflop",
    current_seat: firstToActPreflop,
    turn_deadline: nextDeadline(),
  }).eq("id", hand_id);
}

/** Discard one hole card during a pineapple hand's discard phase. */
export const discardCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    hand_id: z.string().uuid(),
    card: z.string().min(2).max(3),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin;
    const { data: hand } = await admin.from("poker_hands").select("*").eq("id", data.hand_id).maybeSingle();
    if (!hand) throw new Error("Hand not found");
    if (hand.status !== "active") throw new Error("Hand ended");
    if (hand.street !== "discard") throw new Error("Not the discard phase");
    const { data: hole } = await admin.from("poker_hole_cards")
      .select("*").eq("hand_id", data.hand_id).eq("user_id", context.userId).maybeSingle();
    if (!hole) throw new Error("You are not in this hand");
    const cards = (hole.cards as string[]).slice();
    if (cards.length <= 2) throw new Error("Already discarded");
    const idx = cards.indexOf(data.card);
    if (idx < 0) throw new Error("You don't hold that card");
    cards.splice(idx, 1);
    await admin.from("poker_hole_cards").update({ cards })
      .eq("hand_id", data.hand_id).eq("user_id", context.userId);

    // Record the discard for audit
    const discards = { ...((hand.discards as any) ?? {}), [String(hole.seat_index)]: data.card };
    await admin.from("poker_hands").update({ discards }).eq("id", hand.id);
    const { data: lastSeqRow } = await admin.from("poker_hand_actions")
      .select("seq").eq("hand_id", hand.id).order("seq", { ascending: false }).limit(1).maybeSingle();
    await admin.from("poker_hand_actions").insert({
      hand_id: hand.id, seq: (lastSeqRow?.seq ?? 0) + 1,
      seat_index: hole.seat_index, action: "discard", amount: 0, street: "discard",
    });

    await tryFinishDiscard(admin, hand.id);
    return { ok: true };
  });

// ================= Auto turn timer =================

/**
 * Any seated player (or the host) can call this after the deadline elapses.
 * If the hand is in "discard" phase, auto-discards the first hole card for
 * every pending seat. Otherwise auto-folds the current seat.
 */
export const autoAdvanceTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ hand_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin;
    const { data: hand } = await admin.from("poker_hands").select("*").eq("id", data.hand_id).maybeSingle();
    if (!hand) throw new Error("Hand not found");
    if (hand.status !== "active") return { ok: true, no_op: true };
    if (!hand.turn_deadline) return { ok: true, no_op: true };
    if (new Date(hand.turn_deadline).getTime() > Date.now()) return { ok: true, no_op: true };

    // Caller must be seated at this table (or host)
    const { data: table } = await admin.from("poker_tables").select("host_id").eq("id", hand.table_id).single();
    {
      const { data: t2 } = await admin.from("poker_tables").select("paused").eq("id", hand.table_id).maybeSingle();
      if ((t2 as any)?.paused) return { ok: true, no_op: true, paused: true };
    }
    const { data: mySeat } = await admin.from("poker_seats").select("id")
      .eq("table_id", hand.table_id).eq("user_id", context.userId).maybeSingle();
    if (!mySeat && table?.host_id !== context.userId) throw new Error("Not allowed");

    if (hand.street === "discard") {
      const { data: holes } = await admin.from("poker_hole_cards")
        .select("seat_index,cards").eq("hand_id", hand.id);
      const discards = { ...((hand.discards as any) ?? {}) };
      const { data: lastSeqRow } = await admin.from("poker_hand_actions")
        .select("seq").eq("hand_id", hand.id).order("seq", { ascending: false }).limit(1).maybeSingle();
      let seq = (lastSeqRow?.seq ?? 0) + 1;
      for (const h of holes ?? []) {
        const cards = (h.cards as string[]).slice();
        if (cards.length <= 2) continue;
        const dropped = cards.shift()!;
        await admin.from("poker_hole_cards").update({ cards })
          .eq("hand_id", hand.id).eq("seat_index", h.seat_index);
        discards[String(h.seat_index)] = dropped;
        await admin.from("poker_hand_actions").insert({
          hand_id: hand.id, seq: seq++, seat_index: h.seat_index,
          action: "discard", amount: 0, street: "discard",
        });
      }
      await admin.from("poker_hands").update({ discards }).eq("id", hand.id);
      await tryFinishDiscard(admin, hand.id);
      return { ok: true, auto: "discard" };
    }

    // Regular betting street: auto-fold current seat
    if (hand.current_seat === null || hand.current_seat === undefined) {
      return { ok: true, no_op: true };
    }
    const { seats } = await loadHandState(admin, hand.id);
    const seat = seats.find((s) => s.seat_index === hand.current_seat);
    if (!seat || seat.folded || seat.all_in) return { ok: true, no_op: true };
    await admin.from("poker_hand_seats").update({
      folded: true, has_acted: true, last_action: "timeout_fold",
    }).eq("hand_id", hand.id).eq("seat_index", seat.seat_index);
    const { data: lastSeqRow } = await admin.from("poker_hand_actions")
      .select("seq").eq("hand_id", hand.id).order("seq", { ascending: false }).limit(1).maybeSingle();
    await admin.from("poker_hand_actions").insert({
      hand_id: hand.id, seq: (lastSeqRow?.seq ?? 0) + 1,
      seat_index: seat.seat_index, action: "timeout_fold", amount: 0, street: hand.street,
    });

    // Recompute: end if only one left, else advance
    const { seats: fresh } = await loadHandState(admin, hand.id);
    const activeSeats = fresh.filter((s) => !s.folded);
    const nonAllInActive = activeSeats.filter((s) => !s.all_in);
    const { data: tableRow } = await admin.from("poker_tables").select("*").eq("id", hand.table_id).single();
    if (activeSeats.length <= 1) {
      return finishHand(admin, hand.id);
    }
    const currentBet = toInt(hand.current_bet);
    const minRaise = toInt(hand.min_raise);
    const roundClosed = nonAllInActive.every((s) => s.has_acted && toInt(s.committed_street) === currentBet);
    if (roundClosed) return advanceStreet(admin, hand.id, currentBet, minRaise);
    const nxt = nextActiveSeat(seat.seat_index, fresh, tableRow!.max_seats);
    if (nxt === null) return advanceStreet(admin, hand.id, currentBet, minRaise);
    await admin.from("poker_hands").update({
      current_seat: nxt,
      turn_deadline: nextDeadline(),
    }).eq("id", hand.id);
    return { ok: true, auto: "fold" };
  });

// ================= Time bank =================

/**
 * Burn a chunk of the caller's time bank to extend the current turn deadline.
 * Only allowed when it's the caller's turn (betting) or they still owe a discard,
 * and the hand is still active. Deducts from `poker_seats.time_bank_seconds`.
 */
export const useTimeBank = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ hand_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin;
    const chunk = TIME_BANK_CHUNK_SECONDS;

    const { data: hand } = await admin.from("poker_hands").select("*").eq("id", data.hand_id).maybeSingle();
    if (!hand) throw new Error("Hand not found");
    if (hand.status !== "active") throw new Error("Hand no longer active");
    if (!hand.turn_deadline) throw new Error("No active turn");

    const { data: mySeat } = await admin.from("poker_seats").select("*")
      .eq("table_id", hand.table_id).eq("user_id", context.userId).maybeSingle();
    if (!mySeat) throw new Error("Not seated");
    const bank = (mySeat as any).time_bank_seconds ?? 0;
    if (bank <= 0) throw new Error("Time bank is empty");

    // Validate it's the caller's action.
    if (hand.street === "discard") {
      const { data: hole } = await admin.from("poker_hole_cards")
        .select("cards").eq("hand_id", hand.id).eq("seat_index", mySeat.seat_index).maybeSingle();
      const cards = ((hole?.cards as string[]) ?? []);
      if (cards.length <= 2) throw new Error("Not your turn");
    } else {
      if (hand.current_seat !== mySeat.seat_index) throw new Error("Not your turn");
    }

    const spend = Math.min(chunk, bank);
    const currentDeadline = new Date(hand.turn_deadline).getTime();
    const base = Math.max(Date.now(), currentDeadline);
    const newDeadline = new Date(base + spend * 1000).toISOString();

    await admin.from("poker_hands").update({ turn_deadline: newDeadline }).eq("id", hand.id);
    await admin.from("poker_seats")
      .update({ time_bank_seconds: bank - spend } as any)
      .eq("id", mySeat.id);

    return { ok: true, added_seconds: spend, remaining_bank: bank - spend };
  });

