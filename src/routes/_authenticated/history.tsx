import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PlayerLink } from "@/components/PlayerLink";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney, formatEUDateTime, AWARDS } from "@/lib/poker";
import { History, Trophy, MessageSquare } from "lucide-react";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({ meta: [{ title: "Game History" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  const q = useQuery({
    queryKey: ["history", me],
    enabled: !!me,
    queryFn: async () => {
      const uid = me!;
      // 1) All player_result rows for me (games I played in)
      const { data: mine, error: e1 } = await supabase
        .from("player_results")
        .select("*")
        .eq("user_id", uid);
      if (e1) throw e1;

      // 2) All nights I hosted
      const { data: hosted, error: e2 } = await supabase
        .from("poker_nights")
        .select("*")
        .eq("host_id", uid);
      if (e2) throw e2;

      const nightIds = Array.from(
        new Set([...(mine ?? []).map((r) => r.night_id), ...(hosted ?? []).map((n) => n.id)]),
      );
      if (nightIds.length === 0) return [];

      const { data: nights, error: e3 } = await supabase
        .from("poker_nights")
        .select("*")
        .in("id", nightIds)
        .eq("status", "completed")
        .order("starts_at", { ascending: false });
      if (e3) throw e3;

      const { data: allResults, error: e4 } = await supabase
        .from("player_results")
        .select("*")
        .in(
          "night_id",
          (nights ?? []).map((n) => n.id),
        );
      if (e4) throw e4;

      return (nights ?? []).map((n) => ({
        night: n,
        results: (allResults ?? [])
          .filter((r) => r.night_id === n.id)
          .sort((a, b) => (a.final_rank ?? 999) - (b.final_rank ?? 999)),
        mine: (allResults ?? []).find((r) => r.night_id === n.id && r.user_id === me) ?? null,
      }));
    },
  });

  return (
    <AppShell>
      <div className="animate-in fade-in duration-500 mb-6">
        <h1 className="font-display text-3xl font-bold md:text-4xl">
          <History className="mr-2 inline h-7 w-7 text-gold" />
          Game history
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Outcomes of every completed night you played in or hosted.
        </p>
      </div>

      {q.isLoading && <div className="text-muted-foreground">Loading…</div>}
      {q.data && q.data.length === 0 && (
        <div className="card-felt rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          No completed games yet. Once a night is finalized with results, it will show up here.
        </div>
      )}

      <div className="animate-in fade-in duration-500 space-y-4">
        {q.data?.map(({ night, results, mine }) => (
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
                <Link
                  to="/nights/$id/chat"
                  params={{ id: night.id }}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2.5 py-1 text-xs text-muted-foreground hover:border-gold/60 hover:text-gold"
                >
                  <MessageSquare className="h-3.5 w-3.5" /> See game chat
                </Link>
              </div>
              {mine && (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Your result
                  </div>
                  <div
                    className={
                      "font-mono text-lg " +
                      (Number(mine.net_result) >= 0 ? "text-emerald-400" : "text-red-400")
                    }
                  >
                    {formatMoney(Number(mine.net_result), night.currency)}
                  </div>
                  {mine.final_rank && <div className="text-xs text-gold">#{mine.final_rank}</div>}
                </div>
              )}
            </div>

            <div className="mb-2 flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
              <Trophy className="h-3.5 w-3.5 text-gold" /> Full table
            </div>
            <ol className="space-y-1 text-sm">
              {results.map((r, i) => (
                <li
                  key={r.id}
                  className={
                    "flex items-center justify-between rounded-md px-3 py-1.5 " +
                    (r.user_id === me ? "bg-gold/10" : "bg-background/30")
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className="text-gold">#{r.final_rank ?? i + 1}</span>
                    <PlayerLink userId={r.user_id} name={r.player_name} />
                    {r.award && (
                      <span className="text-xs text-muted-foreground">
                        · {AWARDS.find((a) => a.value === r.award)?.label}
                      </span>
                    )}
                  </div>
                  <div
                    className={
                      "font-mono " +
                      (Number(r.net_result) >= 0 ? "text-emerald-400" : "text-red-400")
                    }
                  >
                    {formatMoney(Number(r.net_result), night.currency)}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
