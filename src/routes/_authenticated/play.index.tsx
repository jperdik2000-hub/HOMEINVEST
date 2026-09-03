import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { CasinoShell } from "@/components/CasinoShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Spade, Plus, Coins, Users, AlertTriangle, Diamond, Wallet } from "lucide-react";
import { listInviteProfiles } from "@/lib/invite-profiles.functions";
import {
  createPokerTable,
  listMyPokerTables,
  listMyEndedPokerTables,
  getMyWallet,
  topUpWallet,
  listMyWalletTransactions,
} from "@/lib/poker-table.functions";
import {
  createBlackjackTable,
  listMyBlackjackTables,
  rematchBlackjackTable,
} from "@/lib/blackjack.functions";
import { listMyEndedBlackjackTables } from "@/lib/blackjack.functions";
import { rematchPokerTable } from "@/lib/poker-table.functions";
import { resetCasino } from "@/lib/casino-admin.functions";
import { Skeleton } from "@/components/ui/skeleton";
import { RotateCcw, Trash2 } from "lucide-react";
import { withdrawVirtual } from "@/lib/settlements.functions";
import { formatDisplayName } from "@/lib/poker";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/play/")({
  head: () => ({ meta: [{ title: "Play — Poker Club" }] }),
  component: PlayLobby,
});

