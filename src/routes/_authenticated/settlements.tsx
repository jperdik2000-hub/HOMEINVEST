import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney, formatEUDateTime } from "@/lib/poker";
import { ArrowRight, Scale } from "lucide-react";
import { PlayerLink } from "@/components/PlayerLink";

export const Route = createFileRoute("/_authenticated/settlements")({
  head: () => ({ meta: [{ title: "Settlements — Poker Club" }] }),
  component: SettlementsPage,
});

type Transfer = {
  from: string;
  to: string;
  from_user_id: string | null;
  to_user_id: string | null;
  amount: number;
};

function optimize(nets: { name: string; user_id: string | null; net: number }[]): Transfer[] {
  const eps = 0.005;
  const debtors = nets
    .filter((p) => p.net < -eps)
    .map((p) => ({ ...p, net: -p.net }))
    .sort((a, b) => b.net - a.net);
  const creditors = nets
    .filter((p) => p.net > eps)
    .map((p) => ({ ...p }))
    .sort((a, b) => b.net - a.net);
  const transfers: Transfer[] = [];
  let i = 0,
    j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].net, creditors[j].net);
    transfers.push({
      from: debtors[i].name,
      to: creditors[j].name,
      from_user_id: debtors[i].user_id,
      to_user_id: creditors[j].user_id,
      amount: pay,
    });
    debtors[i].net -= pay;
    creditors[j].net -= pay;
    if (debtors[i].net < eps) i++;
    if (creditors[j].net < eps) j++;
  }
  return transfers;
}

function SettlementsPage() {
  const q = useQuery({
    queryKey: ["settlements-data"],
    queryFn: async () => {
      const { data: nights, error: e1 } = await supabase
        .from("poker_nights")
        .select("*")
        .eq("status", "completed")
        .order("starts_at", { ascending: false });
      if (e1) throw e1;
      const ids = (nights ?? []).map((n) => n.id);
      if (!ids.length) return [];
      const { data: results, error: e2 } = await supabase
        .from("player_results")
        .select("*")
        .in("night_id", ids);
      if (e2) throw e2;
      return (nights ?? []).map((n) => {
        const rows = (results ?? []).filter((r) => r.night_id === n.id);
        const nets = rows.map((r) => ({
          name: r.player_name,
          user_id: r.user_id,
          net: Number(r.net_result),
        }));
        return { night: n, nets, transfers: optimize(nets) };
      });
    },
  });

  return (
    <AppShell>
      <div className="animate-in fade-in duration-500 mb-6">
        <h1 className="font-display text-3xl font-bold md:text-4xl">
          <Scale className="mr-2 inline h-7 w-7 text-gold" />
          Settlements
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fewest transfers needed to settle up each completed night.
        </p>
      </div>

      {q.isLoading && <div className="text-muted-foreground">Loading…</div>}
      {q.data && q.data.length === 0 && (
        <div className="card-felt rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          No completed nights yet.
        </div>
      )}

      <div className="animate-in fade-in duration-500 space-y-4">
        {q.data?.map(({ night, nets, transfers }) => {
          const imbalance = nets.reduce((s, p) => s + p.net, 0);
          return (
            <div
              key={night.id}
              className="card-felt shadow-card rounded-2xl p-5 transition-colors duration-200 hover:border-gold/25"
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    to="/nights/$id"
                    params={{ id: night.id }}
                    className="font-display text-xl font-semibold hover:text-gold"
                  >
                    {night.title}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {formatEUDateTime(night.starts_at)}
                    {night.location ? ` · ${night.location}` : ""}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {transfers.length} transfer{transfers.length === 1 ? "" : "s"}
                </div>
              </div>

              {Math.abs(imbalance) > 0.5 && (
                <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  Table doesn't balance ({formatMoney(imbalance, night.currency)}). Settlement is
                  approximate.
                </div>
              )}

              {transfers.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/60 p-3 text-center text-sm text-muted-foreground">
                  Everyone broke even.
                </div>
              ) : (
                <ol className="space-y-1 text-sm">
                  {transfers.map((t, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2 transition-colors duration-150 hover:bg-background/50"
                    >
                      <div className="flex items-center gap-2">
                        <PlayerLink
                          userId={t.from_user_id}
                          name={t.from}
                          className="text-red-400"
                        />
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <PlayerLink
                          userId={t.to_user_id}
                          name={t.to}
                          className="text-emerald-400"
                        />
                      </div>
                      <div className="font-mono tabular-nums text-gold">
                        {formatMoney(t.amount, night.currency)}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
