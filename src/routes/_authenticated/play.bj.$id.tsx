import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CasinoShell } from "@/components/CasinoShell";
import { PlayingCard, FannedHand } from "@/components/PlayingCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, LogOut, Play, Zap, ZapOff } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  getBlackjackTable,
  sitBlackjack,
  leaveBlackjack,
  endBlackjackTable,
  placeBlackjackBet,
  placeBlackjack213,
  startBlackjackRound,
  blackjackAction,
  nextBlackjackRound,
  dealNextBlackjackCard,
  clearBlackjackBet,
} from "@/lib/blackjack.functions";
import { displayTotal, isBlackjack, canSplit } from "@/lib/blackjack-eval";
import { supabase } from "@/integrations/supabase/client";
import { topUpWallet } from "@/lib/poker-table.functions";

export const Route = createFileRoute("/_authenticated/play/bj/$id")({
  head: () => ({ meta: [{ title: "Blackjack — Poker Club" }] }),
  component: BlackjackTable,
});

const SEATS = 6;

// True semicircle: dealer at top center, players arced across the bottom half.
// Center (cx, cy) with radii (rx, ry) in percent of the felt container.
// Seat 0 = leftmost, seat SEATS-1 = rightmost.
const SEAT_POS: Array<{ top: string; left: string }> = (() => {
  const cx = 50, cy = 40, rx = 40, ry = 44;
  return Array.from({ length: SEATS }, (_, i) => {
    // t = π (left) → 0 (right)
    const t = Math.PI - (i * Math.PI) / (SEATS - 1);
    const left = cx + rx * Math.cos(t);
    const top = cy + ry * Math.sin(t);
    return { top: `${top.toFixed(2)}%`, left: `${left.toFixed(2)}%` };
  });
})();

function chipColor(amount: number) {
  if (amount >= 500) return "bg-purple-600";
  if (amount >= 100) return "bg-zinc-900";
  if (amount >= 25) return "bg-emerald-600";
  if (amount >= 5) return "bg-red-600";
  return "bg-slate-300";
}

const CHIP_DENOMS = [500, 100, 25, 10, 5, 1] as const;

/** Break `amount` into up to 4 visible stacks, biggest denom first. */
function breakIntoChips(amount: number): Array<{ denom: number; count: number }> {
  let rem = Math.max(0, Math.floor(amount));
  const out: Array<{ denom: number; count: number }> = [];
  for (const d of CHIP_DENOMS) {
    if (rem <= 0) break;
    const c = Math.floor(rem / d);
    if (c > 0) {
      out.push({ denom: d, count: c });
      rem -= c * d;
    }
    if (out.length >= 4) break;
  }
  return out;
}

