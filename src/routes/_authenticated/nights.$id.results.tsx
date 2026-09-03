import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useState } from "react";
import { AWARDS, fetchProfiles, formatMoney, formatDisplayName } from "@/lib/poker";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { notifyResultsPosted } from "@/lib/push.functions";
import { isTournament, payoutForPlace, prizePool, type TournamentEntry } from "@/lib/tournament";

type Row = {
  key: string;
  user_id: string | null;
  player_name: string;
  buy_in: string;
  rebuys: string;
  cash_out: string;
  award: string;
  /** Finishing place — tournaments only (rank comes from the bust order). */
  place?: number | null;
};

export const Route = createFileRoute("/_authenticated/nights/$id/results")({
  head: () => ({ meta: [{ title: "Log Results — Poker Club" }] }),
  component: LogResults,
});

function LogResults() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });
  const notifyResults = useServerFn(notifyResultsPosted);

  const night = useQuery({
    queryKey: ["night", id],
    queryFn: async () =>
      (await supabase.from("poker_nights").select("*").eq("id", id).single()).data,
  });
  const existing = useQuery({
    queryKey: ["night-results", id],
    queryFn: async () =>
      (await supabase.from("player_results").select("*").eq("night_id", id)).data ?? [],
  });
  const isTourney = isTournament(night.data as any);
  const entries = useQuery({
    queryKey: ["tournament-entries", id],
    enabled: isTourney,
    queryFn: async () =>
      ((await supabase.from("tournament_entries").select("*").eq("night_id", id)).data ??
        []) as unknown as TournamentEntry[],
  });

  useEffect(() => {
    if (existing.data && rows.length === 0) {
      if (existing.data.length) {
        setRows(
          existing.data.map((r: any) => ({
            key: r.id,
            user_id: r.user_id,
            player_name: r.player_name,
            buy_in: String(r.buy_in),
            rebuys: String(r.rebuys),
            cash_out: String(r.cash_out),
            award: r.award ?? "",
          })),
        );
      } else if (isTourney && entries.data?.length) {
        // Tournament: money in = buy-ins + re-buys + add-ons, money out = prize
        // for the finishing place. Rank is the recorded place.
        const n: any = night.data;
        const pool = prizePool(n, entries.data);
        const ordered = [...entries.data].sort((a, b) => (a.place ?? 9999) - (b.place ?? 9999));
        setRows(
          ordered.map((e) => ({
            key: e.id,
            user_id: e.user_id,
            player_name: e.player_name,
            buy_in: String((e.buy_ins || 0) * Number(n?.buy_in || 0)),
            rebuys: String(
              (e.rebuys || 0) * Number(n?.rebuy_amount || 0) +
                (e.addons || 0) * Number(n?.addon_amount || 0),
            ),
            cash_out: String(payoutForPlace(pool, n?.payout_split, e.place)),
            award: e.place === 1 ? "champion" : "",
            place: e.place ?? null,
          })),
        );
      } else {
        setRows([blankRow(night.data?.buy_in ?? 0)]);
      }
    }
  }, [existing.data, night.data, entries.data, isTourney]); // eslint-disable-line react-hooks/exhaustive-deps

  function blankRow(defaultBuy: number): Row {
    return {
      key: crypto.randomUUID(),
      user_id: null,
      player_name: "",
      buy_in: String(defaultBuy),
      rebuys: "0",
      cash_out: "0",
      award: "",
    };
  }

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    setLoading(true);
    try {
      // sort by net desc for ranking
      const withNet = rows
        .map((r) => ({
          ...r,
          net: (Number(r.cash_out) || 0) - ((Number(r.buy_in) || 0) + (Number(r.rebuys) || 0)),
        }))
        .filter((r) => r.player_name.trim().length > 0);
      const sorted = isTourney
        ? [...withNet].sort((a, b) => (a.place ?? 9999) - (b.place ?? 9999))
        : [...withNet].sort((a, b) => b.net - a.net);
      const rankByKey = new Map(
        isTourney && withNet.every((r) => r.place != null)
          ? withNet.map((r) => [r.key, r.place as number] as const)
          : sorted.map((r, i) => [r.key, i + 1] as const),
      );

      // wipe existing then insert
      await supabase.from("player_results").delete().eq("night_id", id);
      const payload = withNet.map((r) => ({
        night_id: id,
        user_id: r.user_id,
        player_name: r.player_name.trim(),
        buy_in: Number(r.buy_in) || 0,
        rebuys: Number(r.rebuys) || 0,
        cash_out: Number(r.cash_out) || 0,
        final_rank: rankByKey.get(r.key),
        award: r.award || null,
      }));
      if (payload.length) {
        const { error } = await supabase.from("player_results").insert(payload);
        if (error) throw error;
      }
      await supabase.from("poker_nights").update({ status: "completed" }).eq("id", id);
      try {
        await notifyResults({ data: { nightId: id } });
      } catch (pushErr) {
        console.warn("push notify failed", pushErr);
      }
      toast.success("Results saved!");
      navigate({ to: "/nights/$id", params: { id } });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  const currency = night.data?.currency ?? "USD";
  const totals = rows.reduce(
    (s, r) => s + ((Number(r.cash_out) || 0) - ((Number(r.buy_in) || 0) + (Number(r.rebuys) || 0))),
    0,
  );

  return (
    <AppShell>
      <div className="animate-in fade-in duration-500 mx-auto max-w-4xl">
        <h1 className="font-display text-3xl font-bold">Log Results</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {isTourney
            ? "Pre-filled from the tournament: entries, re-buys and prize money per finishing place. Adjust anything before saving."
            : "Enter each player's buy-in, re-buys and cash-out. Ranking is calculated automatically."}
        </p>

        <div className="card-felt shadow-card rounded-2xl p-5">
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={r.key} className="rounded-lg border border-border/60 bg-background/30 p-3">
                <div className="grid gap-2 sm:grid-cols-[1.5fr_1fr_1fr_1fr_1.2fr_auto] sm:items-end">
                  <div>
                    <Label className="text-xs">Player</Label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                      value={r.user_id ?? "__custom"}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__custom") update(i, { user_id: null });
                        else {
                          const p = profiles.data?.find((x) => x.id === v);
                          update(i, {
                            user_id: v,
                            player_name: p ? formatDisplayName(p.name, p.nickname) : r.player_name,
                          });
                        }
                      }}
                    >
                      <option value="__custom">Custom name…</option>
                      {(profiles.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {formatDisplayName(p.name, p.nickname)}
                        </option>
                      ))}
                    </select>
                    {r.user_id === null && (
                      <Input
                        className="mt-1"
                        placeholder="Name"
                        value={r.player_name}
                        onChange={(e) => update(i, { player_name: e.target.value })}
                      />
                    )}
                  </div>
                  <div>
                    <Label className="text-xs">Buy-in</Label>
                    <Input
                      type="number"
                      value={r.buy_in}
                      onChange={(e) => update(i, { buy_in: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Re-buys</Label>
                    <Input
                      type="number"
                      value={r.rebuys}
                      onChange={(e) => update(i, { rebuys: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Cash-out</Label>
                    <Input
                      type="number"
                      value={r.cash_out}
                      onChange={(e) => update(i, { cash_out: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Award</Label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                      value={r.award}
                      onChange={(e) => update(i, { award: e.target.value })}
                    >
                      <option value="">—</option>
                      {AWARDS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 text-right text-xs text-muted-foreground">
                  {isTourney && r.place != null && (
                    <span className="mr-2 text-gold">Finished #{r.place}</span>
                  )}
                  Net:{" "}
                  <span
                    className={
                      (Number(r.cash_out) || 0) -
                        ((Number(r.buy_in) || 0) + (Number(r.rebuys) || 0)) >=
                      0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }
                  >
                    {formatMoney(
                      (Number(r.cash_out) || 0) -
                        ((Number(r.buy_in) || 0) + (Number(r.rebuys) || 0)),
                      currency,
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRows((rs) => [...rs, blankRow(Number(night.data?.buy_in ?? 0))])}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add player
            </Button>
            <div className="text-sm text-muted-foreground">
              Table balance:{" "}
              <span className={totals === 0 ? "text-emerald-400" : "text-amber-400"}>
                {formatMoney(totals, currency)}
              </span>
              {totals !== 0 && <span className="ml-1 text-xs">(should be 0)</span>}
            </div>
          </div>

          <Button className="mt-4 w-full bg-gold shadow-gold" onClick={save} disabled={loading}>
            {loading ? "Saving…" : "Save results"}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
