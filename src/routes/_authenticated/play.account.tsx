import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CasinoShell } from "@/components/CasinoShell";
import { Coins, Wallet, Users, TrendingUp } from "lucide-react";
import { getCasinoAccount } from "@/lib/poker-table.functions";
import { formatDisplayName } from "@/lib/poker";

export const Route = createFileRoute("/_authenticated/play/account")({
  head: () => ({ meta: [{ title: "Casino Account — Poker Club" }] }),
  component: CasinoAccountPage,
  errorComponent: ({ error }) => (
    <CasinoShell>
      <div role="alert" className="text-sm text-red-400">
        Failed to load: {error.message}
      </div>
    </CasinoShell>
  ),
  notFoundComponent: () => (
    <CasinoShell>
      <div className="text-sm text-muted-foreground">Not found.</div>
    </CasinoShell>
  ),
});

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function CasinoAccountPage() {
  const load = useServerFn(getCasinoAccount);

  const q = useQuery({
    queryKey: ["casino-account"],
    queryFn: () => load() as any,
  });

  if (q.isLoading || !q.data) {
    return (
      <CasinoShell>
        <div className="text-sm text-muted-foreground">Loading…</div>
      </CasinoShell>
    );
  }

  const data = q.data as any;
  const me = data.me ?? { chips: 0, total_deposits: 0, total_withdrawals: 0, total_pl: 0 };
  const totalPL = Number(me.total_pl ?? 0);

  const otherPlayers = (data.players ?? []).filter((p: any) => p.user_id !== data.user_id);

  return (
    <CasinoShell>
      <div className="animate-in fade-in duration-500 mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-display text-3xl font-bold">
              <Wallet className="h-7 w-7 text-gold" /> Casino Account
            </h1>
            <p className="text-sm text-muted-foreground">
              Wallet spans poker & blackjack. Track deposits, debts and settle payments made off the
              platform.
            </p>
          </div>
        </div>

        {/* Snapshot */}
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          <SnapshotCard
            label="Chip balance"
            value={fmt(me.chips)}
            accent="gold"
            icon={<Coins className="h-4 w-4 text-gold" />}
          />
          <SnapshotCard
            label="Total P&L"
            value={`${totalPL >= 0 ? "+" : ""}${fmt(totalPL)}`}
            accent={totalPL > 0 ? "green" : totalPL < 0 ? "red" : "muted"}
            icon={
              <TrendingUp
                className={`h-4 w-4 ${totalPL >= 0 ? "text-emerald-400" : "text-red-400"}`}
              />
            }
          />
        </div>

        <div className="mb-8 text-xs text-muted-foreground">
          Outstanding IOUs from closed sessions live in the{" "}
          <Link to="/play/settlements" className="text-gold underline-offset-2 hover:underline">
            Settlements
          </Link>{" "}
          tab.
        </div>

        {/* Deposit history */}
        <section className="mb-8">
          <h2 className="mb-2 font-display text-lg font-semibold">Your deposit history</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Chip buy-ins at the Cashier. These are not debts — real IOUs appear above once a session
            is closed.
          </p>
          <div className="card-felt shadow-card overflow-hidden rounded-2xl">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-border/50 px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              <div>When</div>
              <div className="text-right">Amount</div>
              <div className="text-right">Balance</div>
            </div>
            {data.my_transactions.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">No deposits yet.</div>
            )}
            {data.my_transactions.map((t: any) => {
              const amt = Number(t.amount);
              return (
                <div
                  key={t.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border/30 px-4 py-2 text-sm transition-colors duration-150 last:border-0 hover:bg-background/30"
                >
                  <div className="min-w-0">
                    <div>{fmtDate(t.created_at)}</div>
                    {t.note && (
                      <div className="truncate text-[11px] text-muted-foreground">{t.note}</div>
                    )}
                  </div>
                  <div
                    className={`text-right font-mono ${amt > 0 ? "text-emerald-400" : amt < 0 ? "text-red-400" : ""}`}
                  >
                    {amt > 0 ? "+" : ""}
                    {fmt(amt)}
                  </div>
                  <div className="text-right font-mono text-muted-foreground">
                    {t.balance_after != null ? fmt(Number(t.balance_after)) : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Player balances */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold">
            <Users className="h-4 w-4 text-gold" /> All player wallets
          </h2>
          <div className="card-felt shadow-card overflow-hidden rounded-2xl">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-border/50 px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              <div>Player</div>
              <div className="text-right">Chips</div>
              <div className="text-right">Deposits</div>
            </div>
            {otherPlayers.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No other players yet.
              </div>
            )}
            {otherPlayers.map((p: any) => (
              <div
                key={p.user_id}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border/30 px-4 py-2 text-sm transition-colors duration-150 last:border-0 hover:bg-background/30"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-background/60 grid place-items-center text-[10px] text-muted-foreground">
                      {(p.nickname || p.name || "?").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="truncate">{formatDisplayName(p.name, p.nickname)}</span>
                </div>
                <div className="text-right font-mono">{fmt(p.chips)}</div>
                <div className="text-right font-mono text-muted-foreground">
                  {fmt(p.total_deposits)}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            <strong>Chips</strong>: current wallet balance. <strong>Deposits</strong>: total Cashier
            buy-ins.
          </p>
        </section>
      </div>
    </CasinoShell>
  );
}

function SnapshotCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent: "gold" | "green" | "red" | "muted";
  icon: React.ReactNode;
}) {
  const tone =
    accent === "gold"
      ? "text-gold"
      : accent === "green"
        ? "text-emerald-400"
        : accent === "red"
          ? "text-red-400"
          : "text-muted-foreground";
  return (
    <div className="card-felt shadow-card rounded-2xl p-4 transition-colors duration-200 hover:border-gold/25">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div className={`mt-2 font-display text-3xl font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}