function ChipStack({ amount }: { amount: number }) {
  const stacks = breakIntoChips(amount);
  if (stacks.length === 0) return null;
  return (
    <div className="flex items-end justify-center gap-0.5">
      {stacks.map((s, i) => {
        // Cap the visible chips per column so tall stacks don't overflow.
        const visible = Math.min(s.count, 5);
        return (
          <div key={`${s.denom}-${i}`} className="relative flex flex-col-reverse items-center">
            {Array.from({ length: visible }).map((_, j) => (
              <div
                key={j}
                className={`h-1.5 w-5 -mt-[3px] rounded-full border border-white/60 border-dashed shadow-sm ${chipColor(s.denom)}`}
              />
            ))}
            {s.count > 1 && (
              <div className="mt-0.5 text-[7px] font-black leading-none text-white/80">×{s.count}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BlackjackTable() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const getFn = useServerFn(getBlackjackTable);
  const sitFn = useServerFn(sitBlackjack);
  const leaveFn = useServerFn(leaveBlackjack);
  const endFn = useServerFn(endBlackjackTable);
  const betFn = useServerFn(placeBlackjackBet);
  const startFn = useServerFn(startBlackjackRound);
  const actFn = useServerFn(blackjackAction);
  const nextFn = useServerFn(nextBlackjackRound);
  const dealNextFn = useServerFn(dealNextBlackjackCard);
  const sideBet213Fn = useServerFn(placeBlackjack213);
  const topUpFn = useServerFn(topUpWallet);
  const clearBetFn = useServerFn(clearBlackjackBet);

  const state = useQuery({
    queryKey: ["bj", id],
    queryFn: () => getFn({ data: { table_id: id } }) as any,
    refetchInterval: 4000,
  });

  useEffect(() => {
    const ch = supabase.channel(`bj-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "blackjack_seats", filter: `table_id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ["bj", id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "blackjack_rounds", filter: `table_id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ["bj", id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "blackjack_round_seats", filter: `table_id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ["bj", id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "blackjack_tables", filter: `id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ["bj", id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["bj", id] });
  const mkMut = <T,>(fn: (v: T) => Promise<any>) =>
    useMutation({ mutationFn: fn, onSuccess: invalidate, onError: (e: any) => toast.error(e?.message ?? "Failed") });

  const sitMut = mkMut((seat_index: number) => sitFn({ data: { table_id: id, seat_index } }));
  const leaveMut = mkMut((seat_index?: number) =>
    leaveFn({ data: { table_id: id, ...(typeof seat_index === "number" ? { seat_index } : {}) } }),
  );
  const endMut = mkMut(() => endFn({ data: { table_id: id } }));
  const startMut = mkMut(() => startFn({ data: { table_id: id } }));
  const nextMut = mkMut(() => nextFn({ data: { table_id: id } }));
  const dealNextMut = mkMut(() => dealNextFn({ data: { table_id: id } }));
  const betMut = mkMut(({ bet, seat_index }: { bet: number; seat_index: number }) =>
    betFn({ data: { table_id: id, bet, seat_index } }),
  );
  const addBetMut = mkMut(({ bet, seat_index }: { bet: number; seat_index: number }) =>
    betFn({ data: { table_id: id, bet, mode: "add", seat_index } }),
  );
  const clearBetMut = mkMut((seat_index: number) =>
    clearBetFn({ data: { table_id: id, seat_index } }),
  );
  const actMut = mkMut(({ action, seat_index }: { action: string; seat_index?: number }) =>
    actFn({
      data: {
        table_id: id,
        action: action as any,
        ...(typeof seat_index === "number" ? { seat_index } : {}),
      },
    }),
  );
  const sideBet213Mut = mkMut((seat_index: number) =>
    sideBet213Fn({ data: { table_id: id, seat_index } }),
  );

  const [betInput, setBetInput] = useState("");
  const [show213Info, setShow213Info] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositInput, setDepositInput] = useState("");
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  // When a player holds two seats, this selects which one the betting UI
  // and side-bet buttons currently target.
  const [activeSeatIndex, setActiveSeatIndex] = useState<number | null>(null);

  // --- Reduced-motion preference (system + in-app toggle) ---
  const [reduceMotion, setReduceMotion] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem("bj-reduce-motion");
    if (stored === "1") return true;
    if (stored === "0") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("bj-reduce-motion", reduceMotion ? "1" : "0");
  }, [reduceMotion]);

  // --- Auto-deal cadence (host only) ---
  const dealTimerRef = useRef<number | null>(null);
  const dealMutateRef = useRef(dealNextMut.mutate);
  dealMutateRef.current = dealNextMut.mutate;
  const NEXT_ROUND_DELAY_SECONDS = 6;
  useEffect(() => {
    const sd = state.data as any;
    if (!sd || !sd.is_host) return;
    const r = sd.round;
    if (!r) return;
    const pending = (sd.round_seats ?? []).some((rs: any) => Number(rs.cards_pending ?? 0) > 0);
    const shouldAuto =
      r.status === "dealing" ||
      r.status === "dealer" ||
      (r.status === "player" && pending);
    if (!shouldAuto) return;
    // Faster during dealing, slower for player hits so the card lands visibly.
    const delayMs = r.status === "dealing" ? 450 : r.status === "dealer" ? 700 : 550;
    dealTimerRef.current = window.setTimeout(() => {
      dealMutateRef.current(undefined as any);
    }, delayMs);
    return () => {
      if (dealTimerRef.current !== null) {
        window.clearTimeout(dealTimerRef.current);
        dealTimerRef.current = null;
      }
    };
    // Re-run whenever the round advances or a new pending card appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    (state.data as any)?.is_host,
    (state.data as any)?.round?.id,
    (state.data as any)?.round?.status,
    (state.data as any)?.round?.dealer_cards?.length,
    JSON.stringify(((state.data as any)?.round_seats ?? []).map((rs: any) => [rs.id, rs.cards_pending, (rs.hands as any[])?.reduce((n, h) => n + (h.cards?.length ?? 0), 0)])),
  ]);

  // Dealer manually starts each round — no auto-advance countdown.

  const depositMut = useMutation({
    mutationFn: (amount: number) => topUpFn({ data: { amount } }),
    onSuccess: () => {
      toast.success("Deposit added to wallet");
      setShowDeposit(false);
      setDepositInput("");
      qc.invalidateQueries({ queryKey: ["bj", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Deposit failed"),
  });

  // Toast the player when their round seat settles, showing net win/loss.
  // Key by round_seat.id so it fires even if the host advances the round
  // before this client polls the intermediate "settled" state.
  const toastedSeatIds = useRef<Set<string>>(new Set());
  const toastPrimed = useRef(false);
  const toastedSide213 = useRef<Set<string>>(new Set());
  const toastSide213Primed = useRef(false);
  useEffect(() => {
    const sd = state.data as any;
    if (!sd) return;
    // On first successful load, prime the ref with any pre-existing settled
    // seat so we don't fire a stale toast for a round that finished before
    // the user opened the page.
    if (!toastPrimed.current) {
      toastPrimed.current = true;
      const initial = sd.my_last_settled_seat;
      if (initial?.id) toastedSeatIds.current.add(initial.id);
      return;
    }
    // Iterate over every one of my round-seats — a player may hold two.
    // Only toast when the round is fully settled so we don't misfire while
    // a seat is 'done' (natural BJ / bust / stand) but the dealer hasn't
    // resolved yet.
    const rs: any[] = sd.round_seats ?? [];
    const meId = sd.me_user_id;
    const roundSettled = sd.round?.status === "settled";
    const mine: any[] = [];
    for (const x of rs) {
      if (x.user_id === meId && x.status === "done" && roundSettled) mine.push(x);
    }
    if (mine.length === 0 && sd.my_last_settled_seat) mine.push(sd.my_last_settled_seat);
    for (const m of mine) {
      if (toastedSeatIds.current.has(m.id)) continue;
      toastedSeatIds.current.add(m.id);
      const hands: any[] = (m.hands as any[]) ?? [];
      const totalBet = hands.reduce((n, h) => n + Number(h.bet ?? 0), 0) + Number(m.insurance_bet ?? 0);
      const payout = Number(m.final_payout ?? 0);
      const net = payout - totalBet;
      const suffix = mine.length > 1 ? ` (seat ${SEATS - m.seat_index})` : "";
      if (net > 0) {
        toast.success(`🎉 You won ${net.toLocaleString()} chips!${suffix}`, { duration: 6000 });
      } else if (net === 0 && totalBet > 0) {
        toast(`Push — ${totalBet.toLocaleString()} chips returned${suffix}`, { duration: 5000 });
      } else if (net < 0) {
        toast.error(`You lost ${Math.abs(net).toLocaleString()} chips${suffix}`, { duration: 5000 });
      }
    }
  }, [state.data]);

  // Toast the player when their 21+3 side bet resolves.
  useEffect(() => {
    const sd = state.data as any;
    if (!sd) return;
    const rs: any[] = sd.round_seats ?? [];
    const meId = sd.me_user_id;
    const mineAll = rs.filter((x) => x.user_id === meId && x.side_bet_21_3_settled && Number(x.side_bet_21_3 ?? 0) > 0);
    if (mineAll.length === 0) return;
    if (!toastSide213Primed.current) {
      toastSide213Primed.current = true;
      for (const m of mineAll) toastedSide213.current.add(m.id);
      return;
    }
    const labels: Record<string, string> = {
      straight_flush: "Straight Flush (40:1)",
      three_kind: "Three of a Kind (30:1)",
      straight: "Straight (10:1)",
      flush: "Flush (5:1)",
    };
    for (const m of mineAll) {
      if (toastedSide213.current.has(m.id)) continue;
      toastedSide213.current.add(m.id);
      const payout = Number(m.side_bet_21_3_payout ?? 0);
      const stake = Number(m.side_bet_21_3 ?? 0);
      const net = payout - stake;
      const label = labels[m.side_bet_21_3_result as string];
      const suffix = mineAll.length > 1 ? ` (seat ${SEATS - m.seat_index})` : "";
      if (net > 0 && label) {
        toast.success(`21+3 ${label} — +${net} chips!${suffix}`, { duration: 6000 });
      } else if (net < 0) {
        toast(`21+3 side bet lost (${Math.abs(net)} chips)${suffix}`, { duration: 4000 });
      }
    }
  }, [state.data]);

  if (state.isLoading) return <CasinoShell compact><div className="p-6 text-muted-foreground">Loading table…</div></CasinoShell>;
  if (state.error) return <CasinoShell compact><div className="p-6 text-red-400">{(state.error as any)?.message ?? "Error"}</div></CasinoShell>;
  const s = state.data as any;
  if (!s) return null;

  const table = s.table;
  const isHost = s.is_host as boolean;
  const seats: any[] = s.seats;
  const round = s.round;
  const roundSeats: any[] = s.round_seats ?? [];
  const wallet = s.wallet_chips as number;

  const meId = s.me_user_id as string;
  const mySeats: any[] = seats.filter((seat) => seat.user_id === meId)
    .sort((a: any, b: any) => a.seat_index - b.seat_index);
  const myRoundSeats: any[] = round
    ? roundSeats.filter((r) => r.user_id === meId).sort((a: any, b: any) => a.seat_index - b.seat_index)
    : [];
  // Choose the "active" seat for the betting/side-bet UI.
  // - During a player's turn, the current_seat wins if it's ours.
  // - Otherwise honour the explicit picker; fall back to the first of
  //   our seats that hasn't placed a main bet, else the first seat.
  const currentTurnMine = round?.status === "player" && typeof round?.current_seat === "number"
    ? mySeats.find((seat: any) => seat.seat_index === round.current_seat)
    : null;
  const preferredActive: number | null = (() => {
    if (currentTurnMine) return currentTurnMine.seat_index;
    if (activeSeatIndex !== null && mySeats.some((seat: any) => seat.seat_index === activeSeatIndex)) return activeSeatIndex;
    const noBetSeat = mySeats.find((seat: any) => {
      const rs = myRoundSeats.find((r) => r.seat_index === seat.seat_index);
      return !rs || Number(rs.bet ?? 0) === 0;
    });
    return (noBetSeat ?? mySeats[0])?.seat_index ?? null;
  })();
  // Sync activeSeatIndex during render (safe: setState during render on the
  // same component is a supported React pattern for derived state). We can't
  // use useEffect here because it sits after conditional early returns above.
  if (preferredActive !== activeSeatIndex) setActiveSeatIndex(preferredActive);
  const mySeat = mySeats.find((seat: any) => seat.seat_index === preferredActive) ?? mySeats[0] ?? null;
  const myRoundSeat = mySeat
    ? myRoundSeats.find((r) => r.seat_index === mySeat.seat_index) ?? null
    : null;
  const dealerCards: string[] = (round?.dealer_cards ?? []) as string[];
  const dealerHidden = round?.dealer_hidden;

  const bettingPhase = round?.status === "betting" || !round;
  const settledPhase = round?.status === "settled";
  const tableEnded = table.status === "ended";
  const summary: Array<{ user_id: string; name: string; staked: number; payout: number; net: number }> =
    s.settlement_summary ?? [];

  const seatSlots = Array.from({ length: SEATS }, (_, i) => {
    const seated = seats.find((seat) => seat.seat_index === i);
    const rs = roundSeats.find((r) => r.seat_index === i);
    return { i, seated, rs };
  });

  // --- Next-card target indicator ---
  // During the initial deal, cards go seat-by-seat (rightmost first in this
  // layout — matches ActionBar's math) then dealer, twice. During a player's
  // turn any seat with cards_pending > 0 is the target. During the dealer
  // draw phase the dealer is always the target.
  let nextTargetSeat: number | null = null;
  let nextTargetDealer = false;
  if (round?.status === "dealing") {
    const N = roundSeats.length;
    const dealtSeats = roundSeats.reduce((n: number, r: any) => {
      const hs = (r.hands as any[]) ?? [];
      return n + (hs[0]?.cards?.length ?? 0);
    }, 0);
    const dealerDealt = (round?.dealer_cards?.length ?? 0);
    const dealt = dealtSeats + dealerDealt;
    const total = 2 * (N + 1);
    if (dealt < total) {
      const pos = dealt % (N + 1);
      if (pos < N) nextTargetSeat = roundSeats[N - 1 - pos]?.seat_index ?? null;
      else nextTargetDealer = true;
    }
  } else if (round?.status === "player") {
    const pendingSeat = roundSeats.find((r: any) => Number(r.cards_pending ?? 0) > 0);
    if (pendingSeat) nextTargetSeat = pendingSeat.seat_index ?? null;
  } else if (round?.status === "dealer") {
    nextTargetDealer = true;
  }

  // --- Round phase summary shown to everyone ---
  const phase: { label: string; tone: "amber" | "emerald" | "sky" | "zinc"; hint?: string } = (() => {
    if (!round || round.status === "betting") {
      const bets = roundSeats.length;
      const sat = seats.length;
      return {
        label: "Betting open",
        tone: "emerald",
        hint: sat === 0
          ? "Waiting for players to sit"
          : `${bets}/${sat} bet${bets === 1 ? "" : "s"} in — dealer will Deal Now`,
      };
    }
    if (round.status === "dealing") return { label: "Dealing", tone: "amber", hint: "Cards going out…" };
    if (round.status === "player") {
      const cur = roundSeats.find((r: any) => r.seat_index === round.current_seat);
      const seat = seats.find((s: any) => s.seat_index === round.current_seat);
      const who = cur?.user_id === meId
        ? "Your turn"
        : `${seat?.profile?.nickname || seat?.profile?.name || "Player"}'s turn`;
      return { label: who, tone: "sky" };
    }
    if (round.status === "dealer") return { label: "Dealer draws", tone: "amber", hint: "Resolving the hand…" };
    if (round.status === "settled") return { label: "Round settled", tone: "zinc", hint: "Waiting for dealer to deal next round" };
    return { label: String(round.status), tone: "zinc" };
  })();

  return (
    <CasinoShell compact>
      {/* Compact top bar */}
      <div className="flex items-center justify-between gap-2 border-b border-white/5 bg-black/60 px-3 py-2 backdrop-blur">
        <Link to="/play" className="flex items-center gap-1 text-xs text-zinc-300 hover:text-gold">
          <ArrowLeft className="h-4 w-4" /> Lobby
        </Link>
        <div className="text-center">
          <div className="font-display text-sm font-bold text-amber-200 leading-none">{table.name}</div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500">
            Dealer: {table.host_profile?.nickname || table.host_profile?.name || "Host"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReduceMotion((v) => !v)}
            aria-pressed={reduceMotion}
            aria-label={reduceMotion ? "Enable animations" : "Reduce motion"}
            title={reduceMotion ? "Animations off" : "Reduce motion"}
            className={`rounded-full border px-1.5 py-0.5 ${
              reduceMotion
                ? "border-zinc-500/40 bg-zinc-800/60 text-zinc-300"
                : "border-amber-400/40 bg-black/40 text-amber-200 hover:bg-amber-500/10"
            }`}
          >
            {reduceMotion ? <ZapOff className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setShowDeposit(true)}
            className="rounded-full border border-amber-400/40 bg-black/40 px-2 py-0.5 text-xs hover:bg-amber-500/10"
            aria-label="Deposit chips"
          >
            <span className="text-zinc-400">Bal </span>
            <span className="font-semibold text-amber-300">{wallet.toLocaleString()}</span>
            <span className="ml-1 text-emerald-300">+</span>
          </button>
          <button
            type="button"
            onClick={() => setShow213Info(true)}
            className="rounded-full border border-fuchsia-400/40 bg-black/40 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-fuchsia-200 hover:bg-fuchsia-500/10"
            aria-label="21+3 payouts"
          >
            21+3
          </button>
          {isHost ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-red-300 hover:text-red-200" onClick={() => endMut.mutate(undefined as any)}>
              End
            </Button>
          ) : mySeats.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              title={mySeats.length > 1 ? "Leave all my seats" : "Leave seat"}
              onClick={() => leaveMut.mutate(undefined as any)}
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* Felt table */}
      <div className={`relative flex-1 min-h-0 overflow-hidden bg-[#050a08] ${reduceMotion ? "reduce-motion" : ""}`}>
        {/* Round phase banner — visible to all players */}
        <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2">
          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-1 shadow-lg backdrop-blur ${
              phase.tone === "amber" ? "border-amber-400/60 bg-amber-500/15 text-amber-100" :
              phase.tone === "emerald" ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-100" :
              phase.tone === "sky" ? "border-sky-400/50 bg-sky-500/10 text-sky-100" :
              "border-zinc-500/40 bg-zinc-900/70 text-zinc-200"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                phase.tone === "amber" ? "bg-amber-300 animate-pulse" :
                phase.tone === "emerald" ? "bg-emerald-300" :
                phase.tone === "sky" ? "bg-sky-300 animate-pulse" :
                "bg-zinc-400"
              }`}
            />
            <span className="text-[10px] font-black uppercase tracking-[0.25em]">{phase.label}</span>
            {phase.hint && (
              <span className="text-[10px] font-medium tracking-wide text-white/70">· {phase.hint}</span>
            )}
          </div>
        </div>

        {showDeposit && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowDeposit(false)}
          >
            <div
              className="w-full max-w-xs rounded-2xl border border-emerald-400/40 bg-zinc-950 p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-300">Cashier</div>
                <div className="mt-1 font-display text-lg text-emerald-200">Deposit Chips</div>
                <div className="mt-1 text-[11px] text-zinc-500">Current balance: {wallet.toLocaleString()}</div>
              </div>
              <div className="mt-4 space-y-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  placeholder="Amount"
                  value={depositInput}
                  onChange={(e) => setDepositInput(e.target.value)}
                  className="text-center text-lg"
                  autoFocus
                />
                <div className="grid grid-cols-4 gap-1.5">
                  {[50, 100, 250, 500].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setDepositInput(String(v))}
                      className="rounded-md border border-white/10 bg-black/40 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-emerald-500/10"
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeposit(false)}
                  className="flex-1 rounded-lg border border-white/10 bg-black/40 py-2 text-sm font-semibold text-zinc-300 hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={depositMut.isPending || !Number(depositInput)}
                  onClick={() => {
                    const amt = Math.floor(Number(depositInput));
                    if (!Number.isFinite(amt) || amt <= 0) return;
                    depositMut.mutate(amt);
                  }}
                  className="flex-1 rounded-lg bg-emerald-500 py-2 text-sm font-black uppercase tracking-widest text-black hover:bg-emerald-400 disabled:opacity-50"
                >
                  {depositMut.isPending ? "…" : "Deposit"}
                </button>
              </div>
            </div>
          </div>
        )}
        {show213Info && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShow213Info(false)}
          >
            <div
              className="w-full max-w-xs rounded-2xl border border-fuchsia-400/40 bg-zinc-950 p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-fuchsia-300">21+3 Side Bet</div>
                <div className="mt-1 font-display text-lg text-fuchsia-200">Fixed 2 chips</div>
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                <div className="text-center text-[10px] text-zinc-400">
                  Your 2 cards + dealer's upcard
                </div>
                <div className="mt-2 divide-y divide-white/5 rounded-lg border border-white/10 bg-black/40">
                  {[
                    ["Straight Flush", "40 : 1"],
                    ["Three of a Kind", "30 : 1"],
                    ["Straight", "10 : 1"],
                    ["Flush", "5 : 1"],
                  ].map(([name, pay]) => (
                    <div key={name} className="flex items-center justify-between px-3 py-1.5">
                      <span className="text-zinc-200">{name}</span>
                      <span className="font-black text-emerald-300">{pay}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[10px] text-zinc-500 leading-snug">
                  Optional. Locks when cards are dealt. Independent of the main hand result. Wins return stake plus payout.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShow213Info(false)}
                className="mt-4 block w-full rounded-lg bg-fuchsia-500 py-2 text-center text-sm font-black uppercase tracking-widest text-black hover:bg-fuchsia-400"
              >
                Close
              </button>
            </div>
          </div>
        )}
        {tableEnded && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl border border-amber-400/40 bg-zinc-950 p-4 shadow-2xl">
              <div className="text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-300">Game Over</div>
                <div className="mt-1 font-display text-lg text-amber-200">Final Settlement</div>
              </div>
              <div className="mt-4 space-y-2">
                {summary.length === 0 && (
                  <div className="text-center text-xs text-zinc-500">No player hands were played.</div>
                )}
                {summary.map((r) => {
                  const wins = r.net > 0;
                  const push = r.net === 0;
                  return (
                    <div key={r.user_id} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/40 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{r.name}</div>
                        <div className="text-[10px] text-zinc-500">
                          Wagered {r.staked.toLocaleString()} · Returned {r.payout.toLocaleString()}
                        </div>
                      </div>
                      <div className="ml-3 text-right">
                        {push ? (
                          <div className="text-xs font-bold uppercase text-zinc-400">Even</div>
                        ) : wins ? (
                          <div className="text-xs font-bold text-emerald-400">
                            Dealer owes<br />
                            <span className="text-sm">+{r.net.toLocaleString()}</span>
                          </div>
                        ) : (
                          <div className="text-xs font-bold text-red-400">
                            Owes dealer<br />
                            <span className="text-sm">{Math.abs(r.net).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {summary.length > 0 && (() => {
                  const dealerNet = summary.reduce((n, r) => n - r.net, 0);
                  const dealerName = table.host_profile?.nickname || table.host_profile?.name || "Dealer";
                  return (
                    <div className="mt-3 flex items-center justify-between rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2">
                      <div className="text-sm font-semibold text-amber-200">{dealerName} (Dealer)</div>
                      <div className={`text-sm font-bold ${dealerNet > 0 ? "text-emerald-400" : dealerNet < 0 ? "text-red-400" : "text-zinc-300"}`}>
                        {dealerNet > 0 ? "+" : ""}{dealerNet.toLocaleString()}
                      </div>
                    </div>
                  );
                })()}
              </div>
              <Link to="/play" className="mt-4 block w-full rounded-lg bg-amber-500 py-2 text-center text-sm font-black uppercase tracking-widest text-black hover:bg-amber-400">
                Back to Lobby
              </Link>
            </div>
          </div>
        )}
        {/* Rim + felt */}
        <div className="absolute inset-x-2 top-2 bottom-2 rounded-t-[50%] rounded-b-[28px] border-[10px] border-zinc-900 shadow-[inset_0_0_60px_rgba(0,0,0,0.9),0_10px_40px_rgba(0,0,0,1)] bg-gradient-to-b from-emerald-800 via-emerald-900 to-emerald-950">
          {/* Faint felt texture */}
          <div
            className="absolute inset-0 rounded-[inherit] opacity-[0.12] mix-blend-overlay"
            style={{ backgroundImage: "radial-gradient(circle at 50% 40%, transparent 55%, black 100%)" }}
          />
          {/* Center brand */}
          <div className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 text-center opacity-25">
            <div className="font-display text-2xl tracking-tight text-amber-200">BLACKJACK</div>
            <div className="mx-auto mt-1 h-px w-32 bg-amber-200/40" />
            <div className="mt-1 text-[9px] font-bold tracking-[0.3em] text-amber-100/80">PAYS 3 TO 2</div>
            <div className="mt-0.5 text-[8px] tracking-[0.25em] text-amber-100/50">DEALER STANDS ON ALL 17</div>
          </div>

          {/* Shoe */}
          <div className="absolute left-[10%] top-[10%] h-10 w-14 rotate-[25deg] rounded-md bg-zinc-950 border-r-4 border-zinc-800 shadow-2xl" title="Shoe" />
          {/* Discard tray */}
          <div className="absolute right-[10%] top-[10%] h-8 w-14 -rotate-[20deg] rounded-md border border-zinc-700 bg-zinc-900/70 shadow-inner" title="Discard tray" />

          {/* Dealer station */}
          <div className="absolute left-1/2 top-3 -translate-x-1/2 flex flex-col items-center gap-2">
            {nextTargetDealer && (
              <div className="rounded-full border border-amber-400/70 bg-amber-500/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-100 animate-next-target">
                Next card
              </div>
            )}
            {/* Chip tray */}
            <div className="flex h-6 w-40 items-start gap-1 rounded-b-xl border border-zinc-800 bg-zinc-950 px-2 pt-1 shadow-xl">
              <div className="h-2.5 flex-1 rounded-sm bg-red-900/70" />
              <div className="h-2.5 flex-1 rounded-sm bg-blue-900/70" />
              <div className="h-2.5 flex-1 rounded-sm bg-zinc-700" />
              <div className="h-2.5 flex-1 rounded-sm bg-emerald-900/70" />
              <div className="h-2.5 flex-1 rounded-sm bg-purple-900/70" />
            </div>
            {/* Dealer cards — laid out side by side */}
            <div className="flex min-h-[72px] items-center justify-center gap-1.5">
              {dealerCards.length === 0 ? (
                <div className="text-[10px] uppercase tracking-widest text-amber-100/40">Waiting…</div>
              ) : (
                dealerCards.map((c, i) => (
                  <div key={`${i}-${c}`} className="animate-bj-deal" style={{ transformOrigin: "bottom center" }}>
                    <PlayingCard code={c} size="sm" faceDown={dealerHidden && i === 1} />
                  </div>
                ))
              )}
            </div>
            {dealerCards.length > 0 && !dealerHidden && (
              <div className="rounded-full border border-amber-400/40 bg-black/60 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                {displayTotal(dealerCards)}
              </div>
            )}
          </div>

          {/* Seats */}
          {seatSlots.map(({ i, seated, rs }) => {
            const isMe = seated && seated.user_id === meId;
            const isTurn = round?.current_seat === i && round?.status === "player";
            const isNextTarget = nextTargetSeat === i;
            const hands = rs?.hands as any[] | undefined;
            const pos = SEAT_POS[i];
            const nameLabel = seated
              ? (seated.profile?.nickname || seated.profile?.name || "Player")
              : null;

            // Status text
            let status: string | null = null;
            if (rs) {
              if (rs.status === "acting") status = "Playing";
              else if (rs.status === "stood") status = "Stand";
              else if (rs.status === "bust") status = "Bust";
              else if (rs.status === "blackjack") status = "Blackjack";
              else if (rs.status === "settled") status = null;
            } else if (seated && bettingPhase) status = "Waiting";

            return (
              <div
                key={i}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1"
                style={{ top: pos.top, left: pos.left }}
              >
                {/* Hand cards floating above — casino-style fanned hand */}
                {hands && hands.length > 0 && (
                  <div className="mb-1 flex items-end gap-2">
                    {hands.map((h: any, hi: number) => {
                      const activeHand = hi === (rs?.current_hand ?? 0) && rs?.status === "acting";
                      return (
                        <div key={hi} className={`relative flex flex-col items-center ${activeHand ? "" : "opacity-90"}`}>
                          <FannedHand cards={h.cards as string[]} size="sm" />
                          <div className="mt-0.5 rounded-full border border-white/10 bg-black/70 px-1.5 text-[9px] font-bold text-amber-200">
                            {displayTotal(h.cards)}
                            {isBlackjack(h.cards) && !h.from_split_ace && " BJ"}
                          </div>
                          {Number(h.bet ?? 0) > 0 && (
                            <div
                              className={`mt-0.5 rounded-sm px-1 text-[9px] font-black ${
                                h.doubled
                                  ? "bg-fuchsia-500 text-fuchsia-950"
                                  : "bg-amber-500 text-black"
                              }`}
                            >
                              {h.doubled ? "2x " : ""}
                              {Number(h.bet).toLocaleString()}
                            </div>
                          )}
                          {h.result && (
                            <div
                              className={`mt-0.5 rounded px-1 text-[9px] font-black uppercase ${
                                h.result === "win" || h.result === "blackjack"
                                  ? "bg-emerald-500 text-emerald-950"
                                  : h.result === "push"
                                  ? "bg-yellow-400 text-yellow-950"
                                  : "bg-red-500 text-red-950"
                              }`}
                            >
                              {h.result === "blackjack" ? "BJ 3:2" : h.result}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Betting circle */}
                <div
                  className={`relative flex h-14 w-14 items-center justify-center rounded-full border-2 transition-all ${
                    isNextTarget
                      ? "border-amber-300 bg-emerald-950/60 animate-next-target"
                      : isTurn
                      ? "border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.6)] animate-pulse"
                      : seated
                      ? "border-amber-400/40 bg-emerald-950/50"
                      : "border-dashed border-white/20 bg-black/20"
                  }`}
                >
                  {rs && Number(rs.bet) > 0 ? (
                    <ChipStack amount={Number(rs.bet)} />
                  ) : seated ? (
                    <span className="text-[9px] font-bold uppercase text-amber-100/50">Bet</span>
                  ) : (
                    <span className="text-[9px] font-bold uppercase text-white/40">Seat {SEATS - i}</span>
                  )}
                  {rs && Number(rs.bet) > 0 && (
                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-sm bg-amber-500 px-1 text-[9px] font-black text-black">
                      {Number(rs.bet).toLocaleString()}
                    </div>
                  )}
                </div>

                {seated && (
                  <SideBet213
                    rs={rs}
                    bettingPhase={bettingPhase}
                    canPlace={!!(isMe && bettingPhase && rs && Number(rs.side_bet_21_3 ?? 0) === 0 && wallet >= 2)}
                    onPlace={() => sideBet213Mut.mutate(i)}
                    pending={sideBet213Mut.isPending}
                  />
                )}

                {/* Name plate */}
                {seated ? (
                  <div
                    className={`mt-1 flex max-w-[110px] items-center gap-1 rounded-full border px-2 py-0.5 backdrop-blur ${
                      isMe
                        ? "border-amber-400/60 bg-amber-500/10"
                        : "border-white/10 bg-black/60"
                    }`}
                  >
                    <span className="truncate text-[10px] font-bold text-white">
                      {isMe ? "YOU" : nameLabel}
                    </span>
                    {seated && (
                      <span className="text-[9px] text-zinc-400">
                        · <span className="text-emerald-300">{status ?? ""}</span>
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mt-1 flex gap-1">
                    {!isHost && mySeats.length < 2 && (
                      <button
                        onClick={() => sitMut.mutate(i)}
                        className="rounded-full border border-amber-400/40 bg-black/60 px-2 py-0.5 text-[10px] font-bold text-amber-200 hover:bg-amber-500/10"
                      >
                        SIT
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="relative z-10 border-t border-white/10 bg-black/95 backdrop-blur-xl px-3 py-3">
        <ActionBar
          table={table}
          isHost={isHost}
          mySeat={mySeat}
          myRoundSeat={myRoundSeat}
          mySeats={mySeats}
          myRoundSeats={myRoundSeats}
          activeSeatIndex={preferredActive}
          setActiveSeatIndex={setActiveSeatIndex}
          round={round}
          roundSeats={roundSeats}
          wallet={wallet}
          bettingPhase={bettingPhase}
          settledPhase={settledPhase}
          seatsCount={seats.length}
          betInput={betInput}
          setBetInput={setBetInput}
          betMut={betMut}
          addBetMut={addBetMut}
          clearBetMut={clearBetMut}
          sideBet213Mut={sideBet213Mut}
          myLastBet={s.my_last_bet ?? null}
          nextCountdown={nextCountdown}
          onSkipNext={() => { setNextCountdown(null); nextMut.mutate(undefined as any); }}
          onOpenDeposit={() => setShowDeposit(true)}
          actMut={actMut}
          startMut={startMut}
          nextMut={nextMut}
          dealNextMut={dealNextMut}
        />
      </div>
    </CasinoShell>
  );
}

function ActionBar(props: any) {
  const {
    table, isHost, mySeat, myRoundSeat, round, roundSeats, wallet,
    bettingPhase, settledPhase, seatsCount,
    betInput, setBetInput, betMut, actMut, startMut, nextMut, dealNextMut,
    addBetMut, clearBetMut, sideBet213Mut, myLastBet, nextCountdown, onSkipNext, onOpenDeposit,
    mySeats, myRoundSeats, activeSeatIndex, setActiveSeatIndex,
  } = props;
  // Keep old `betInput` / `betMut` args for API parity but ignore in the new UI.
  void betInput; void setBetInput;
  const hasTwoSeats: boolean = (mySeats?.length ?? 0) > 1;
  const SeatPicker = hasTwoSeats && bettingPhase ? (
    <div className="flex items-center justify-center gap-1 pb-1">
      <span className="text-[9px] uppercase tracking-widest text-zinc-500">Betting on</span>
      {mySeats.map((s: any) => {
        const rs = myRoundSeats.find((r: any) => r.seat_index === s.seat_index);
        const bet = Number(rs?.bet ?? 0);
        const active = s.seat_index === activeSeatIndex;
        return (
          <button
            key={s.seat_index}
            type="button"
            onClick={() => setActiveSeatIndex(s.seat_index)}
            className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest transition ${
              active
                ? "border-amber-400 bg-amber-500/20 text-amber-100"
                : "border-white/10 bg-black/40 text-zinc-400 hover:bg-white/5"
            }`}
          >
            Seat {SEATS - s.seat_index}
            {bet > 0 ? ` · ${bet}` : ""}
          </button>
        );
      })}
    </div>
  ) : null;

  const dealingPhase = round?.status === "dealing";
  const dealerPhase = round?.status === "dealer";

  // Dealing phase: host manually deals one card at a time
  if (dealingPhase) {
    const N = roundSeats.length;
    const dealtSeats = roundSeats.reduce((n: number, s: any) => {
      const hs = (s.hands as any[]) ?? [];
      return n + (hs[0]?.cards?.length ?? 0);
    }, 0);
    const dealerDealt = (round?.dealer_cards?.length ?? 0);
    const dealt = dealtSeats + dealerDealt;
    const total = 2 * (N + 1);
    const pos = dealt % (N + 1);
    const nextLabel = dealt >= total
      ? "Finalizing…"
      : pos < N
        ? `Deal to seat ${SEATS - (roundSeats[N - 1 - pos]?.seat_index ?? 0)}`
        : "Deal to dealer";
    if (isHost) {
      return (
        <div className="flex flex-col gap-2">
          <div className="text-center text-[10px] font-bold uppercase tracking-widest text-amber-200/80">
            Auto-dealing… {dealt}/{total}
          </div>
          <Button
            className="w-full h-11 bg-amber-500 text-black hover:bg-amber-400 font-black tracking-widest"
            onClick={() => dealNextMut.mutate(undefined as any)}
            disabled={dealNextMut.isPending || dealt >= total}
          >
            <Play className="mr-2 h-4 w-4" /> DEAL NOW
          </Button>
        </div>
      );
    }
    return (
      <div className="text-center text-xs text-zinc-400">
        Dealer is dealing… ({dealt}/{total})
      </div>
    );
  }

  // Dealer's own draw phase — dealer clicks to hit themselves until standing.
  if (dealerPhase) {
    const dt = displayTotal((round?.dealer_cards ?? []) as string[]);
    const hidden = !!round?.dealer_hidden;
    if (isHost) {
      return (
        <div className="flex flex-col gap-2">
          <div className="text-center text-[10px] font-bold uppercase tracking-widest text-amber-200/80">
            {hidden ? "Reveal your hole card" : `Dealer's turn · ${dt}`}
          </div>
          <Button
            className="w-full h-11 bg-amber-500 text-black hover:bg-amber-400 font-black tracking-widest"
            onClick={() => dealNextMut.mutate(undefined as any)}
            disabled={dealNextMut.isPending}
          >
            <Play className="mr-2 h-4 w-4" /> {hidden ? "REVEAL DEALER" : "HIT DEALER"}
          </Button>
        </div>
      );
    }
    return (
      <div className="text-center text-xs text-zinc-400">
        {hidden ? "Waiting for dealer to reveal…" : `Dealer is drawing… (${dt})`}
      </div>
    );
  }

  // Insurance takes precedence
  if (round?.insurance_offered) {
    const pending = (myRoundSeats ?? []).find((r: any) => Number(r.insurance_bet) === 0);
    if (pending) {
      const label = hasTwoSeats ? ` (seat ${SEATS - pending.seat_index})` : "";
      return (
        <div className="flex flex-col gap-2">
          <div className="text-center text-xs font-bold uppercase tracking-widest text-yellow-200">
            Dealer shows Ace — Insurance?{label} ({Math.floor(Number(pending.bet) / 2)} chips)
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => actMut.mutate({ action: "insurance", seat_index: pending.seat_index })}
              className="bg-yellow-500 text-black hover:bg-yellow-400 font-black"
            >
              TAKE INSURANCE
            </Button>
            <Button
              variant="outline"
              onClick={() => actMut.mutate({ action: "decline_insurance", seat_index: pending.seat_index })}
            >
              NO THANKS
            </Button>
          </div>
        </div>
      );
    }
  }

  // Pending card during player phase — dealer must deliver requested card(s).
  const pendingSeat = round?.status === "player"
    ? roundSeats.find((rs: any) => Number(rs.cards_pending ?? 0) > 0)
    : null;
  if (pendingSeat) {
    const kindLabel: Record<string, string> = { hit: "HIT", double: "DOUBLE", split: "SPLIT" };
    const kind = kindLabel[pendingSeat.pending_kind as string] ?? "CARD";
    const seatNum = SEATS - pendingSeat.seat_index;
    if (isHost) {
      return (
        <div className="flex flex-col gap-2">
          <div className="text-center text-[10px] font-bold uppercase tracking-widest text-amber-200/80">
            Deal {kind} to seat {seatNum} · {pendingSeat.cards_pending} card{pendingSeat.cards_pending > 1 ? "s" : ""} to go
          </div>
          <Button
            className="w-full h-11 bg-amber-500 text-black hover:bg-amber-400 font-black tracking-widest"
            onClick={() => dealNextMut.mutate(undefined as any)}
            disabled={dealNextMut.isPending}
          >
            <Play className="mr-2 h-4 w-4" /> DEAL CARD
          </Button>
        </div>
      );
    }
    if (mySeat && pendingSeat.seat_index === mySeat.seat_index) {
      return (
        <div className="text-center text-xs text-amber-200/80">
          Waiting for dealer to deal your {kind.toLowerCase()}…
        </div>
      );
    }
    return (
      <div className="text-center text-xs text-zinc-400">
        Dealer is dealing to seat {seatNum}…
      </div>
    );
  }

  // Player's turn — driven by round.current_seat, which uniquely identifies
  // one of the player's seats.
  if (round?.status === "player" && !round.insurance_offered && typeof round.current_seat === "number") {
    const turnSeat = (myRoundSeats ?? []).find((r: any) => r.seat_index === round.current_seat);
    if (turnSeat && turnSeat.status === "acting") {
      const hands = turnSeat.hands as any[];
      const h = hands[turnSeat.current_hand];
      if (h) {
        const twoCards = h.cards.length === 2;
        const canDouble = twoCards && wallet >= h.bet;
        const canSplitNow = twoCards && canSplit(h.cards) && hands.length < 3 && wallet >= h.bet;
        const si = turnSeat.seat_index;
        const label = hasTwoSeats ? ` (seat ${SEATS - si})` : "";
        return (
          <div className="flex flex-col gap-2">
            <div className="text-center text-[10px] font-bold uppercase tracking-[0.3em] text-amber-300">
              Your turn{label} · {displayTotal(h.cards)}
            </div>
            <div className="grid grid-cols-4 gap-2">
              <ActionButton label="STAND" tone="slate" onClick={() => actMut.mutate({ action: "stand", seat_index: si })} />
              <ActionButton label="HIT" tone="emerald" onClick={() => actMut.mutate({ action: "hit", seat_index: si })} />
              <ActionButton label="DOUBLE" tone="amber" onClick={() => actMut.mutate({ action: "double", seat_index: si })} disabled={!canDouble} />
              <ActionButton label="SPLIT" tone="slate" onClick={() => actMut.mutate({ action: "split", seat_index: si })} disabled={!canSplitNow} />
            </div>
          </div>
        );
      }
    }
  }

  // Betting phase — chip builder + Rebet (players)
  if (bettingPhase && mySeat) {
    const max = Number(table.max_bet);
    const min = Number(table.min_bet);
    const currentBet = Number(myRoundSeat?.bet ?? 0);
    const currentSide = Number(myRoundSeat?.side_bet_21_3 ?? 0);
    const denoms = CHIP_DENOMS.slice().reverse().filter((d) => d <= max);
    const canAdd = (d: number) => currentBet + d <= max && wallet >= d && !addBetMut.isPending;
    const activeSi: number = mySeat.seat_index;

    // No pending bet yet — offer Rebet shortcuts when we have a prior bet.
    if (!hasTwoSeats && currentBet === 0 && myLastBet && myLastBet.main > 0) {
      const need1 = myLastBet.main + (myLastBet.side_21_3 || 0);
      const need2 = Math.min(myLastBet.main * 2, max) + (myLastBet.side_21_3 || 0);
      const canRebet1 = wallet >= need1 && myLastBet.main >= min && myLastBet.main <= max;
      const canRebet2 = wallet >= need2 && myLastBet.main * 2 >= min;
      const rebet = async (mult: 1 | 2) => {
        const main = Math.min(myLastBet.main * mult, max);
        await betMut.mutateAsync({ bet: main, seat_index: activeSi });
        if (myLastBet.side_21_3 > 0 && wallet - main >= 2) {
          sideBet213Mut.mutate(activeSi);
        }
      };
      return (
        <div className="flex flex-col gap-2">
          {SeatPicker}
          <div className="text-center text-[10px] uppercase tracking-[0.3em] text-zinc-500">
            Last bet: {myLastBet.main}
            {myLastBet.side_21_3 > 0 ? ` + ${myLastBet.side_21_3} on 21+3` : ""}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              disabled={!canRebet1 || betMut.isPending}
              onClick={() => rebet(1)}
              className="h-11 rounded-xl bg-amber-500 text-black font-black text-xs tracking-widest hover:bg-amber-400 disabled:opacity-40"
            >
              REBET {myLastBet.main}
            </button>
            <button
              disabled={!canRebet2 || betMut.isPending}
              onClick={() => rebet(2)}
              className="h-11 rounded-xl bg-fuchsia-500 text-black font-black text-xs tracking-widest hover:bg-fuchsia-400 disabled:opacity-40"
            >
              REBET ×2
            </button>
            <button
              onClick={() => addBetMut.mutate({ bet: Math.max(min, denoms[0] ?? min), seat_index: activeSi })}
              disabled={addBetMut.isPending || wallet < min}
              className="h-11 rounded-xl border border-white/10 bg-zinc-900 text-zinc-200 font-black text-xs tracking-widest hover:bg-zinc-800 disabled:opacity-40"
            >
              NEW BET
            </button>
          </div>
          {(!canRebet1 || !canRebet2) && wallet < Math.max(need1, need2) && (
            <button
              onClick={onOpenDeposit}
              className="text-[10px] font-bold uppercase tracking-widest text-emerald-300 hover:text-emerald-200"
            >
              + Deposit to rebet
            </button>
          )}
        </div>
      );
    }

    // Chip-builder — running total + tap chips to add + clear
    return (
      <div className="flex flex-col gap-2">
        {SeatPicker}
        <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-zinc-500">
          <span>
            {hasTwoSeats ? `Seat ${SEATS - activeSi} · ` : ""}Bet: <span className="text-amber-300 font-black">{currentBet.toLocaleString()}</span>
            {currentSide > 0 && <span className="text-fuchsia-300"> · 21+3: {currentSide}</span>}
          </span>
          <span>{min.toLocaleString()} – {max.toLocaleString()}</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 py-1">
          {denoms.map((v) => (
            <button
              key={v}
              disabled={!canAdd(v)}
              onClick={() => addBetMut.mutate({ bet: v, seat_index: activeSi })}
              className={`flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-white/70 text-white shadow-lg transition hover:scale-110 disabled:opacity-30 ${chipColor(v)}`}
              aria-label={`Add ${v}`}
            >
              <span className="text-xs font-black drop-shadow">
                {v >= 1000 ? `${v / 1000}K` : v}
              </span>
            </button>
          ))}
          {currentBet > 0 && (
            <button
              onClick={() => clearBetMut.mutate(activeSi)}
              disabled={clearBetMut.isPending}
              className="h-11 px-3 rounded-full border border-red-500/40 bg-red-950/40 text-[10px] font-black uppercase tracking-widest text-red-300 hover:bg-red-900/40 disabled:opacity-40"
            >
              CLEAR
            </button>
          )}
        </div>
        {currentBet > 0 && currentBet < min && (
          <div className="text-center text-[10px] font-bold uppercase tracking-widest text-red-300">
            Add {min - currentBet} more to meet minimum
          </div>
        )}
      </div>
    );
  }

  // Host controls
  if (isHost) {
    if (bettingPhase && roundSeats.length > 0) {
      return (
        <Button
          className="w-full h-11 bg-amber-500 text-black hover:bg-amber-400 font-black tracking-widest shadow-[0_0_24px_rgba(251,191,36,0.35)]"
          onClick={() => startMut.mutate(undefined as any)}
          disabled={startMut.isPending}
        >
          <Play className="mr-2 h-4 w-4" /> DEAL NOW · {roundSeats.length} bet{roundSeats.length === 1 ? "" : "s"}
        </Button>
      );
    }
    if (settledPhase) {
      return (
        <Button
          className="w-full h-11 bg-amber-500 text-black hover:bg-amber-400 font-black tracking-widest shadow-[0_0_24px_rgba(251,191,36,0.35)]"
          onClick={() => nextMut.mutate(undefined as any)}
          disabled={nextMut.isPending}
        >
          <Play className="mr-2 h-4 w-4" /> DEAL NOW · NEXT ROUND
        </Button>
      );
    }
    if (bettingPhase && seatsCount === 0) {
      return <div className="text-center text-xs text-zinc-500">Waiting for players to sit and bet.</div>;
    }
  }

  if (!isHost && !mySeat && bettingPhase) {
    return <div className="text-center text-xs text-zinc-500">Tap an empty seat to sit at this table.</div>;
  }

  if (!isHost && mySeat && !myRoundSeat && !bettingPhase) {
    return <div className="text-center text-xs text-zinc-500">Round in progress — you'll join the next hand.</div>;
  }

  return <div className="text-center text-xs text-zinc-500">Waiting for dealer…</div>;
}

function ActionButton({
  label, onClick, tone, disabled,
}: { label: string; onClick: () => void; tone: "emerald" | "amber" | "slate"; disabled?: boolean }) {
  const toneClass =
    tone === "emerald" ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.35)]" :
    tone === "amber" ? "bg-amber-500 hover:bg-amber-400 text-black" :
    "bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-12 rounded-xl font-black text-xs tracking-widest transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${toneClass}`}
    >
      {label}
    </button>
  );
}

