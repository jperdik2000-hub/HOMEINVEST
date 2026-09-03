import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { CasinoShell } from "@/components/CasinoShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { joinSeat, leaveSeat, endPokerTable, getMyWallet, setTablePaused } from "@/lib/poker-table.functions";
import {
  startHand, playerAction, revealMyCards, getTableHandHistory, getNextDealer,
  discardCard, autoAdvanceTurn, useTimeBank,
  hostPeek,
} from "@/lib/poker-game.functions";
import {
  requestRebuy, approveRebuy, denyRebuy, hostAddRebuy, listRebuyRequests, getTableSettlement,
} from "@/lib/poker-rebuy.functions";
import { Coins, LogOut, Flag, Circle, History, Eye, EyeOff, Trophy, Plus, Minus, Pause, Play, ArrowLeft, MoreVertical } from "lucide-react";
import { formatDisplayName } from "@/lib/poker";
import { PlayingCard } from "@/components/PlayingCard";
import { HandOdds } from "@/components/HandOdds";
import { TableChat } from "@/components/TableChat";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

// Tiny haptic tap for touchscreens. No-op where unavailable.
function tap(ms = 8) {
  try { (navigator as any).vibrate?.(ms); } catch {}
}

// Small gold poker-chip badge with amount.
function ChipBadge({ amount, size = "md" }: { amount: number; size?: "sm" | "md" | "lg" }) {
  const s =
    size === "lg" ? "px-3 py-1 text-sm"
    : size === "sm" ? "px-1.5 py-0 text-[10px]"
    : "px-2 py-0.5 text-[11px]";
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-bold text-black shadow-lg whitespace-nowrap",
        "bg-gradient-to-b from-amber-300 via-amber-400 to-amber-600 border-2 border-amber-100 ring-1 ring-black/30",
        s,
      )}
    >
      <span className="inline-block h-2 w-2 rounded-full bg-red-600 ring-1 ring-white/70" />
      {amount.toLocaleString()}
    </div>
  );
}

type SweepItem = {
  id: string;
  fromX: number; fromY: number;
  toX: number; toY: number;
  amount: number;
};
function ChipSweep({ item, onDone }: { item: SweepItem; onDone: (id: string) => void }) {
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setMoving(true), 20);
    const t2 = setTimeout(() => onDone(item.id), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const x = moving ? item.toX : item.fromX;
  const y = moving ? item.toY : item.fromY;
  return (
    <div
      className="chip-floater"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        opacity: moving ? 0 : 1,
        scale: moving ? "0.55" : "1",
      }}
    >
      <ChipBadge amount={item.amount} />
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/play/$id")({
  head: () => ({ meta: [{ title: "Table — Poker Club" }] }),
  component: PlayTable,
});

type SeatRow = { id: string; seat_index: number; user_id: string; stack: number; status: string; is_bot?: boolean; bot_name?: string | null };
type TableRow = { id: string; name: string; host_id: string; small_blind: number; big_blind: number; buy_in: number; max_seats: number; status: string; game_mode: string };
type HandRow = {
  id: string; hand_no: number; dealer_seat: number; current_seat: number | null;
  street: string; board: string[]; pot: number; current_bet: number; min_raise: number;
  variant: "holdem" | "omaha" | "five_one" | "five_two" | "pineapple";
  status: string; winners: any;
  turn_deadline: string | null;
  discards: Record<string, string> | null;
};

type Variant = HandRow["variant"];
const VARIANT_LABEL: Record<Variant, string> = {
  holdem: "Hold'em",
  omaha: "Omaha",
  five_one: "5-Card 1 Board",
  five_two: "5-Card 2 Boards",
  pineapple: "Pineapple",
};
function variantHoleCount(v: Variant, postDiscard = false) {
  if (v === "omaha") return 4;
  if (v === "five_one" || v === "five_two") return 5;
  if (v === "pineapple") return postDiscard ? 2 : 3;
  return 2;
}
function splitBoards(board: string[]): [string[], string[]] {
  const b1: string[] = [], b2: string[] = [];
  if (board.length >= 3) b1.push(...board.slice(0, 3));
  if (board.length >= 6) b2.push(...board.slice(3, 6));
  if (board.length >= 7) b1.push(board[6]);
  if (board.length >= 8) b2.push(board[7]);
  if (board.length >= 9) b1.push(board[8]);
  if (board.length >= 10) b2.push(board[9]);
  return [b1, b2];
}

