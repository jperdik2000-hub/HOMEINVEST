import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Coffee, Play } from "lucide-react";
import { activeBreakFrom, breakCountdown } from "@/lib/tv-shared";

const PRESETS = [5, 10, 15, 20];

/**
 * Break control + live countdown. Everyone with access to the night sees the
 * banner; hosts/managers get the minute picker. Backed by the shared
 * `game_events` log so the app, other players and the TV all stay in sync.
 */
export function GameBreakBanner({ nightId, canManage }: { nightId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const eventsQ = useQuery({
    queryKey: ["break-events", nightId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("game_events")
        .select("id, event_type, metadata, created_at")
        .eq("night_id", nightId)
        .in("event_type", ["break_start", "break_end"])
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 20000,
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const ch = supabase
      .channel(`break-events-${nightId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "game_events", filter: `night_id=eq.${nightId}` },
        () => qc.invalidateQueries({ queryKey: ["break-events", nightId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [nightId, qc]);

  const current = useMemo(
    () =>
      activeBreakFrom(
        (eventsQ.data ?? []).map((e: any) => ({
          type: e.event_type as string,
          metadata: (e.metadata ?? {}) as Record<string, any>,
          createdAt: e.created_at as string,
        })),
        now,
      ),
    [eventsQ.data, now],
  );

  async function startBreak(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) return toast.error("Enter 1–240 minutes");
    setBusy(true);
    const until = new Date(Date.now() + minutes * 60_000).toISOString();
    const { error } = await supabase.from("game_events").insert({
      night_id: nightId,
      event_type: "break_start",
      amount: 0,
      metadata: { minutes, until } as never,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setCustom("");
    toast.success(`Break started — ${minutes} min`);
    qc.invalidateQueries({ queryKey: ["break-events", nightId] });
  }

  async function endBreak() {
    setBusy(true);
    const { error } = await supabase
      .from("game_events")
      .insert({ night_id: nightId, event_type: "break_end", amount: 0, metadata: {} as never });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Break ended");
    qc.invalidateQueries({ queryKey: ["break-events", nightId] });
  }

  if (!current && !canManage) return null;

  return (
    <div className="card-felt mb-6 grid gap-3 rounded-2xl p-4">
      {current ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gold/20 text-gold">
              <Coffee className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">On break</div>
              <div className="font-display text-3xl font-black tabular-nums text-gold">
                {breakCountdown(current.until, now)}
              </div>
            </div>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => startBreak(current.minutes || 5)}>
                Restart {current.minutes || 5} min
              </Button>
              <Button size="sm" className="bg-emerald-500 text-white hover:bg-emerald-500/90" disabled={busy} onClick={endBreak}>
                <Play className="mr-1 h-4 w-4" />Resume play
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-1 flex items-center gap-2 text-sm font-semibold">
            <Coffee className="h-4 w-4 text-gold" />Call a break
          </div>
          {PRESETS.map((m) => (
            <Button key={m} variant="outline" size="sm" disabled={busy} onClick={() => startBreak(m)}>
              {m} min
            </Button>
          ))}
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            inputMode="numeric"
            placeholder="Minutes"
            className="w-[110px]"
          />
          <Button size="sm" disabled={busy || !custom} onClick={() => startBreak(Number(custom))}>
            Start
          </Button>
        </div>
      )}
      {current && (
        <div className="text-xs text-muted-foreground">
          Shown live to everyone on this game and on the paired TV display.
        </div>
      )}
    </div>
  );
}