function PlayLobby() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listMyPokerTables);
  const listEndedFn = useServerFn(listMyEndedPokerTables);
  const walletFn = useServerFn(getMyWallet);
  const topUp = useServerFn(topUpWallet);
  const txFn = useServerFn(listMyWalletTransactions);
  const withdrawFn = useServerFn(withdrawVirtual);
  const createFn = useServerFn(createPokerTable);
  const listBjFn = useServerFn(listMyBlackjackTables);
  const listBjEndedFn = useServerFn(listMyEndedBlackjackTables);
  const createBjFn = useServerFn(createBlackjackTable);
  const rematchPokerFn = useServerFn(rematchPokerTable);
  const rematchBjFn = useServerFn(rematchBlackjackTable);
  const loadInvites = useServerFn(listInviteProfiles);
  const resetFn = useServerFn(resetCasino);

  const resetMut = useMutation({
    mutationFn: () => resetFn() as Promise<{ ok: boolean }>,
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Casino wiped. All games and balances reset.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Reset failed"),
  });

  const tables = useQuery({ queryKey: ["poker-tables"], queryFn: () => listFn() });
  const bjTables = useQuery({ queryKey: ["bj-tables"], queryFn: () => listBjFn() as any });
  const ended = useQuery({ queryKey: ["poker-tables-ended"], queryFn: () => listEndedFn() });
  const bjEnded = useQuery({
    queryKey: ["bj-tables-ended"],
    queryFn: () => listBjEndedFn() as any,
  });
  const wallet = useQuery({ queryKey: ["poker-wallet"], queryFn: () => walletFn() });
  const txs = useQuery({ queryKey: ["poker-wallet-tx"], queryFn: () => txFn() });
  const profiles = useQuery({ queryKey: ["invite-profiles"], queryFn: () => loadInvites() });

  const meAdmin = useQuery({
    queryKey: ["is-admin-play"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user.id)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
  });
  const isAdmin = !!meAdmin.data;

  const meId = useQuery({
    queryKey: ["me-id-play"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
  });

  const topUpMut = useMutation({
    mutationFn: (amount: number) => topUp({ data: { amount } }) as Promise<{ chips: number }>,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["poker-wallet"] });
      qc.invalidateQueries({ queryKey: ["poker-wallet-tx"] });
      setCashierOpen(false);
      toast.success(`Chips added. Balance: ${res.chips.toLocaleString()} chips`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Top up failed"),
  });

  const withdrawMut = useMutation({
    mutationFn: (amount: number) =>
      withdrawFn({ data: { amount } }) as Promise<{
        chips: number;
        locked: number;
        available: number;
        amount: number;
      }>,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["poker-wallet"] });
      qc.invalidateQueries({ queryKey: ["poker-wallet-tx"] });
      qc.invalidateQueries({ queryKey: ["my-settlements"] });
      toast.success(
        `Cashed out ${res.amount.toLocaleString()} chips. Balance: ${res.chips.toLocaleString()}.`,
      );
      setWithdrawAmount("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Withdrawal failed"),
  });

  const [cashierOpen, setCashierOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("50");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [pastTab, setPastTab] = useState<"poker" | "blackjack">("poker");

  const hash = useRouterState({ select: (s) => s.location.hash });
  useEffect(() => {
    if (hash === "cashier") setCashierOpen(true);
  }, [hash]);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Cash Table");
  const [sb, setSb] = useState("0.5");
  const [bb, setBb] = useState("0.5");
  const [buyIn, setBuyIn] = useState("50");
  const [maxSeats, setMaxSeats] = useState("8");
  const [invited, setInvited] = useState<Set<string>>(new Set());

  const [bjOpen, setBjOpen] = useState(false);
  const [bjName, setBjName] = useState("Blackjack Table");
  const [bjMin, setBjMin] = useState("1");
  const [bjMax, setBjMax] = useState("100");
  const [bjInvited, setBjInvited] = useState<Set<string>>(new Set());
  const [bjDealer, setBjDealer] = useState<string>("");

  const createBjMut = useMutation({
    mutationFn: () =>
      createBjFn({
        data: {
          name: bjName,
          min_bet: Number(bjMin),
          max_bet: Number(bjMax),
          invited_user_ids: Array.from(bjInvited),
          ...(bjDealer ? { dealer_user_id: bjDealer } : {}),
        },
      }) as Promise<{ id: string }>,
    onSuccess: (res) => {
      setBjOpen(false);
      qc.invalidateQueries({ queryKey: ["bj-tables"] });
      navigate({ to: "/play/bj/$id", params: { id: res.id } });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create table"),
  });

  function toggleBj(id: string) {
    const n = new Set(bjInvited);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setBjInvited(n);
  }

  const rematchPokerMut = useMutation({
    mutationFn: (table_id: string) =>
      rematchPokerFn({ data: { table_id } }) as Promise<{ id: string }>,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["poker-tables"] });
      qc.invalidateQueries({ queryKey: ["poker-tables-ended"] });
      toast.success("Rematch table created");
      navigate({ to: "/play/$id", params: { id: res.id } });
    },
    onError: (e: any) => toast.error(e?.message ?? "Rematch failed"),
  });
  const rematchBjMut = useMutation({
    mutationFn: (table_id: string) =>
      rematchBjFn({ data: { table_id } }) as Promise<{ id: string }>,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["bj-tables"] });
      qc.invalidateQueries({ queryKey: ["bj-tables-ended"] });
      toast.success("Rematch table created");
      navigate({ to: "/play/bj/$id", params: { id: res.id } });
    },
    onError: (e: any) => toast.error(e?.message ?? "Rematch failed"),
  });

  const createMut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          name,
          small_blind: Number(sb),
          big_blind: Number(bb),
          buy_in: Number(buyIn),
          max_seats: Number(maxSeats),
          invited_user_ids: Array.from(invited),
        },
      }) as Promise<{ id: string }>,
    onSuccess: (res) => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["poker-tables"] });
      navigate({ to: "/play/$id", params: { id: res.id } });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create table"),
  });

  function toggle(id: string) {
    const n = new Set(invited);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setInvited(n);
  }

  return (
    <CasinoShell>
      <div className="animate-in fade-in duration-500 mx-auto max-w-4xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-display text-3xl font-bold">
              <Spade className="h-7 w-7 text-gold" /> Play
            </h1>
            <p className="text-sm text-muted-foreground">Real-time Poker & Blackjack.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-sm">
              <Coins className="mr-1 inline h-4 w-4 text-gold" />
              <span className="font-semibold">{(wallet.data?.chips ?? 0).toLocaleString()}</span>
              <span className="text-muted-foreground"> chips</span>
            </div>
            <Dialog open={cashierOpen} onOpenChange={setCashierOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="secondary">
                  Cashier
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Cashier</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-gold/30 bg-gradient-to-br from-background/80 to-background/40 p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Wallet balance
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <Coins className="h-5 w-5 text-gold" />
                      <span className="font-display text-3xl font-bold text-gold">
                        {(wallet.data?.chips ?? 0).toLocaleString()}
                      </span>
                      <span className="text-sm text-muted-foreground">chips</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-background/80 to-background/40 p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Locked
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-display text-3xl font-bold text-amber-300">
                        {Number(wallet.data?.locked ?? 0).toLocaleString()}
                      </span>
                      <span className="text-sm text-muted-foreground">chips</span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Awaiting external payment on IOUs owed to you.
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-background/80 to-background/40 p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Available to withdraw
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <Wallet className="h-5 w-5 text-emerald-300" />
                      <span className="font-display text-3xl font-bold text-emerald-300">
                        {Number(wallet.data?.available ?? 0).toLocaleString()}
                      </span>
                      <span className="text-sm text-muted-foreground">chips</span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Balance − Locked. Grows as settlements are confirmed.
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Chips are used for table buy-ins. When you leave a table your remaining stack
                  returns to your wallet.
                </p>
                <div>
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Quick add
                  </Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[50, 100, 150, 200].map((n) => (
                      <Button
                        key={n}
                        type="button"
                        variant={depositAmount === String(n) ? "default" : "outline"}
                        size="sm"
                        onClick={() => setDepositAmount(String(n))}
                      >
                        +{n.toLocaleString()}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label
                    htmlFor="deposit"
                    className="text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    Custom amount
                  </Label>
                  <Input
                    id="deposit"
                    type="number"
                    min={1}
                    max={1000000}
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                  />
                </div>
                {(() => {
                  const locked = Number(wallet.data?.locked ?? 0);
                  const max = Number(wallet.data?.available ?? 0);
                  return (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs uppercase tracking-wide text-emerald-200">
                          Cash out chips
                        </Label>
                        <span className="text-[10px] text-muted-foreground">
                          Max {max.toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Removes chips from your wallet.{" "}
                        {locked > 0
                          ? `${locked.toLocaleString()} chips are locked until pending settlements are confirmed. `
                          : ""}
                        Does not transfer any real money.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={max || undefined}
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          placeholder={max > 0 ? `Up to ${max}` : "No chips to cash out"}
                          disabled={max <= 0}
                        />
                        <Button
                          variant="outline"
                          className="border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10"
                          disabled={
                            withdrawMut.isPending ||
                            max <= 0 ||
                            !Number(withdrawAmount) ||
                            Number(withdrawAmount) > max
                          }
                          onClick={() => {
                            const n = Number(withdrawAmount);
                            if (!n || n <= 0) return;
                            if (n > max) return;
                            if (
                              !window.confirm(
                                `Cash out ${n.toLocaleString()} chips? This removes them from your virtual wallet.`,
                              )
                            )
                              return;
                            withdrawMut.mutate(n);
                          }}
                        >
                          Cash Out
                        </Button>
                      </div>
                    </div>
                  );
                })()}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Recent activity
                    </Label>
                    <span className="text-[10px] text-muted-foreground">Last 25</span>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-md border border-border/60 bg-background/40">
                    {txs.isLoading && (
                      <div className="space-y-2 p-3">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="flex items-center justify-between">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-4 w-16" />
                          </div>
                        ))}
                      </div>
                    )}
                    {txs.data && txs.data.length === 0 && (
                      <div className="p-3 text-xs text-muted-foreground">No transactions yet.</div>
                    )}
                    {txs.data?.map((t: any) => {
                      const amt = Number(t.amount);
                      const label =
                        t.kind === "deposit"
                          ? "Added chips"
                          : t.kind === "buy_in"
                            ? "Table buy-in"
                            : t.kind === "cashout"
                              ? "Left table"
                              : t.kind === "settlement"
                                ? "Settlement"
                                : t.kind === "settlement_confirmed"
                                  ? "Settlement received"
                                  : t.kind === "withdrawal"
                                    ? "Cashed out"
                                    : t.kind === "rebuy"
                                      ? "Rebuy"
                                      : "Adjustment";
                      return (
                        <div
                          key={t.id}
                          className="flex items-center justify-between border-b border-border/40 px-3 py-2 last:border-0"
                        >
                          <div className="min-w-0">
                            <div className="text-sm">{label}</div>
                            {t.note && (
                              <div className="truncate text-[10px] text-muted-foreground">
                                {t.note}
                              </div>
                            )}
                            <div className="text-[10px] text-muted-foreground">
                              {new Date(t.created_at).toLocaleString()}
                            </div>
                          </div>
                          <div className="text-right">
                            <div
                              className={`font-mono text-sm ${amt > 0 ? "text-emerald-400" : amt < 0 ? "text-red-400" : "text-muted-foreground"}`}
                            >
                              {amt > 0 ? "+" : ""}
                              {amt.toLocaleString()}
                            </div>
                            {t.balance_after != null && (
                              <div className="text-[10px] text-muted-foreground">
                                bal {Number(t.balance_after).toLocaleString()}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => topUpMut.mutate(Number(depositAmount))}
                    disabled={topUpMut.isPending || !Number(depositAmount)}
                    className="bg-gold shadow-gold"
                  >
                    {topUpMut.isPending
                      ? "Adding…"
                      : `Add ${Number(depositAmount || 0).toLocaleString()} chips`}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="mb-6">
          {!isAdmin && (
            <div className="rounded-md border border-border/60 bg-background/30 p-3 text-xs text-muted-foreground">
              Only admins can create tables. Ask an admin to invite you to one.
            </div>
          )}
          {isAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                disabled={resetMut.isPending}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Wipe ALL casino games, chats, wallets and settlements? Poker club data is not affected. This cannot be undone.",
                    )
                  )
                    return;
                  if (!window.confirm("Really reset the casino to zero?")) return;
                  resetMut.mutate();
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {resetMut.isPending ? "Resetting…" : "Reset Casino"}
              </Button>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-gold shadow-gold">
                    <Plus className="mr-1 h-4 w-4" /> New Poker Table
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Create a table</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="tname">Name</Label>
                      <Input
                        id="tname"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={80}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="sb">Small blind</Label>
                        <Input
                          id="sb"
                          type="number"
                          step="0.5"
                          min={0.5}
                          value={sb}
                          onChange={(e) => setSb(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="bb">Big blind</Label>
                        <Input
                          id="bb"
                          type="number"
                          step="0.5"
                          min={0.5}
                          value={bb}
                          onChange={(e) => setBb(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="buy">Buy-in (chips)</Label>
                        <Input
                          id="buy"
                          type="number"
                          min={1}
                          value={buyIn}
                          onChange={(e) => setBuyIn(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="ms">Max seats</Label>
                        <Input
                          id="ms"
                          type="number"
                          min={2}
                          max={9}
                          value={maxSeats}
                          onChange={(e) => setMaxSeats(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Invite players</Label>
                      <div className="mt-1 grid gap-1 rounded-md border border-border/60 bg-background/30 p-2 max-h-48 overflow-auto">
                        {(profiles.data ?? []).map((p) => (
                          <label
                            key={p.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-background/40"
                          >
                            <input
                              type="checkbox"
                              checked={invited.has(p.id)}
                              onChange={() => toggle(p.id)}
                            />
                            <span className="text-sm">{formatDisplayName(p.name, p.nickname)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      className="bg-gold shadow-gold"
                      onClick={() => createMut.mutate()}
                      disabled={createMut.isPending}
                    >
                      {createMut.isPending ? "Creating…" : "Create"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog open={bjOpen} onOpenChange={setBjOpen}>
                <DialogTrigger asChild>
                  <Button className="ml-2 bg-gold shadow-gold">
                    <Diamond className="mr-1 h-4 w-4" /> New Blackjack Table
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Create a Blackjack table</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="bjname">Name</Label>
                      <Input
                        id="bjname"
                        value={bjName}
                        onChange={(e) => setBjName(e.target.value)}
                        maxLength={80}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="bjmin">Min bet</Label>
                        <Input
                          id="bjmin"
                          type="number"
                          min={1}
                          value={bjMin}
                          onChange={(e) => setBjMin(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="bjmax">Max bet</Label>
                        <Input
                          id="bjmax"
                          type="number"
                          min={1}
                          value={bjMax}
                          onChange={(e) => setBjMax(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Choose the dealer for this table. Invitees can sit as players and bet from
                      their wallets.
                    </div>
                    <div>
                      <Label>Dealer</Label>
                      <div className="mt-1 grid gap-1 rounded-md border border-border/60 bg-background/30 p-2 max-h-40 overflow-auto">
                        <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-background/40">
                          <input
                            type="radio"
                            name="bjdealer"
                            checked={bjDealer === ""}
                            onChange={() => setBjDealer("")}
                          />
                          <span className="text-sm">Me (admin)</span>
                        </label>
                        {(profiles.data ?? []).map((p) => (
                          <label
                            key={p.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-background/40"
                          >
                            <input
                              type="radio"
                              name="bjdealer"
                              checked={bjDealer === p.id}
                              onChange={() => setBjDealer(p.id)}
                            />
                            <span className="text-sm">{formatDisplayName(p.name, p.nickname)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <Label>Invite players</Label>
                      <div className="mt-1 grid gap-1 rounded-md border border-border/60 bg-background/30 p-2 max-h-48 overflow-auto">
                        {(profiles.data ?? []).map((p) => (
                          <label
                            key={p.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-background/40"
                          >
                            <input
                              type="checkbox"
                              checked={bjInvited.has(p.id)}
                              onChange={() => toggleBj(p.id)}
                            />
                            <span className="text-sm">{formatDisplayName(p.name, p.nickname)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setBjOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      className="bg-gold shadow-gold"
                      onClick={() => createBjMut.mutate()}
                      disabled={createBjMut.isPending}
                    >
                      {createBjMut.isPending ? "Creating…" : "Create"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>

        {(bjTables.data?.length ?? 0) > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 font-display text-lg font-semibold flex items-center gap-2">
              <Diamond className="h-4 w-4 text-gold" /> Blackjack tables
            </h2>
            <div className="grid gap-3">
              {bjTables.data!.map((t: any) => (
                <Link
                  key={t.id}
                  to="/play/bj/$id"
                  params={{ id: t.id }}
                  className="card-felt shadow-card rounded-2xl p-4 block hover:ring-1 hover:ring-gold/40 transition"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-display text-lg font-semibold">{t.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Dealer: {t.host_name} · Bets {t.min_bet}–{t.max_bet}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4" /> {t.seated_count ?? 0}/6
                      </div>
                      <div className="text-[10px] uppercase text-muted-foreground">{t.status}</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3">
          {tables.isLoading && (
            <>
              {[0, 1].map((i) => (
                <div key={i} className="card-felt shadow-card rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-3 w-56" />
                    </div>
                    <Skeleton className="h-8 w-12 rounded-md" />
                  </div>
                </div>
              ))}
            </>
          )}
          {tables.data?.length === 0 && (
            <div className="card-felt shadow-card rounded-2xl p-8 text-center text-muted-foreground">
              No tables yet. Create one to get started.
            </div>
          )}
          {tables.data?.map((t: any) => {
            const chips = wallet.data?.chips ?? 0;
            const buyIn = Number(t.buy_in);
            const short = chips < buyIn ? buyIn - chips : 0;
            return (
              <div
                key={t.id}
                className={`card-felt shadow-card rounded-2xl p-4 transition ${short ? "ring-1 ring-red-500/30" : "hover:ring-1 hover:ring-gold/40"}`}
              >
                <Link to="/play/$id" params={{ id: t.id }} className="block">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-display text-lg font-semibold">{t.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Host: {t.host_name} · Blinds {t.small_blind}/{t.big_blind} · Buy-in{" "}
                        {buyIn.toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-sm">
                        <Users className="h-4 w-4" /> {t.seated_count ?? 0}/{t.max_seats}
                      </div>
                      <div className="text-[10px] uppercase text-muted-foreground">{t.status}</div>
                    </div>
                  </div>
                </Link>
                {short > 0 && (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs text-red-200">
                      <AlertTriangle className="h-4 w-4" />
                      Need <span className="font-semibold">+{short.toLocaleString()}</span> chips to
                      buy in
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(e) => {
                        e.preventDefault();
                        setDepositAmount(String(Math.max(50, Math.ceil(short / 50) * 50)));
                        setCashierOpen(true);
                      }}
                    >
                      Top up
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {((ended.data?.length ?? 0) > 0 || (bjEnded.data?.length ?? 0) > 0) && (
          <div className="mt-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-display text-xl font-semibold">Past games</h2>
              <div className="inline-flex rounded-lg border border-border/60 bg-background/40 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setPastTab("poker")}
                  className={`rounded-md px-3 py-1 font-semibold transition ${pastTab === "poker" ? "bg-gold text-black" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Poker ({ended.data?.length ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setPastTab("blackjack")}
                  className={`rounded-md px-3 py-1 font-semibold transition ${pastTab === "blackjack" ? "bg-gold text-black" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Blackjack ({bjEnded.data?.length ?? 0})
                </button>
              </div>
            </div>
            {pastTab === "poker" && (
              <div className="grid gap-3">
                {(ended.data ?? []).length === 0 && (
                  <div className="card-felt shadow-card rounded-2xl p-6 text-center text-sm text-muted-foreground">
                    No completed poker games yet.
                  </div>
                )}
                {ended.data!.map((t: any) => {
                  const s = t.settlement ?? {};
                  const nets: any[] = s.nets ?? [];
                  const transfers: any[] = s.transfers ?? [];
                  return (
                    <div key={t.id} className="card-felt shadow-card rounded-2xl p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div>
                          <div className="font-display text-lg font-semibold flex items-center gap-2">
                            <Spade className="h-4 w-4 text-gold" /> {t.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Host: {t.host_name} · Ended{" "}
                            {t.ended_at ? new Date(t.ended_at).toLocaleString() : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {meId.data === t.host_id && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-gold/40 text-gold hover:bg-gold/10"
                              onClick={() => rematchPokerMut.mutate(t.id)}
                              disabled={rematchPokerMut.isPending}
                            >
                              <RotateCcw className="mr-1 h-3 w-3" /> Rematch
                            </Button>
                          )}
                          <Link
                            to="/play/$id"
                            params={{ id: t.id }}
                            className="text-xs text-gold hover:underline"
                          >
                            View
                          </Link>
                        </div>
                      </div>
                      {nets.length > 0 && (
                        <div className="mb-2 grid gap-1 text-sm">
                          {nets
                            .sort((a, b) => (b.net ?? 0) - (a.net ?? 0))
                            .map((n, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between rounded border border-border/40 bg-background/30 px-2 py-1"
                              >
                                <span className="truncate">{n.name ?? "Player"}</span>
                                <span
                                  className={
                                    n.net > 0
                                      ? "text-emerald-400"
                                      : n.net < 0
                                        ? "text-red-400"
                                        : "text-muted-foreground"
                                  }
                                >
                                  {n.net > 0 ? "+" : ""}
                                  {Number(n.net).toLocaleString()}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                      {transfers.length > 0 && (
                        <div className="grid gap-1 text-xs text-muted-foreground">
                          <div className="font-semibold text-foreground">Who pays who</div>
                          {transfers.map((tr, i) => (
                            <div key={i}>
                              {tr.from_name ?? "Player"} → {tr.to_name ?? "Player"}:{" "}
                              <span className="text-foreground">
                                {Number(tr.amount).toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {nets.length === 0 && (
                        <div className="text-xs text-muted-foreground">No results recorded.</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {pastTab === "blackjack" && (
              <div className="grid gap-3">
                {(bjEnded.data ?? []).length === 0 && (
                  <div className="card-felt shadow-card rounded-2xl p-6 text-center text-sm text-muted-foreground">
                    No completed blackjack games yet.
                  </div>
                )}
                {(bjEnded.data ?? []).map((t: any) => {
                  const nets: any[] = t.nets ?? [];
                  const dealerNet: number = Number(t.dealer_net ?? 0);
                  return (
                    <div key={t.id} className="card-felt shadow-card rounded-2xl p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div>
                          <div className="font-display text-lg font-semibold flex items-center gap-2">
                            <Diamond className="h-4 w-4 text-gold" /> {t.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Dealer: {t.host_name} · Bets {t.min_bet}–{t.max_bet} · Ended{" "}
                            {t.ended_at ? new Date(t.ended_at).toLocaleString() : ""}
                          </div>
                        </div>
                        {meId.data === t.host_id && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-gold/40 text-gold hover:bg-gold/10"
                            onClick={() => rematchBjMut.mutate(t.id)}
                            disabled={rematchBjMut.isPending}
                          >
                            <RotateCcw className="mr-1 h-3 w-3" /> Rematch
                          </Button>
                        )}
                      </div>
                      {nets.length > 0 ? (
                        <div className="grid gap-1 text-sm">
                          {nets.map((n) => (
                            <div
                              key={n.user_id}
                              className="flex items-center justify-between rounded border border-border/40 bg-background/30 px-2 py-1"
                            >
                              <span className="truncate">{n.name}</span>
                              <span
                                className={
                                  n.net > 0
                                    ? "text-emerald-400"
                                    : n.net < 0
                                      ? "text-red-400"
                                      : "text-muted-foreground"
                                }
                              >
                                {n.net > 0 ? "+" : ""}
                                {Number(n.net).toLocaleString()}
                              </span>
                            </div>
                          ))}
                          <div className="mt-1 flex items-center justify-between rounded border border-amber-400/30 bg-amber-500/10 px-2 py-1">
                            <span className="truncate font-semibold text-amber-200">
                              {t.host_name} (Dealer)
                            </span>
                            <span
                              className={
                                dealerNet > 0
                                  ? "text-emerald-400"
                                  : dealerNet < 0
                                    ? "text-red-400"
                                    : "text-muted-foreground"
                              }
                            >
                              {dealerNet > 0 ? "+" : ""}
                              {dealerNet.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">No hands were played.</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </CasinoShell>
  );
}
