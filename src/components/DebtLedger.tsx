import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/poker";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowRight, HandCoins, RefreshCw, Check } from "lucide-react";
import { PlayerLink } from "@/components/PlayerLink";

type Transfer = { from: string; to: string; from_user_id: string | null; to_user_id: string | null; amount: number };

function optimize(
  nets: { name: string; user_id: string | null; net: number }[],
): Transfer[] {
  const eps = 0.005;
  const debtors = nets.filter((p) => p.net < -eps).map((p) => ({ ...p, net: -p.net })).sort((a, b) => b.net - a.net);
  const creditors = nets.filter((p) => p.net > eps).map((p) => ({ ...p })).sort((a, b) => b.net - a.net);
  const transfers: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].net, creditors[j].net);
    transfers.push({
      from: debtors[i].name, to: creditors[j].name,
      from_user_id: debtors[i].user_id, to_user_id: creditors[j].user_id,
      amount: Math.round(pay * 100) / 100,
    });
    debtors[i].net -= pay;
    creditors[j].net -= pay;
    if (debtors[i].net < eps) i++;
    if (creditors[j].net < eps) j++;
  }
  return transfers;
}

export function DebtLedger({ nightId, currency, isHost, currentUserId }: {
  nightId: string; currency: string; isHost: boolean; currentUserId: string | null;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const results = useQuery({
    queryKey: ["night-results", nightId],
    queryFn: async () => (await supabase.from("player_results").select("*").eq("night_id", nightId)).data ?? [],
  });
  const ledger = useQuery({
    queryKey: ["settlement-payments", nightId],
    queryFn: async () => (await supabase.from("settlement_payments").select("*").eq("night_id", nightId).order("created_at")).data ?? [],
  });

  const suggested = useMemo(() => {
    const nets = (results.data ?? []).map((r: any) => ({
      name: r.player_name, user_id: r.user_id, net: Number(r.net_result),
    }));
    return optimize(nets);
  }, [results.data]);

  const imbalance = useMemo(
    () => (results.data ?? []).reduce((s: number, r: any) => s + Number(r.net_result), 0),
    [results.data],
  );

  async function generate() {
    if (!isHost) return;
    setBusy(true);
    try {
      await supabase.from("settlement_payments").delete().eq("night_id", nightId);
      if (suggested.length) {
        const rows = suggested.map((t) => ({
          night_id: nightId,
          from_user_id: t.from_user_id, to_user_id: t.to_user_id,
          from_name: t.from, to_name: t.to,
          amount: t.amount,
        }));
        const { error } = await supabase.from("settlement_payments").insert(rows);
        if (error) throw error;
      }
      toast.success("Debt ledger generated");
      qc.invalidateQueries({ queryKey: ["settlement-payments", nightId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally { setBusy(false); }
  }

  async function togglePaid(row: any) {
    const canToggle = isHost || row.from_user_id === currentUserId || row.to_user_id === currentUserId;
    if (!canToggle) { toast.error("Only the payer, payee or host can mark this."); return; }
    const next = !row.paid;
    const { error } = await supabase.from("settlement_payments")
      .update({ paid: next, paid_at: next ? new Date().toISOString() : null })
      .eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["settlement-payments", nightId] });
  }

  const rows = ledger.data ?? [];
  const allPaid = rows.length > 0 && rows.every((r: any) => r.paid);

  return (
    <div className="card-felt shadow-card rounded-2xl p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="font-display text-lg font-semibold">
          <HandCoins className="mr-1 inline h-4 w-4 text-gold" />
          Debt ledger
        </div>
        {isHost && (
          <Button size="sm" variant="outline" onClick={generate} disabled={busy || (results.data ?? []).length === 0}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            {rows.length ? "Regenerate" : "Generate from results"}
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Suggested transfers to settle up. Money is settled outside the app (bank transfer / cash) —
        just tick them off as they're paid.
      </p>

      {Math.abs(imbalance) > 0.5 && (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Results don't balance ({formatMoney(imbalance, currency)}). Ledger is approximate.
        </div>
      )}

      {rows.length === 0 ? (
        (results.data ?? []).length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 p-3 text-center text-sm text-muted-foreground">
            Log results first to compute the debt ledger.
          </div>
        ) : suggested.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 p-3 text-center text-sm text-muted-foreground">
            Everyone broke even — nothing to settle.
          </div>
        ) : (
          <div>
            <div className="mb-2 text-xs text-muted-foreground">Preview:</div>
            <ol className="space-y-1 text-sm">
              {suggested.map((t, i) => (
                  <li key={i} className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <PlayerLink userId={t.from_user_id} name={t.from} className="text-red-400" />
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <PlayerLink userId={t.to_user_id} name={t.to} className="text-emerald-400" />
                  </div>
                  <div className="font-mono text-gold">{formatMoney(t.amount, currency)}</div>
                </li>
              ))}
            </ol>
          </div>
        )
      ) : (
        <>
          <ol className="space-y-1 text-sm">
            {rows.map((r: any) => (
              <li key={r.id} className={"flex items-center justify-between rounded-md px-3 py-2 " + (r.paid ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-background/30")}>
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => togglePaid(r)}
                    aria-label={r.paid ? "Mark unpaid" : "Mark paid"}
                    className={"flex h-5 w-5 shrink-0 items-center justify-center rounded border " + (r.paid ? "border-emerald-500 bg-emerald-500 text-black" : "border-border/60 hover:border-gold")}
                  >
                    {r.paid && <Check className="h-3.5 w-3.5" />}
                  </button>
                  <PlayerLink userId={r.from_user_id} name={r.from_name} className={r.paid ? "text-muted-foreground line-through" : "text-red-400"} />
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <PlayerLink userId={r.to_user_id} name={r.to_name} className={r.paid ? "text-muted-foreground line-through" : "text-emerald-400"} />
                </div>
                <div className={"font-mono " + (r.paid ? "text-muted-foreground line-through" : "text-gold")}>
                  {formatMoney(Number(r.amount), currency)}
                </div>
              </li>
            ))}
          </ol>
          {allPaid && (
            <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-center text-xs text-emerald-300">
              All settled up 🎉
            </div>
          )}
        </>
      )}
    </div>
  );
}