function BoardDisplay({ hand }: { hand: { variant: Variant; board: string[] } }) {
  if (hand.variant === "five_two") {
    const [b1, b2] = splitBoards(hand.board);
    return (
      <div className="mt-1 flex flex-col gap-1 items-center">
        {[b1, b2].map((row, r) => (
          <div key={r} className="flex justify-center items-center gap-1">
            {[0, 1, 2, 3, 4].map((i) => {
              const c = row[i];
              return c
                ? (
                    <div
                      key={c}
                      className="animate-deal"
                      style={{
                        "--dy": "-80px",
                        "--dx": "0px",
                        "--deal-delay": `${i < 3 ? i * 130 : 0}ms`,
                      } as any}
                    >
                      <PlayingCard code={c} size="xs" />
                    </div>
                  )
                : <div key={i} className="w-8 h-11 rounded-md border border-dashed border-white/20" />;
            })}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="mt-1 flex justify-center items-center gap-0.5 sm:gap-1">
      {[0, 1, 2, 3, 4].map((i) => {
        const c = hand.board[i];
        return c
          ? (
              <div
                key={c}
                className="animate-deal"
                style={{
                  "--dy": "-90px",
                  "--dx": "0px",
                  "--deal-delay": `${i < 3 ? i * 140 : 0}ms`,
                } as any}
              >
                <PlayingCard code={c} size="sm" />
              </div>
            )
          : <div key={i} className="w-10 h-14 rounded-md border border-dashed border-white/20" />;
      })}
    </div>
  );
}
type HandSeat = {
  hand_id: string; seat_index: number; user_id: string;
  stack: number; committed_hand: number; committed_street: number;
  folded: boolean; all_in: boolean; last_action: string | null; has_acted: boolean;
};
type HoleCardRow = { hand_id: string; seat_index: number; user_id: string; cards: string[]; revealed: boolean; mucked: boolean };

function PlayTable() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [meId, setMeId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null)); }, []);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  // Consider "mobile" any short viewport (phone in either orientation).
  const isMobile = viewport.w > 0 && Math.min(viewport.w, viewport.h) < 500;
  const isPortrait = viewport.w > 0 && viewport.h > viewport.w;

  const table = useQuery({
    queryKey: ["poker-table", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("poker_tables").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as TableRow | null;
    },
  });

  const seats = useQuery({
    queryKey: ["poker-seats", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("poker_seats").select("*").eq("table_id", id).order("seat_index");
      if (error) throw error;
      return (data ?? []) as SeatRow[];
    },
  });

  const profiles = useQuery({
    queryKey: ["poker-seat-profiles", id, seats.data?.map((s) => s.user_id).join(",")],
    enabled: !!seats.data?.length,
    queryFn: async () => {
      const ids = Array.from(new Set((seats.data ?? []).map((s) => s.user_id)));
      if (!ids.length) return [];
      const { data } = await supabase.from("profiles").select("id,name,nickname,avatar_url").in("id", ids);
      return data ?? [];
    },
  });

  // Latest active hand (if any)
  const activeHand = useQuery({
    queryKey: ["poker-active-hand", id],
    queryFn: async () => {
      const { data } = await supabase.from("poker_hands").select("*")
        .eq("table_id", id)
        .order("hand_no", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as HandRow | null;
    },
  });

  const handSeats = useQuery({
    queryKey: ["poker-hand-seats", activeHand.data?.id],
    enabled: !!activeHand.data?.id,
    queryFn: async () => {
      const { data } = await supabase.from("poker_hand_seats").select("*").eq("hand_id", activeHand.data!.id);
      return (data ?? []) as HandSeat[];
    },
  });

  const holeCards = useQuery({
    queryKey: ["poker-hole-cards", activeHand.data?.id],
    enabled: !!activeHand.data?.id,
    queryFn: async () => {
      const { data } = await supabase.from("poker_hole_cards").select("*").eq("hand_id", activeHand.data!.id);
      return (data ?? []) as HoleCardRow[];
    },
  });

  const nextDealerFn = useServerFn(getNextDealer);
  const nextDealer = useQuery({
    queryKey: ["poker-next-dealer", id, activeHand.data?.status ?? "none"],
    enabled: !!table.data && (activeHand.data?.status !== "active"),
    queryFn: () => nextDealerFn({ data: { table_id: id } }),
  });

  const hostPeekFn = useServerFn(hostPeek);
  const isHostForPeek = !!table.data && table.data.host_id === meId;
  const hostPeekQ = useQuery({
    queryKey: ["poker-host-peek", activeHand.data?.id, activeHand.data?.street, (activeHand.data?.board ?? []).length],
    enabled: isHostForPeek && !!activeHand.data?.id && activeHand.data.status === "active",
    queryFn: () => hostPeekFn({ data: { hand_id: activeHand.data!.id } }),
    staleTime: 5_000,
  });
  const [peekSeats, setPeekSeats] = useState<Set<number>>(new Set());
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [pendingSeat, setPendingSeat] = useState<number | null>(null);
  useEffect(() => { setPeekSeats(new Set()); setShowUpcoming(false); }, [activeHand.data?.id]);

  const walletFn = useServerFn(getMyWallet);
  const wallet = useQuery({ queryKey: ["poker-wallet"], queryFn: () => walletFn() });

  const joinFn = useServerFn(joinSeat);
  const leaveFn = useServerFn(leaveSeat);
  const endFn = useServerFn(endPokerTable);
  const startFn = useServerFn(startHand);
  const actFn = useServerFn(playerAction);
  const revealFn = useServerFn(revealMyCards);
  const historyFn = useServerFn(getTableHandHistory);

  const joinMut = useMutation({
    mutationFn: (seat_index: number) => joinFn({ data: { table_id: id, seat_index } }) as Promise<unknown>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["poker-seats", id] });
      qc.invalidateQueries({ queryKey: ["poker-wallet"] });
      qc.invalidateQueries({ queryKey: ["poker-next-dealer", id] });
      setPendingSeat(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Cannot join"),
  });
  const leaveMut = useMutation({
    mutationFn: () => leaveFn({ data: { table_id: id } }) as Promise<{ returned: number }>,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["poker-seats", id] });
      qc.invalidateQueries({ queryKey: ["poker-wallet"] });
      qc.invalidateQueries({ queryKey: ["poker-next-dealer", id] });
      toast.success(`Left the table. ${res.returned.toLocaleString()} chips returned.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Cannot leave"),
  });
  const endMut = useMutation({
    mutationFn: () => endFn({ data: { table_id: id } }) as Promise<unknown>,
    onSuccess: () => {
      toast.success("Table ended — see the settlement below.");
      qc.invalidateQueries({ queryKey: ["poker-table", id] });
      qc.invalidateQueries({ queryKey: ["poker-settlement", id] });
      qc.invalidateQueries({ queryKey: ["poker-seats", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Cannot end"),
  });

  const pauseFn = useServerFn(setTablePaused);
  const pauseMut = useMutation({
    mutationFn: (paused: boolean) => pauseFn({ data: { table_id: id, paused } }) as Promise<{ paused: boolean }>,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["poker-table", id] });
      qc.invalidateQueries({ queryKey: ["poker-hand", id] });
      toast.success(r.paused ? "Table paused" : "Table resumed");
    },
    onError: (e: any) => toast.error(e?.message ?? "Cannot toggle pause"),
  });

  // Rebuys
  const requestRebuyFn = useServerFn(requestRebuy);
  const approveRebuyFn = useServerFn(approveRebuy);
  const denyRebuyFn = useServerFn(denyRebuy);
  const hostAddRebuyFn = useServerFn(hostAddRebuy);
  const listRebuysFn = useServerFn(listRebuyRequests);
  const settlementFn = useServerFn(getTableSettlement);

  const rebuys = useQuery({
    queryKey: ["poker-rebuys", id],
    queryFn: () => listRebuysFn({ data: { table_id: id } }) as Promise<any[]>,
    refetchInterval: 5000,
  });
  const settlementQ = useQuery({
    queryKey: ["poker-settlement", id],
    enabled: table.data?.status === "ended",
    queryFn: () => settlementFn({ data: { table_id: id } }) as Promise<{ status: string | null; settlement: any }>,
  });

  const requestRebuyMut = useMutation({
    mutationFn: (amount: number) =>
      requestRebuyFn({ data: { table_id: id, amount } }) as Promise<{ auto_approved: boolean }>,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["poker-rebuys", id] });
      qc.invalidateQueries({ queryKey: ["poker-seats", id] });
      toast.success(r.auto_approved ? "Rebuy added." : "Rebuy request sent — waiting for host approval.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Rebuy failed"),
  });
  const approveRebuyMut = useMutation({
    mutationFn: (request_id: string) => approveRebuyFn({ data: { request_id } }) as Promise<unknown>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["poker-rebuys", id] });
      qc.invalidateQueries({ queryKey: ["poker-seats", id] });
      toast.success("Rebuy approved.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Approve failed"),
  });
  const denyRebuyMut = useMutation({
    mutationFn: (request_id: string) => denyRebuyFn({ data: { request_id } }) as Promise<unknown>,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["poker-rebuys", id] }); toast.success("Denied."); },
    onError: (e: any) => toast.error(e?.message ?? "Deny failed"),
  });
  const hostAddRebuyMut = useMutation({
    mutationFn: (v: { seat_index: number; amount: number }) =>
      hostAddRebuyFn({ data: { table_id: id, seat_index: v.seat_index, amount: v.amount } }) as Promise<unknown>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["poker-rebuys", id] });
      qc.invalidateQueries({ queryKey: ["poker-seats", id] });
      toast.success("Rebuy added.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Rebuy failed"),
  });
  const startMut = useMutation({
    mutationFn: async (v: Variant) => {
      const fundedSeats = (seats.data ?? []).filter((s) => s.status === "active" && Number(s.stack) > 0).length;
      if (fundedSeats < 2) throw new Error("Need at least 2 seated players with chips — add a bot or wait for another player.");
      const res = await startFn({ data: { table_id: id, variant: v } }) as any;
      // Benign race: another client already started the hand → treat as success.
      if (res?.ok === false && res?.reason !== "hand_in_progress") {
        throw new Error(res.message ?? "Cannot deal");
      }
      return res;
    },
    onError: (e: any) => toast.error(e?.message ?? "Cannot deal"),
    onSuccess: (r: any, v) => {
      if (r?.reason !== "hand_in_progress") {
        toast.success(`Dealing ${VARIANT_LABEL[v]}…`);
      }
      qc.invalidateQueries({ queryKey: ["poker-active-hand", id] });
      qc.invalidateQueries({ queryKey: ["poker-seats", id] });
      qc.invalidateQueries({ queryKey: ["poker-next-dealer", id] });
    },
  });
  const discardFn = useServerFn(discardCard);
  const autoAdvFn = useServerFn(autoAdvanceTurn);
  const timeBankFn = useServerFn(useTimeBank);
  const timeBankMut = useMutation({
    mutationFn: () => timeBankFn({ data: { hand_id: activeHand.data!.id } }) as Promise<{ ok: boolean; added_seconds: number; remaining_bank: number }>,
    onSuccess: (r) => {
      tap(10);
      toast.success(`+${r.added_seconds}s — bank: ${r.remaining_bank}s`);
      qc.invalidateQueries({ queryKey: ["poker-active-hand", id] });
      qc.invalidateQueries({ queryKey: ["poker-seats", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Time bank failed"),
  });
  const discardMut = useMutation({
    mutationFn: (card: string) =>
      discardFn({ data: { hand_id: activeHand.data!.id, card } }) as Promise<unknown>,
    onError: (e: any) => toast.error(e?.message ?? "Discard failed"),
  });
  const actMut = useMutation({
    mutationFn: (v: { action: string; amount?: number }) =>
      actFn({ data: { hand_id: activeHand.data!.id, action: v.action as any, amount: v.amount } }) as Promise<unknown>,
    onError: (e: any) => toast.error(e?.message ?? "Action failed"),
  });
  const revealMut = useMutation({
    mutationFn: (reveal: boolean) =>
      revealFn({ data: { hand_id: activeHand.data!.id, reveal } }) as Promise<unknown>,
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const activePlayingHand = activeHand.data && activeHand.data.status === "active" ? activeHand.data : null;
  const hookSeats = seats.data ?? [];
  const hookHoleCards = holeCards.data ?? [];
  const mySeatForHooks = hookSeats.find((s) => s.user_id === meId && s.status !== "left");
  const isHostForHooks = table.data?.host_id === meId;
  const currentSeatRowForHooks = activePlayingHand?.current_seat != null
    ? hookSeats.find((s) => s.seat_index === activePlayingHand.current_seat)
    : null;

  // Turn timer: any seated client triggers auto-advance shortly after the deadline.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!activePlayingHand) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [activePlayingHand?.id]);
  const deadlineMs = activePlayingHand?.turn_deadline ? new Date(activePlayingHand.turn_deadline).getTime() : 0;
  const secondsLeft = activePlayingHand && deadlineMs ? Math.max(0, Math.ceil((deadlineMs - now) / 1000)) : null;
  useEffect(() => {
    if (!activePlayingHand || !mySeatForHooks) return;
    if (!deadlineMs) return;
    if ((table.data as any)?.paused) return;
    // Fire a second past the deadline; jitter by seat index to avoid all clients hitting at once.
    const jitter = (mySeatForHooks.seat_index % 5) * 250;
    const wait = Math.max(0, deadlineMs - Date.now()) + 1200 + jitter;
    const t = setTimeout(() => {
      autoAdvFn({ data: { hand_id: activePlayingHand.id } }).catch(() => {});
    }, wait);
    return () => clearTimeout(t);
  }, [activePlayingHand?.id, activePlayingHand?.turn_deadline, activePlayingHand?.current_seat, activePlayingHand?.street, mySeatForHooks?.seat_index, (table.data as any)?.paused]);


  // Realtime subscriptions
  useEffect(() => {
    const ch = supabase
      .channel(`poker-table-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_seats", filter: `table_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["poker-seats", id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_tables", filter: `id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["poker-table", id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_hands", filter: `table_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["poker-active-hand", id] });
        qc.invalidateQueries({ queryKey: ["poker-next-dealer", id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  useEffect(() => {
    if (!activeHand.data?.id) return;
    const hid = activeHand.data.id;
    const ch = supabase
      .channel(`poker-hand-${hid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_hand_seats", filter: `hand_id=eq.${hid}` }, () => {
        qc.invalidateQueries({ queryKey: ["poker-hand-seats", hid] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_hole_cards", filter: `hand_id=eq.${hid}` }, () => {
        qc.invalidateQueries({ queryKey: ["poker-hole-cards", hid] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeHand.data?.id, qc]);

  const tableMaxSeatsForLayout = table.data?.max_seats ?? 8;
  const seatPos = (i: number) => {
    const angle = (i / tableMaxSeatsForLayout) * 2 * Math.PI - Math.PI / 2;
    const rx = isMobile ? 38 : 46;
    const ry = isMobile ? 46 : 40;
    return { x: 50 + rx * Math.cos(angle), y: 50 + ry * Math.sin(angle), angle };
  };
  const hand = activePlayingHand;
  const lastHand = activeHand.data && activeHand.data.status === "ended" ? activeHand.data : null;
  const hs = handSeats.data ?? [];
  const hcs = holeCards.data ?? [];

  // ----- Live chip / pot / showdown animation state -----
  const [sweeps, setSweeps] = useState<SweepItem[]>([]);
  const removeSweep = (sweepId: string) =>
    setSweeps((prev) => prev.filter((s) => s.id !== sweepId));
  const spawn = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    amount: number,
  ) => {
    if (amount <= 0) return;
    const sweepId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setSweeps((prev) => [...prev, { id: sweepId, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, amount }]);
  };

  // Sweep committed chips into the pot when the street advances.
  const prevStreetRef = useRef<string>("");
  const prevHsRef = useRef<HandSeat[]>([]);
  const prevHandIdRef = useRef<string>("");
  useEffect(() => {
    if (!hand) {
      prevStreetRef.current = "";
      prevHsRef.current = [];
      prevHandIdRef.current = "";
      return;
    }
    if (
      prevHandIdRef.current === hand.id &&
      prevStreetRef.current &&
      prevStreetRef.current !== hand.street
    ) {
      for (const s of prevHsRef.current) {
        if (s.committed_street > 0) {
          const pos = seatPos(s.seat_index);
          spawn({ x: pos.x, y: pos.y }, { x: 50, y: 50 }, Number(s.committed_street));
        }
      }
    }
    prevStreetRef.current = hand.street;
    prevHsRef.current = hs;
    prevHandIdRef.current = hand.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand?.id, hand?.street, hs, tableMaxSeatsForLayout, isMobile]);

  // Sweep the pot to the winner(s) when the hand ends.
  const prevHandStatusRef = useRef<string>("");
  useEffect(() => {
    const status = activeHand.data?.status ?? "";
    if (
      prevHandStatusRef.current === "active" &&
      status === "ended" &&
      activeHand.data
    ) {
      const winners = (activeHand.data.winners ?? []) as {
        seats: number[]; amount: number;
      }[];
      // Short delay so board / hole reveals settle first.
      setTimeout(() => {
        for (const w of winners) {
          const share = w.seats.length ? Math.floor(Number(w.amount) / w.seats.length) : 0;
          for (const seat of w.seats) {
            const pos = seatPos(seat);
            spawn({ x: 50, y: 50 }, { x: pos.x, y: pos.y }, share);
          }
        }
      }, 250);
    }
    prevHandStatusRef.current = status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHand.data?.status, activeHand.data?.id, tableMaxSeatsForLayout, isMobile]);

  if (table.isLoading) return <CasinoShell><div className="text-sm text-muted-foreground">Loading table…</div></CasinoShell>;
  if (!table.data) return (
    <CasinoShell>
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-2xl font-bold">Table not found</h1>
        <Button className="mt-4" onClick={() => navigate({ to: "/play" })}>Back to lobby</Button>
      </div>
    </CasinoShell>
  );

  if (table.data.status === "ended") {
    return (
      <CasinoShell>
        <SettlementView
          tableName={table.data.name}
          currency="chips"
          settlement={settlementQ.data?.settlement}
          loading={settlementQ.isLoading}
          profiles={profiles.data ?? []}
          onBack={() => navigate({ to: "/play" })}
        />
      </CasinoShell>
    );
  }

  const t = table.data;
  const seatMap = new Map<number, SeatRow>();
  for (const s of seats.data ?? []) if (s.status !== "left") seatMap.set(s.seat_index, s);
  const mySeat = mySeatForHooks;
  const isHost = t.host_id === meId;
  const seatIndexes = Array.from({ length: t.max_seats }, (_, i) => i);

  const myHandSeat = hand ? hs.find((s) => s.user_id === meId) : null;
  const isMyTurn = !!hand && !!myHandSeat && hand.current_seat === myHandSeat.seat_index;
  const myHoleCards = hcs.find((h) => h.user_id === meId);
  const inDiscard = !!hand && hand.street === "discard";
  const myMustDiscard = !!hand && inDiscard && !!myHoleCards && myHoleCards.cards.length > 2;

  const fundedSeatCount = (seats.data ?? []).filter((s) => s.status === "active" && Number(s.stack) > 0).length;
  const hasEnoughPlayers = fundedSeatCount >= 2;
  const tablePaused = !!(t as any).paused;
  const myTurnActive = (isMyTurn || myMustDiscard) && !tablePaused;

  // Loud client-side alert when it becomes MY turn: beep + vibrate + tab title.
  const prevMyTurnRef = useRef(false);
  useEffect(() => {
    const wasMine = prevMyTurnRef.current;
    prevMyTurnRef.current = myTurnActive;
    if (myTurnActive && !wasMine) {
      try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AC) {
          const ctx = new AC();
          const beep = (freq: number, when: number, dur = 0.14) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = "sine";
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.0001, ctx.currentTime + when);
            g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + when + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
            o.connect(g); g.connect(ctx.destination);
            o.start(ctx.currentTime + when);
            o.stop(ctx.currentTime + when + dur + 0.02);
          };
          beep(880, 0);
          beep(1320, 0.16);
          setTimeout(() => ctx.close().catch(() => {}), 700);
        }
      } catch { /* ignore audio failures */ }
      try { navigator.vibrate?.([80, 60, 80]); } catch { /* noop */ }
    }
  }, [myTurnActive]);

  // Flash the tab title while it's my turn so I don't miss it when the tab is backgrounded.
  useEffect(() => {
    if (!myTurnActive) return;
    const original = document.title;
    let toggle = false;
    const iv = setInterval(() => {
      toggle = !toggle;
      document.title = toggle ? "⚠️ YOUR TURN — Poker" : original;
    }, 900);
    return () => { clearInterval(iv); document.title = original; };
  }, [myTurnActive]);
  const dealDisabled = startMut.isPending || !hasEnoughPlayers || tablePaused;
  const dealerReady = !hand && hasEnoughPlayers && (nextDealer.data?.dealer_user_id === meId);
  const canDealHostFallback = !hand && hasEnoughPlayers && (nextDealer.data?.dealer_user_id === null) && isHost;
  // When the next dealer is a bot, the host deals on its behalf.

  function seatLabel(s: { user_id: string }) {
    const p = (profiles.data ?? []).find((x: any) => x.id === s.user_id);
    return p ? formatDisplayName(p.name, p.nickname) : "Player";
  }

  // Compute per-seat winnings for showdown highlight.
  const winByseat = new Map<number, { amount: number; hand_name?: string }>();
  if (lastHand) {
    const winners = (lastHand.winners ?? []) as { seats: number[]; amount: number; hand_name?: string }[];
    for (const w of winners) {
      const share = w.seats.length ? Math.floor(w.amount / w.seats.length) : 0;
      for (const s of w.seats) {
        const prev = winByseat.get(s);
        winByseat.set(s, { amount: (prev?.amount ?? 0) + share, hand_name: w.hand_name ?? prev?.hand_name });
      }
    }
  }

  // ----- Shared JSX fragments (used by both mobile & desktop layouts) -----
  const streetLabel = hand
    ? (hand.street === "discard" ? "Discard"
      : hand.street === "preflop" ? "Pre-Flop"
      : hand.street === "flop" ? "Flop"
      : hand.street === "turn" ? "Turn"
      : hand.street === "river" ? "River"
      : hand.street.charAt(0).toUpperCase() + hand.street.slice(1))
    : "";

  const centerContent = hand ? (
    <>
      <div className="text-[10px] sm:text-xs uppercase tracking-widest text-gold/80">Pot</div>
      <div
        key={`pot-${hand.id}-${hand.pot}`}
        className="font-mono text-xl sm:text-2xl font-semibold text-white animate-pot-pop leading-none"
      >
        {Number(hand.pot).toLocaleString()}
      </div>
      <BoardDisplay hand={hand} />
      <div className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-white/50">{streetLabel}</div>
      {hand.current_bet > 0 && (
        <div className="text-[10px] sm:text-xs text-white/70">to call: <span className="font-mono text-gold">{Number(hand.current_bet).toLocaleString()}</span></div>
      )}
      {secondsLeft !== null && (
        <div className={cn(
          "text-[10px] uppercase tracking-widest",
          secondsLeft <= 10 ? "text-red-300" : "text-white/60",
        )}>
          {inDiscard ? "Discard" : "Turn"} · {secondsLeft}s
        </div>
      )}
      {inDiscard && (
        <div className="text-[10px] sm:text-[11px] text-gold/80">
          {myMustDiscard ? "Tap a card to discard" : "Waiting for players to discard…"}
        </div>
      )}
    </>
  ) : lastHand ? (
    <ShowdownSummary
      hand={lastHand}
      seats={seats.data ?? []}
      profiles={profiles.data ?? []}
      holeCards={hcs}
      waitingFor={(() => {
        const uid = nextDealer.data?.dealer_user_id;
        if (!uid) return "next dealer";
        const s = (seats.data ?? []).find((x) => x.user_id === uid);
        return seatLabel({ user_id: uid });
      })()}
      dealPrompt={dealerReady ? "Your deal — pick a game" : null}
      onDeal={(v) => startMut.mutate(v)}
      dealDisabled={dealDisabled}
    />
  ) : dealerReady ? (
    <div className="text-center">
      <div className="mb-2 text-[10px] sm:text-xs uppercase tracking-widest text-gold/80">Your deal — pick a game</div>
      <div className="flex flex-wrap justify-center gap-1.5 px-2 max-w-[15rem] sm:max-w-none">
        <Button size="sm" className="bg-gold shadow-gold text-black text-xs" onClick={() => startMut.mutate("holdem")} disabled={dealDisabled}>Hold'em</Button>
        <Button size="sm" variant="outline" className="text-xs" onClick={() => startMut.mutate("omaha")} disabled={dealDisabled}>Omaha</Button>
        <Button size="sm" variant="outline" className="text-xs" onClick={() => startMut.mutate("five_one")} disabled={dealDisabled}>5-Card</Button>
        <Button size="sm" variant="outline" className="text-xs" onClick={() => startMut.mutate("five_two")} disabled={dealDisabled}>5-Card 2B</Button>
        <Button size="sm" variant="outline" className="text-xs" onClick={() => startMut.mutate("pineapple")} disabled={dealDisabled}>Pineapple</Button>
      </div>
    </div>
  ) : (
    <div className="text-center">
      <div className="font-display text-xs sm:text-sm uppercase tracking-widest text-gold/80">Waiting for players</div>
      <div className="mt-1 text-[10px] sm:text-xs text-white/60">
        {nextDealer.data?.dealer_user_id
          ? (() => {
              const uid = nextDealer.data.dealer_user_id;
              const s = (seats.data ?? []).find((x) => x.user_id === uid);
              return `${seatLabel({ user_id: uid })} will deal when ready`;
            })()
          : "Need at least 2 seated players with chips"}
      </div>
    </div>
  );

  const renderSeat = (i: number) => {
            const angle = (i / t.max_seats) * 2 * Math.PI - Math.PI / 2;
            // Portrait mobile: tall ellipse, seats hug the vertical perimeter → no overlap.
            const rx = isMobile ? 40 : 46;
            const ry = isMobile ? 44 : 40;
            const x = 50 + rx * Math.cos(angle);
            const y = 50 + ry * Math.sin(angle);
            // Bet chip sits on the felt in front of the seat (toward table center).
            const dealerDx = -Math.cos(angle) * 28;
            const dealerDy = -Math.sin(angle) * 28;
            // Dealer button sits to the SIDE of the seat (perpendicular to the
            // seat→center line) and slightly toward the felt, so it never
            // overlaps the player's name plate or their hole cards.
            const perpX = -Math.sin(angle);
            const perpY = Math.cos(angle);
            const dealerBtnDx = perpX * 34 + -Math.cos(angle) * 10;
            const dealerBtnDy = perpY * 34 + -Math.sin(angle) * 10;
            const s = seatMap.get(i);
            const hSeat = hs.find((h) => h.seat_index === i);
            const hcRow = hcs.find((h) => h.seat_index === i);
            const isMe = s?.user_id === meId;
            const hostPeekCards = isHost
              ? (hostPeekQ.data?.holes?.find((h) => h.seat_index === i)?.cards ?? null)
              : null;
            const peekOpen = peekSeats.has(i);
            const isCurrentActor = hand?.current_seat === i;
            const isMyTurnHere = isCurrentActor && isMe;
            const isDealer = hand?.dealer_seat === i || (!hand && nextDealer.data?.dealer_seat === i);
            const faceDownCount = hcRow?.cards?.length
              ?? (hand ? variantHoleCount(hand.variant, hand.street !== "discard") : 2);
            const winInfo = winByseat.get(i);
            const isWinner = !!winInfo;

            return (
              <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
                {s ? (
                  <div className="flex flex-col items-center gap-1">
                    {isDealer && (
                      <div
                        className="absolute z-10 flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full bg-white text-[10px] sm:text-xs font-bold text-black shadow-lg ring-2 ring-black/40 pointer-events-none"
                        style={{ left: `calc(50% + ${dealerBtnDx}px)`, top: `calc(50% + ${dealerBtnDy}px)`, transform: "translate(-50%, -50%)" }}
                      >
                        D
                      </div>
                    )}
                    {/* Bet chip stack in front of the seat, toward the table centre */}
                    {hSeat && Number(hSeat.committed_street) > 0 && (
                      <div
                        key={`chip-${hand?.id ?? ""}-${hand?.street ?? ""}-${hSeat.committed_street}`}
                        className="absolute z-10 animate-chip-in pointer-events-none"
                        style={{
                          // Push the chip further toward the table centre so
                          // it clears the hole cards. Also nudge it laterally
                          // so it sits beside the card stack rather than on
                          // top of it on tight mobile layouts.
                          left: `calc(50% + ${dealerDx * 2.6 + perpX * 14}px)`,
                          top: `calc(50% + ${dealerDy * 2.6 + perpY * 14}px)`,
                        }}
                      >
                        <ChipBadge amount={Number(hSeat.committed_street)} size="sm" />
                      </div>
                    )}
                    {/* Hole cards on top */}
                    <div className="flex flex-nowrap justify-center min-h-10 sm:min-h-16 [&>*:not(:first-child)]:-ml-2 sm:[&>*:not(:first-child)]:-ml-3">
                      {hSeat && !hSeat.folded ? (
                        isMe && hcRow ? (
                          hcRow.cards.map((c, k) => (
                            <button
                              key={c}
                              type="button"
                              disabled={!myMustDiscard || discardMut.isPending}
                              onClick={myMustDiscard ? () => discardMut.mutate(c) : undefined}
                              className={cn(
                                "animate-deal",
                                myMustDiscard && "cursor-pointer transition hover:-translate-y-1 hover:ring-2 hover:ring-red-400 rounded-md",
                              )}
                              style={{
                                "--dx": `${dealerDx * 6}px`,
                                "--dy": `${dealerDy * 6}px`,
                                "--deal-delay": `${(k * t.max_seats + i) * 80}ms`,
                              } as any}
                              title={myMustDiscard ? "Discard this card" : undefined}
                            >
                              <PlayingCard code={c} size="xs" />
                            </button>
                          ))
                        ) : hcRow?.revealed ? (
                          hcRow.cards.map((c, k) => (
                            <div
                              key={c}
                              className="animate-deal"
                              style={{
                                "--dx": `${dealerDx * 6}px`,
                                "--dy": `${dealerDy * 6}px`,
                                "--deal-delay": `${(k * t.max_seats + i) * 80}ms`,
                              } as any}
                            >
                              <PlayingCard code={c} size="xs" />
                            </div>
                          ))
                        ) : isHost && peekOpen && hostPeekCards ? (
                          hostPeekCards.map((c, k) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setPeekSeats((prev) => { const n = new Set(prev); n.delete(i); return n; })}
                              className="animate-deal ring-2 ring-purple-400 rounded-md"
                              style={{
                                "--dx": `${dealerDx * 6}px`,
                                "--dy": `${dealerDy * 6}px`,
                                "--deal-delay": `${(k * t.max_seats + i) * 80}ms`,
                              } as any}
                              title="Host peek — tap to hide"
                            >
                              <PlayingCard code={c} size="xs" />
                            </button>
                          ))
                        ) : (
                          Array.from({ length: faceDownCount }).map((_, k) => (
                            <button
                              key={k}
                              type="button"
                              disabled={!isHost || !hostPeekCards}
                              onClick={isHost && hostPeekCards ? () => setPeekSeats((prev) => { const n = new Set(prev); n.add(i); return n; }) : undefined}
                              className="animate-deal"
                              style={{
                                "--dx": `${dealerDx * 6}px`,
                                "--dy": `${dealerDy * 6}px`,
                                "--deal-delay": `${(k * t.max_seats + i) * 80}ms`,
                              } as any}
                              title={isHost && hostPeekCards ? "Host peek — tap to reveal" : undefined}
                            >
                              <PlayingCard faceDown size="xs" />
                            </button>
                          ))
                        )
                      ) : hSeat?.folded ? (
                        <div className="text-[10px] uppercase text-white/40 self-end pb-2">folded</div>
                      ) : null}
                    </div>
                    {/* Nameplate */}
                    <div className={cn(
                      "relative w-16 sm:w-28 rounded-md sm:rounded-xl border-2 bg-background/90 px-1 py-0.5 sm:p-2 text-center shadow-card transition",
                      isWinner
                        ? "border-gold ring-4 ring-gold/60 shadow-gold scale-105 sm:scale-110 bg-gradient-to-b from-amber-500/25 to-background/90"
                        : isMyTurnHere
                          ? "border-gold ring-4 ring-gold/80 shadow-gold scale-105 sm:scale-110 bg-gradient-to-b from-amber-500/25 to-background/90 animate-pulse"
                          : isCurrentActor
                            ? "border-gold ring-2 ring-gold/40 animate-pulse"
                            : isMe ? "border-gold/70" : "border-border/60",
                    )}>
                      {isMyTurnHere && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-full bg-gold px-2 py-0.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-black shadow-gold whitespace-nowrap animate-pulse">
                          Your turn
                        </div>
                      )}
                      {isWinner && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold text-black shadow-gold whitespace-nowrap">
                          <Trophy className="h-3 w-3" />+{winInfo!.amount.toLocaleString()}
                        </div>
                      )}
                      <div className="flex items-center justify-center gap-0.5 truncate text-[10px] sm:text-xs font-semibold leading-tight">
                        <span className="truncate">{seatLabel(s)}</span>
                      </div>
                      <div
                        key={`stk-${hSeat?.stack ?? s.stack}`}
                        className={cn(
                          "text-[10px] sm:text-[11px] text-gold",
                          isWinner && "animate-pot-pop",
                        )}
                      >
                        {Number(hSeat?.stack ?? s.stack).toLocaleString()}
                      </div>
                      {hSeat?.last_action && !hSeat.folded && (
                        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{hSeat.last_action.replace("_", " ")}</div>
                      )}
                      {hSeat?.all_in && !hSeat.folded && (
                        <div className="text-[9px] font-semibold text-red-400">ALL IN</div>
                      )}
                      {isWinner && winInfo!.hand_name && winInfo!.hand_name !== "uncontested" && (
                        <div className="text-[9px] text-gold/90 truncate">{winInfo!.hand_name}</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPendingSeat(i)}
                      disabled={joinMut.isPending || !!mySeat}
                      className="w-14 sm:w-24 rounded-lg sm:rounded-xl border border-dashed border-white/30 bg-background/30 px-1 sm:px-2 py-1.5 sm:py-3 text-[10px] sm:text-xs text-white/70 hover:border-gold hover:text-gold disabled:opacity-40"
                    >
                      {mySeat ? `Seat ${i + 1}` : `Sit here`}
                    </button>
                  </div>
                )}
              </div>
            );
  };

  const sweepsJsx = sweeps.map((sw) => (
    <ChipSweep key={sw.id} item={sw} onDone={removeSweep} />
  ));

  const feltEl = (extraClass: string) => (
    <div className={cn(
      "relative border-4 sm:border-8 border-gold/30 bg-[radial-gradient(ellipse_at_center,var(--felt),var(--felt-deep))] shadow-2xl",
      extraClass,
    )}>
      {myTurnActive && (
        <div className="pointer-events-none absolute top-1 left-1/2 z-20 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-gold px-3 py-1 text-[11px] sm:text-xs font-bold uppercase tracking-widest text-black shadow-gold animate-pulse">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-black/60 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-black" />
            </span>
            {myMustDiscard ? "Your discard" : "Your turn"}
            {secondsLeft !== null && <span className="font-mono">· {secondsLeft}s</span>}
            {(() => {
              const bank = (mySeat as any)?.time_bank_seconds ?? 0;
              const showBank = secondsLeft !== null && secondsLeft <= 15 && bank > 0;
              if (!showBank) return null;
              return (
                <button
                  type="button"
                  onClick={() => timeBankMut.mutate()}
                  disabled={timeBankMut.isPending}
                  className="ml-1 rounded-full bg-black/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gold hover:bg-black disabled:opacity-60"
                  title={`Add 15s — ${bank}s left in your time bank`}
                >
                  +15s · {bank}s
                </button>
              );
            })()}
          </div>
        </div>
      )}
      {isHost && hand && (hostPeekQ.data?.upcoming?.length ?? 0) > 0 && (
        <div className="absolute top-1 left-1 z-20 max-w-[45%]">
          <button
            type="button"
            onClick={() => setShowUpcoming((v) => !v)}
            className="flex items-center gap-1 rounded-full border border-purple-400/60 bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-200 hover:bg-purple-500/20"
            title="Host peek — upcoming community cards"
          >
            <Eye className="h-3 w-3" /> {showUpcoming ? "Hide" : "Peek"} next
          </button>
          {showUpcoming && (
            <div className="mt-1 space-y-1 rounded-md border border-purple-400/40 bg-black/80 p-1.5 text-[10px] text-purple-100 shadow-lg">
              {hostPeekQ.data!.upcoming.map((u) => (
                <div key={u.label} className="flex items-center gap-1.5">
                  <span className="w-16 shrink-0 text-purple-300/80">{u.label}</span>
                  <div className="flex gap-0.5">
                    {u.cards.map((c) => (<PlayingCard key={c} code={c} size="xs" />))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 sm:gap-2 pointer-events-none px-2">
        <div className="pointer-events-auto flex flex-col items-center gap-1.5 sm:gap-2 text-center">
          {centerContent}
        </div>
      </div>
      {seatIndexes.map(renderSeat)}
      {sweepsJsx}
    </div>
  );

  const handOddsJsx = (hand && myHoleCards && myHoleCards.cards.length >= 2 && !myHandSeat?.folded && hand.street !== "discard") ? (
    <HandOdds
      hole={myHoleCards.cards}
      board={hand.board ?? []}
      opponents={hs.filter((s) => !s.folded && s.user_id !== meId).length}
      variant={hand.variant}
    />
  ) : null;

  const pausedBannerJsx = tablePaused ? (
    <div className="flex items-center justify-center py-1.5">
      <div className="rounded-full border border-gold/60 bg-black/60 px-3 py-1 text-xs sm:text-sm font-semibold text-gold shadow-gold">
        <Pause className="mr-1.5 inline h-3.5 w-3.5" /> Table paused by host
      </div>
    </div>
  ) : null;

  const showMuckJsx = (lastHand && myHoleCards && !myHoleCards.revealed && !myHoleCards.mucked && !hs.find((s) => s.user_id === meId)?.folded) ? (
    <div className="flex items-center justify-center gap-2 py-1.5">
      <span className="text-xs sm:text-sm text-muted-foreground">Show your cards?</span>
      <Button size="sm" variant="outline" onClick={() => revealMut.mutate(true)} disabled={revealMut.isPending}>
        <Eye className="mr-1 h-3.5 w-3.5" /> Show
      </Button>
      <Button size="sm" variant="ghost" onClick={() => revealMut.mutate(false)} disabled={revealMut.isPending}>
        <EyeOff className="mr-1 h-3.5 w-3.5" /> Muck
      </Button>
    </div>
  ) : null;

  const actionBarJsx = (hand && myHandSeat && !myHandSeat.folded && hand.street !== "discard" && !tablePaused) ? (
    <ActionBar
      hand={hand}
      myHandSeat={myHandSeat}
      bigBlind={t.big_blind}
      onAction={(action, amount) => actMut.mutate({ action, amount })}
      isMyTurn={isMyTurn}
      busy={actMut.isPending}
      compact={isMobile}
    />
  ) : null;

  // Confirmation sheet before joining a seat: shows buy-in vs wallet with one big button.
  const seatPickerJsx = pendingSeat !== null ? (() => {
    const buyIn = Number(t.buy_in);
    const chips = Number(wallet.data?.chips ?? 0);
    const short = Math.max(0, buyIn - chips);
    return (
      <Dialog open onOpenChange={(o) => { if (!o) setPendingSeat(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sit at Seat {pendingSeat + 1}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border border-border/60 bg-background/40 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Buy-in</span>
                <span className="font-mono font-semibold text-gold">{buyIn.toLocaleString()}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Your wallet</span>
                <span className="font-mono">{chips.toLocaleString()}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm border-t border-border/40 pt-1.5">
                <span className="text-muted-foreground">After sitting</span>
                <span className={cn("font-mono", short > 0 ? "text-red-400" : "text-emerald-400")}>
                  {short > 0 ? `Need +${short.toLocaleString()}` : `${(chips - buyIn).toLocaleString()} left`}
                </span>
              </div>
            </div>
            {short > 0 && (
              <p className="text-xs text-red-300">
                Not enough chips. Top up from the lobby before sitting down.
              </p>
            )}
            <Button
              className="w-full h-12 bg-gold text-black shadow-gold hover:bg-gold/90 text-base font-bold"
              disabled={short > 0 || joinMut.isPending}
              onClick={() => joinMut.mutate(pendingSeat)}
            >
              {joinMut.isPending ? "Sitting…" : `Sit down · ${buyIn.toLocaleString()} chips`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  })() : null;

  // ============ Mobile layout: fixed viewport, no scroll ============
  if (isMobile) {
    return (
      <CasinoShell compact>
        {/* Slim toolbar */}
        <div className="flex items-center gap-1.5 border-b border-gold/20 bg-background/85 px-2 py-1.5 backdrop-blur">
          <button
            type="button"
            onClick={() => navigate({ to: "/dashboard" })}
            className="rounded-md p-1.5 text-gold hover:bg-white/5"
            aria-label="Return to home"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-bold leading-tight">{t.name}</div>
            <div className="truncate text-[9px] uppercase tracking-wide text-muted-foreground leading-tight">
              {hand ? `${VARIANT_LABEL[hand.variant]} · #${hand.hand_no}` : "Dealer's choice"} · {t.small_blind}/{t.big_blind}
            </div>
          </div>
          {hand && (
            <div className="shrink-0 rounded-full bg-gold/10 border border-gold/40 px-2 py-0.5 text-[10px] font-mono text-gold">
              Pot {Number(hand.pot).toLocaleString()}
            </div>
          )}
          <div className="shrink-0 rounded-full border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px]">
            <Coins className="mr-0.5 inline h-3 w-3 text-gold" />
            {(wallet.data?.chips ?? 0).toLocaleString()}
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                className="rounded-md border border-border/60 bg-background/60 p-1.5 text-white/80 hover:text-gold"
                aria-label="Menu"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[75dvh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Table menu</SheetTitle>
              </SheetHeader>
              <div className="mt-3 flex flex-wrap gap-2">
                <HandHistoryButton tableId={id} historyFn={historyFn} profiles={profiles.data ?? []} seats={seats.data ?? []} />
                {mySeat && (
                  <RebuyButton
                    buyIn={Number(t.buy_in)}
                    onSubmit={(amt) => requestRebuyMut.mutate(amt)}
                    pending={requestRebuyMut.isPending}
                    isHost={isHost}
                  />
                )}
                {isHost && (
                  <RebuyHostPanel
                    requests={rebuys.data ?? []}
                    seats={seats.data ?? []}
                    profiles={profiles.data ?? []}
                    buyIn={Number(t.buy_in)}
                    onApprove={(rid) => approveRebuyMut.mutate(rid)}
                    onDeny={(rid) => denyRebuyMut.mutate(rid)}
                    onAdd={(seat_index, amount) => hostAddRebuyMut.mutate({ seat_index, amount })}
                  />
                )}
                {isHost && (
                  <Button
                    size="sm"
                    variant={tablePaused ? "default" : "outline"}
                    onClick={() => pauseMut.mutate(!tablePaused)}
                    disabled={pauseMut.isPending}
                    className={tablePaused ? "bg-gold text-black hover:bg-gold/90" : ""}
                  >
                    {tablePaused
                      ? (<><Play className="mr-1 h-3.5 w-3.5" /> Resume</>)
                      : (<><Pause className="mr-1 h-3.5 w-3.5" /> Pause</>)}
                  </Button>
                )}
                {mySeat && !hand && (
                  <SheetClose asChild>
                    <Button size="sm" variant="outline" onClick={() => leaveMut.mutate()} disabled={leaveMut.isPending}>
                      <LogOut className="mr-1 h-3.5 w-3.5" /> Leave seat
                    </Button>
                  </SheetClose>
                )}
                {isHost && (
                  <Button size="sm" variant="destructive" onClick={() => { if (confirm("End the table for everyone?")) endMut.mutate(); }} disabled={endMut.isPending}>
                    <Flag className="mr-1 h-3.5 w-3.5" /> End table
                  </Button>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Felt fills remaining space */}
        {feltEl("flex-1 min-h-0 mx-1 mt-1 rounded-[36%] overflow-visible")}

        {pausedBannerJsx}

        {/* Bottom compact panel: hand info + action bar */}
        <div className="shrink-0 border-t border-border/40 bg-background/95 backdrop-blur px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {handOddsJsx}
          {actionBarJsx}
          {showMuckJsx}
          {!actionBarJsx && !showMuckJsx && !handOddsJsx && (
            <div className="text-center text-[11px] text-muted-foreground py-1.5">
              {mySeat ? "Waiting…" : "Pick a seat to join the table"}
            </div>
          )}
        </div>
        {seatPickerJsx}
        <TableChat
          tableId={id}
          meId={meId}
          profiles={profiles.data ?? []}
        />
      </CasinoShell>
    );
  }

  // ============ Desktop / large-screen layout ============
  return (
    <CasinoShell>
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h1 className="font-display text-lg sm:text-2xl font-bold truncate">
                  {t.name}
                  {hand && (
                    <Badge variant="outline" className="ml-2 align-middle text-[10px] sm:text-xs">
                      Hand #{hand.hand_no} · {VARIANT_LABEL[hand.variant] ?? hand.variant}
                    </Badge>
                  )}
                </h1>
                <div className="text-[11px] sm:text-xs text-muted-foreground truncate">
                  Blinds {t.small_blind}/{t.big_blind} · Buy-in {t.buy_in.toLocaleString()} · Dealer's choice
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <div className="rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[11px] sm:text-xs">
                  <Coins className="mr-1 inline h-3.5 w-3.5 text-gold" />
                  {(wallet.data?.chips ?? 0).toLocaleString()}
                </div>
                <HandHistoryButton tableId={id} historyFn={historyFn} profiles={profiles.data ?? []} seats={seats.data ?? []} />
                {mySeat && !hand && (
                  <Button size="sm" variant="outline" onClick={() => leaveMut.mutate()} disabled={leaveMut.isPending}>
                    <LogOut className="mr-1 h-3.5 w-3.5" /> Leave
                  </Button>
                )}
                {mySeat && (
                  <RebuyButton
                    buyIn={Number(t.buy_in)}
                    onSubmit={(amt) => requestRebuyMut.mutate(amt)}
                    pending={requestRebuyMut.isPending}
                    isHost={isHost}
                  />
                )}
                {isHost && (
                  <RebuyHostPanel
                    requests={rebuys.data ?? []}
                    seats={seats.data ?? []}
                    profiles={profiles.data ?? []}
                    buyIn={Number(t.buy_in)}
                    onApprove={(rid) => approveRebuyMut.mutate(rid)}
                    onDeny={(rid) => denyRebuyMut.mutate(rid)}
                    onAdd={(seat_index, amount) => hostAddRebuyMut.mutate({ seat_index, amount })}
                  />
                )}
                {isHost && (
                  <Button size="sm" variant="destructive" onClick={() => { if (confirm("End the table for everyone?")) endMut.mutate(); }} disabled={endMut.isPending}>
                    <Flag className="mr-1 h-3.5 w-3.5" /> End
                  </Button>
                )}
                {isHost && (
                  <Button
                    size="sm"
                    variant={tablePaused ? "default" : "outline"}
                    onClick={() => pauseMut.mutate(!tablePaused)}
                    disabled={pauseMut.isPending}
                    className={tablePaused ? "bg-gold text-black hover:bg-gold/90" : ""}
                  >
                    {tablePaused
                      ? (<><Play className="mr-1 h-3.5 w-3.5" /> Resume</>)
                      : (<><Pause className="mr-1 h-3.5 w-3.5" /> Pause</>)}
                  </Button>
                )}
              </div>
            </div>

            {feltEl("mx-auto aspect-[2/1] w-full max-h-[calc(100dvh-7rem)] rounded-[50%]")}

            {handOddsJsx}
            {pausedBannerJsx}
            {actionBarJsx}
            {showMuckJsx}
          </div>
          <TableChat
            tableId={id}
            meId={meId}
            profiles={profiles.data ?? []}
          />
        </div>
      </div>
      {seatPickerJsx}
    </CasinoShell>
  );
}

function ActionBar({ hand, myHandSeat, bigBlind, onAction, isMyTurn, busy, compact }: {
  hand: HandRow; myHandSeat: HandSeat; bigBlind: number;
  onAction: (action: string, amount?: number) => void; isMyTurn: boolean; busy: boolean;
  compact?: boolean;
}) {
  const toCall = Math.max(0, Number(hand.current_bet) - Number(myHandSeat.committed_street));
  const stack = Number(myHandSeat.stack);
  const canCheck = toCall === 0;
  const canCall = toCall > 0 && stack > 0;
  const noBetYet = Number(hand.current_bet) === 0;
  const minRaise = Math.max(bigBlind, Number(hand.min_raise));
  // For a raise, the *total street commit* must be at least current_bet + min_raise
  const minRaiseTotal = Number(hand.current_bet) + minRaise;
  const maxTotal = stack + Number(myHandSeat.committed_street);
  const [amount, setAmount] = useState<number>(noBetYet ? Math.min(bigBlind, stack) : Math.min(minRaiseTotal, maxTotal));

  useEffect(() => {
    setAmount(noBetYet ? Math.min(bigBlind, stack) : Math.min(minRaiseTotal, maxTotal));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand.id, hand.street, hand.current_bet, hand.min_raise]);

  const min = noBetYet ? Math.min(bigBlind, stack) : Math.min(minRaiseTotal, maxTotal);
  const max = maxTotal;
  const potIfCall = Number(hand.pot) + toCall;
  const presets = noBetYet
    ? [
        { label: "1 BB", value: Math.min(bigBlind, max) },
        { label: "⅓ Pot", value: Math.min(Math.max(bigBlind, Math.floor(Number(hand.pot) / 3)), max) },
        { label: "½ Pot", value: Math.min(Math.max(bigBlind, Math.floor(Number(hand.pot) / 2)), max) },
        { label: "¾ Pot", value: Math.min(Math.max(bigBlind, Math.floor(Number(hand.pot) * 3 / 4)), max) },
        { label: "Pot", value: Math.min(Math.max(bigBlind, Number(hand.pot)), max) },
        { label: "All-in", value: max },
      ]
    : [
        { label: "Min", value: Math.min(minRaiseTotal, max) },
        { label: "⅓ Pot", value: Math.min(Math.max(minRaiseTotal, Number(hand.current_bet) + Math.floor(potIfCall / 3)), max) },
        { label: "½ Pot", value: Math.min(Math.max(minRaiseTotal, Number(hand.current_bet) + Math.floor(potIfCall / 2)), max) },
        { label: "¾ Pot", value: Math.min(Math.max(minRaiseTotal, Number(hand.current_bet) + Math.floor(potIfCall * 3 / 4)), max) },
        { label: "Pot", value: Math.min(Math.max(minRaiseTotal, Number(hand.current_bet) + potIfCall), max) },
        { label: "All-in", value: max },
      ];

  const clamped = Math.min(Math.max(amount, min), max);

  return (
    <div className={cn(
      compact
        ? "rounded-xl border p-1.5"
        : "mt-3 rounded-2xl border p-2.5 sm:p-4 shadow-card sticky bottom-2 z-10 backdrop-blur",
      isMyTurn ? "border-gold/60 bg-background/90" : "border-border/40 bg-background/60 opacity-80",
    )}>
      {!isMyTurn ? (
        <div className={cn("text-center text-muted-foreground", compact ? "text-xs py-1.5" : "text-sm")}>Waiting for other players…</div>
      ) : (
        <>
          <div className={cn(
            "grid gap-1.5",
            compact ? "mb-1.5 grid-cols-2" : "mb-2 sm:mb-3 grid-cols-2 sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:gap-2",
          )}>
            <Button variant="destructive" size="sm" className={compact ? "h-11" : "sm:h-11"} onClick={() => { tap(); onAction("fold"); }} disabled={busy}>Fold</Button>
            {canCheck ? (
              <Button variant="outline" size="sm" className={compact ? "h-11" : "sm:h-11"} onClick={() => { tap(); onAction("check"); }} disabled={busy}>Check</Button>
            ) : (
              <Button variant="outline" size="sm" className={compact ? "h-11" : "sm:h-11"} onClick={() => { tap(); onAction("call"); }} disabled={busy || !canCall}>
                Call {toCall.toLocaleString()}
              </Button>
            )}
            {stack > 0 && (
              <Button
                size="sm"
                className={cn("bg-gold shadow-gold text-black col-span-2 font-bold", compact ? "h-11" : "sm:h-11 sm:col-span-1")}
                onClick={() => { tap(12); onAction(noBetYet ? "bet" : "raise", clamped); }}
                disabled={busy || max < min}
              >
                {noBetYet ? "Bet" : "Raise to"} {clamped.toLocaleString()}
              </Button>
            )}
            <Button variant="outline" size="sm" className={cn("col-span-2", compact ? "h-11" : "sm:h-11 sm:col-span-1")} onClick={() => { tap(15); onAction("all_in"); }} disabled={busy || stack <= 0}>
              All-in {stack.toLocaleString()}
            </Button>
          </div>
          {stack > 0 && (
            <>
              <div className={cn("flex items-center justify-center px-1", compact ? "gap-1.5" : "gap-2 sm:gap-3")}>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={cn("shrink-0", compact ? "h-8 w-8" : "h-8 w-8 sm:h-10 sm:w-10")}
                  onClick={() => setAmount((a) => Math.max(min, Math.min(max, a) - 1))}
                  disabled={busy || clamped <= min}
                  aria-label="Decrease bet"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <input
                  type="number"
                  inputMode="numeric"
                  className={cn("rounded-md border border-input bg-background px-2 py-1 text-center font-mono", compact ? "w-24 text-sm h-8" : "w-24 sm:w-32 text-sm")}
                  value={amount}
                  min={min}
                  max={max}
                  step={1}
                  onChange={(e) => setAmount(Number(e.target.value) || 0)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={cn("shrink-0", compact ? "h-8 w-8" : "h-8 w-8 sm:h-10 sm:w-10")}
                  onClick={() => setAmount((a) => Math.min(max, Math.max(min, a) + 1))}
                  disabled={busy || clamped >= max}
                  aria-label="Increase bet"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {max > min && (
                <div className={cn("px-2", compact ? "mt-1" : "mt-2")}>
                  <Slider
                    min={min}
                    max={max}
                    step={1}
                    value={[clamped]}
                    onValueChange={(vals) => setAmount(vals[0] ?? min)}
                  />
                </div>
              )}
              <div className={cn("grid grid-cols-3 gap-1", compact ? "mt-1" : "mt-2 sm:flex sm:flex-wrap sm:justify-center")}>
                {presets.map((p) => (
                  <Button key={p.label} size="sm" variant="ghost" className={cn("px-1", compact ? "h-8 text-[11px]" : "text-[11px] sm:text-xs sm:px-3")} onClick={() => { tap(6); setAmount(p.value); }} disabled={p.value < min || p.value > max}>
                    {p.label}{!compact && <span className="hidden sm:inline"> · {p.value.toLocaleString()}</span>}
                  </Button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ShowdownSummary({ hand, seats, profiles, holeCards, waitingFor, dealPrompt, onDeal, dealDisabled }: {
  hand: HandRow; seats: SeatRow[]; profiles: any[]; holeCards: HoleCardRow[]; waitingFor: string;
  dealPrompt?: string | null; onDeal?: (v: Variant) => void; dealDisabled?: boolean;
}) {
  const nameOf = (uid: string) => {
    const p = profiles.find((x) => x.id === uid);
    return p ? formatDisplayName(p.name, p.nickname) : "Player";
  };
  const seatUser = (i: number) => seats.find((s) => s.seat_index === i)?.user_id;
  const winners = (hand.winners ?? []) as { seats: number[]; amount: number; hand_name?: string }[];
  return (
    <div className="max-w-sm sm:max-w-md text-center px-2">
      <div className="text-[10px] sm:text-xs uppercase tracking-widest text-gold/80">Hand #{hand.hand_no} · {VARIANT_LABEL[hand.variant] ?? hand.variant}</div>
      <div className="mt-1"><BoardDisplay hand={hand} /></div>
      <div className="mt-2 flex flex-col items-center gap-1.5">
        {winners.map((w, i) => (
          <div
            key={i}
            className="w-full rounded-xl border-2 border-gold bg-gradient-to-r from-amber-500/25 via-amber-400/15 to-amber-500/25 px-3 py-2 shadow-gold"
          >
            <div className="flex items-center justify-center gap-1.5 text-sm sm:text-base font-bold text-gold">
              <Trophy className="h-4 w-4 sm:h-5 sm:w-5 fill-gold" />
              {w.seats.map((s) => nameOf(seatUser(s) ?? "")).join(" & ")}
            </div>
            <div className="mt-0.5 font-mono text-lg sm:text-xl font-black text-white">
              +{w.amount.toLocaleString()}
            </div>
            {w.hand_name && w.hand_name !== "uncontested" && (
              <div className="text-[10px] sm:text-xs uppercase tracking-wide text-gold/90">{w.hand_name}</div>
            )}
          </div>
        ))}
      </div>
      {dealPrompt && onDeal ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] sm:text-xs uppercase tracking-widest text-gold/80">{dealPrompt}</div>
          <div className="flex flex-wrap justify-center gap-1.5 px-2 max-w-[15rem] sm:max-w-none">
            <Button size="sm" className="bg-gold shadow-gold text-black text-xs" onClick={() => onDeal("holdem")} disabled={dealDisabled}>Hold'em</Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => onDeal("omaha")} disabled={dealDisabled}>Omaha</Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => onDeal("five_one")} disabled={dealDisabled}>5-Card</Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => onDeal("five_two")} disabled={dealDisabled}>5-Card 2B</Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => onDeal("pineapple")} disabled={dealDisabled}>Pineapple</Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 text-[10px] sm:text-[11px] text-white/60">Waiting for {waitingFor} to deal…</div>
      )}
    </div>
  );
}

function HandHistoryButton({ tableId, historyFn, profiles, seats }: {
  tableId: string; historyFn: any; profiles: any[]; seats: SeatRow[];
}) {
  const [open, setOpen] = useState(false);
  const hist = useQuery({
    queryKey: ["poker-history", tableId],
    enabled: open,
    queryFn: () => historyFn({ data: { table_id: tableId } }),
  });
  const seatUser = (i: number) => seats.find((s) => s.seat_index === i)?.user_id;
  const nameOf = (uid?: string) => {
    if (!uid) return "—";
    const p = profiles.find((x) => x.id === uid);
    return p ? formatDisplayName(p.name, p.nickname) : "Player";
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><History className="mr-1 h-3.5 w-3.5" /> History</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Hand history</DialogTitle></DialogHeader>
        {hist.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {hist.data && hist.data.length === 0 && <div className="text-sm text-muted-foreground">No completed hands yet.</div>}
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {(hist.data ?? []).map((h: any) => (
            <div key={h.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-semibold">Hand #{h.hand_no} · {h.variant === "omaha" ? "Omaha" : "Hold'em"}</span>
                <span className="text-muted-foreground">Pot {Number(h.pot).toLocaleString()}</span>
              </div>
              <div className="mb-2 flex gap-1">
                {(h.board ?? []).map((c: string, i: number) => <PlayingCard key={i} code={c} size="xs" />)}
              </div>
              <div className="space-y-0.5 text-xs">
                {(h.winners ?? []).map((w: any, i: number) => (
                  <div key={i}>
                    <Circle className="mr-1 inline h-2 w-2 fill-emerald-400 text-emerald-400" />
                    {w.seats.map((s: number) => nameOf(seatUser(s))).join(", ")} won {Number(w.amount).toLocaleString()}
                    {w.hand_name && w.hand_name !== "uncontested" && <span className="text-muted-foreground"> · {w.hand_name}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
// =====================================================================
// Rebuy button (player + host self-serve)
// =====================================================================
function RebuyButton({
  buyIn, onSubmit, pending, isHost,
}: { buyIn: number; onSubmit: (amt: number) => void; pending: boolean; isHost: boolean }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(buyIn));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="text-xs">
          <Coins className="mr-1 h-3.5 w-3.5" /> Rebuy
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Request a rebuy</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Amount (chips)</label>
            <input
              type="number" step="0.5" min={0.5}
              className="mt-1 w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm"
              value={amount} onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {isHost
              ? "Rebuys are added on credit and settled when the table ends."
              : "Your host will need to approve this request. It's added on credit and settled when the table ends."}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-gold text-black shadow-gold"
              disabled={pending || !Number(amount) || Number(amount) <= 0}
              onClick={() => { onSubmit(Number(amount)); setOpen(false); }}
            >
              {isHost ? "Add rebuy" : "Request"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Rebuy host panel: pending requests + add-for-seat
// =====================================================================
function RebuyHostPanel({
  requests, seats, profiles, buyIn, onApprove, onDeny, onAdd,
}: {
  requests: any[]; seats: SeatRow[]; profiles: any[]; buyIn: number;
  onApprove: (id: string) => void; onDeny: (id: string) => void;
  onAdd: (seat_index: number, amount: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [addAmt, setAddAmt] = useState<Record<number, string>>({});
  const pending = requests.filter((r) => r.status === "pending");
  const activeSeats = seats.filter((s) => s.status !== "left");
  function nameFor(user_id: string) {
    const seat = seats.find((s) => s.user_id === user_id);
    
    const p = profiles.find((x) => x.id === user_id);
    return p ? formatDisplayName(p.name, p.nickname) : "Player";
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="relative text-xs">
          <Coins className="mr-1 h-3.5 w-3.5" /> Rebuys
          {pending.length > 0 && (
            <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
              {pending.length}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Rebuys</DialogTitle></DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          <section>
            <h3 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Pending requests</h3>
            {pending.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/60 p-3 text-center text-xs text-muted-foreground">
                No pending requests.
              </div>
            ) : (
              <ul className="space-y-2">
                {pending.map((r) => (
                  <li key={r.id} className="flex items-center justify-between rounded-md border border-border/60 bg-background/30 px-3 py-2">
                    <div className="text-sm">
                      <div className="font-medium">{nameFor(r.user_id)}</div>
                      <div className="font-mono text-xs text-gold">{Number(r.amount).toLocaleString()} chips</div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => onDeny(r.id)}>Deny</Button>
                      <Button size="sm" className="bg-gold text-black shadow-gold" onClick={() => onApprove(r.id)}>Approve</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Add rebuy for a player</h3>
            <ul className="space-y-2">
              {activeSeats.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-md border border-border/60 bg-background/30 px-3 py-2">
                  <div className="flex-1 text-sm">
                    <div className="font-medium">{nameFor(s.user_id)}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">stack {Number(s.stack).toLocaleString()}</div>
                  </div>
                  <input
                    type="number" step="0.5" min={0.5}
                    className="w-20 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs"
                    placeholder={String(buyIn)}
                    value={addAmt[s.seat_index] ?? ""}
                    onChange={(e) => setAddAmt({ ...addAmt, [s.seat_index]: e.target.value })}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      const raw = addAmt[s.seat_index];
                      const amt = Number(raw && raw !== "" ? raw : buyIn);
                      if (amt > 0) {
                        onAdd(s.seat_index, amt);
                        setAddAmt({ ...addAmt, [s.seat_index]: "" });
                      }
                    }}
                  >Add</Button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Settlement view (shown when the host has ended the table)
// =====================================================================
function SettlementView({
  tableName, settlement, loading, profiles, onBack,
}: {
  tableName: string; currency?: string; settlement: any; loading: boolean; profiles: any[]; onBack: () => void;
}) {
  function nameFor(n: { user_id: string; name: string | null }) {
    if (!n.user_id) return n.name || "Player";
    const p = profiles.find((x) => x.id === n.user_id);
    return p ? formatDisplayName(p.name, p.nickname) : "Player";
  }
  const nets: any[] = settlement?.nets ?? [];
  const transfers: any[] = settlement?.transfers ?? [];
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">{tableName}</h1>
          <p className="text-xs uppercase tracking-widest text-gold/80">Game ended · settle up</p>
        </div>
        <Button variant="outline" size="sm" onClick={onBack}>Back to lobby</Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading settlement…</div>
      ) : !settlement ? (
        <div className="card-felt rounded-2xl p-6 text-center text-sm text-muted-foreground">
          No settlement recorded.
        </div>
      ) : (
        <div className="space-y-5">
          <section className="card-felt rounded-2xl p-4 shadow-card">
            <h2 className="mb-2 text-sm font-semibold">Net results</h2>
            {nets.length === 0 ? (
              <div className="text-xs text-muted-foreground">No players at the table.</div>
            ) : (
              <ul className="divide-y divide-border/50">
                {nets.sort((a, b) => b.net - a.net).map((n, i) => (
                  <li key={i} className="flex items-center justify-between py-2">
                    <span className="text-sm">{nameFor(n)}</span>
                    <span className={cn(
                      "font-mono text-sm",
                      n.net > 0 ? "text-emerald-400" : n.net < 0 ? "text-red-400" : "text-muted-foreground",
                    )}>
                      {n.net > 0 ? "+" : ""}{Number(n.net).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card-felt rounded-2xl p-4 shadow-card">
            <h2 className="mb-2 text-sm font-semibold">Who pays who</h2>
            {transfers.length === 0 ? (
              <div className="text-xs text-muted-foreground">Everyone broke even.</div>
            ) : (
              <ol className="space-y-2">
                {transfers.map((t, i) => (
                  <li key={i} className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-red-400">{nameFor({ user_id: t.from_user_id, name: t.from_name ?? null })}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-emerald-400">{nameFor({ user_id: t.to_user_id, name: t.to_name ?? null })}</span>
                    </div>
                    <span className="font-mono text-gold">{Number(t.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  );
}