const SIDE_BET_LABELS: Record<string, string> = {
  straight_flush: "SF",
  three_kind: "3K",
  straight: "STR",
  flush: "FL",
};

function SideBet213({
  rs, bettingPhase, canPlace, onPlace, pending,
}: {
  rs: any;
  bettingPhase: boolean;
  canPlace: boolean;
  onPlace: () => void;
  pending: boolean;
}) {
  const stake = Number(rs?.side_bet_21_3 ?? 0);
  const settled = !!rs?.side_bet_21_3_settled;
  const result = rs?.side_bet_21_3_result as string | undefined;
  const payout = Number(rs?.side_bet_21_3_payout ?? 0);
  const won = settled && payout > 0;

  if (bettingPhase && stake === 0) {
    return (
      <button
        type="button"
        disabled={!canPlace || pending}
        onClick={canPlace ? onPlace : undefined}
        className={`mt-1 flex h-9 w-9 flex-col items-center justify-center rounded-full border-2 text-[7px] font-black uppercase leading-none transition ${
          canPlace
            ? "border-dashed border-fuchsia-400/70 bg-black/40 text-fuchsia-200 hover:bg-fuchsia-500/10"
            : "border-dashed border-white/10 bg-black/20 text-white/30 cursor-not-allowed"
        }`}
        aria-label="Place 21+3 side bet — 2 chips"
        title="21+3 side bet — Bet 2"
      >
        <span>21+3</span>
        <span className="text-[7px] mt-0.5">Bet 2</span>
      </button>
    );
  }

  if (stake === 0) return null;

  return (
    <div
      className={`relative mt-1 flex h-9 w-9 flex-col items-center justify-center rounded-full border-2 ${
        won
          ? "border-emerald-400 bg-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
          : settled
          ? "border-red-500/60 bg-red-500/10 opacity-70"
          : "border-fuchsia-400/60 bg-fuchsia-950/50"
      }`}
      title={
        settled
          ? won
            ? `21+3 ${result?.replace("_", " ")} — +${payout - stake}`
            : "21+3 lost"
          : "21+3 side bet"
      }
    >
      <div className="flex h-6 w-6 items-center justify-center rounded-full border border-white/60 border-dashed bg-fuchsia-600 text-[9px] font-black text-white shadow">
        2
      </div>
      <span className="mt-0.5 text-[6px] font-black uppercase text-fuchsia-200 leading-none">21+3</span>
      {settled && result && result !== "lose" && (
        <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-sm bg-emerald-500 px-1 text-[8px] font-black text-emerald-950">
          {SIDE_BET_LABELS[result] ?? "WIN"}
        </div>
      )}
    </div>
  );
}
