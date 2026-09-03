import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RotateCcw,
  Trophy,
  Users,
  Coins,
  Skull,
  Plus,
  Undo2,
} from "lucide-react";
import { formatMoney } from "@/lib/poker";
import { PlayerLink } from "@/components/PlayerLink";
import { notifyTournament } from "@/lib/tournament.functions";
import {
  averageStack,
  formatBlinds,
  formatClock,
  investedBy,
  levelAt,
  payoutForPlace,
  payoutsForPool,
  prizePool,
  secondsLeft,
  type BlindLevel,
  type TournamentEntry,
} from "@/lib/tournament";

type NightRow = {
  id: string;
  currency: string;
  buy_in: number;
  status: string;
  starting_stack: number;
  rebuy_amount: number;
  rebuy_chips: number;
  addon_amount: number;
  addon_chips: number;
  level_minutes: number;
  blind_levels: BlindLevel[];
  payout_split: { place: number; pct: number }[];
  current_level: number;
  level_started_at: string | null;
  clock_paused_at: string | null;
  tournament_status: "not_started" | "running" | "finished";
};

export function TournamentPanel({
  night,
  canManage,
  attendingRsvps,
  profiles,
}: {
  night: NightRow;
  canManage: boolean;
  attendingRsvps: any[];
  profiles: any[];
}) {
  const qc = useQueryClient();
  const nightId = night.id;
  const sendPush = useServerFn(notifyTournament);
  const [now, setNow] = useState(() => Date.now());
  const [addPick, setAddPick] = useState("");
  const [walkinName, setWalkinName] = useState("");
  const [bustPick, setBustPick] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const entriesQ = useQuery({
    queryKey: ["tournament-entries", nightId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_entries")
        .select("*")
        .eq("night_id", nightId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TournamentEntry[];
    },
    refetchInterval: 5000,
  });

  // Live updates so every phone at the table follows the clock and knockouts.
  useEffect(() => {
    const ch = supabase
      .channel(`tournament-${nightId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_entries", filter: `night_id=eq.${nightId}` }, () => {
        qc.invalidateQueries({ queryKey: ["tournament-entries", nightId] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "poker_nights", filter: `id=eq.${nightId}` }, () => {
        qc.invalidateQueries({ queryKey: ["night", nightId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [nightId, qc]);

  const entries = entriesQ.data ?? [];
  const alive = entries.filter((e) => e.place == null);
  const busted = entries.filter((e) => e.place != null).sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
  const pool = prizePool(night, entries);
  const payouts = payoutsForPool(pool, night.payout_split);
  const level = night.current_level || 0;
  const cur = level > 0 ? levelAt(night, level) : null;
  const next = levelAt(night, level + 1);
  const left = night.tournament_status === "running" ? secondsLeft(night, now) : 0;
  const paused = !!night.clock_paused_at;
  const expired = night.tournament_status === "running" && left <= 0;

  const profMap = useMemo(() => new Map(profiles.map((p: any) => [p.id, p])), [profiles]);

  const candidates = useMemo(() => {
    const taken = new Set(entries.map((e) => e.user_id).filter(Boolean) as string[]);
    return attendingRsvps
      .map((r: any) => {
        const p = r.user_id ? profMap.get(r.user_id) : null;
        return {
          userId: (r.user_id as string | null) ?? null,
          name: (p?.nickname || p?.name || r.name || r.email || "Player") as string,
        };
      })
      .filter((c) => c.userId && !taken.has(c.userId));
  }, [attendingRsvps, entries, profMap]);

  async function patchNight(patch: Record<string, any>) {
    const { error } = await supabase.from("poker_nights").update(patch as any).eq("id", nightId);
    if (error) { toast.error(error.message); return false; }
    qc.invalidateQueries({ queryKey: ["night", nightId] });
    return true;
  }

  async function startTournament() {
    if (entries.length === 0) {
      toast.error("Add players before starting the clock");
      return;
    }
    const ok = await patchNight({
      tournament_status: "running",
      current_level: 1,
      level_started_at: new Date().toISOString(),
      clock_paused_at: null,
    });
    if (ok) {
      toast.success("Clock started");
      const l = levelAt(night, 1);
      sendPush({
        data: {
          nightId,
          title: "🃏 Tournament started",
          body: `Level 1 — blinds ${formatBlinds(l)}`,
          tag: `tournament-start-${nightId}`,
          excludeSelf: true,
        },
      }).catch(() => {});
    }
  }

  async function togglePause() {
    if (paused) {
      // Resume: shift level_started_at forward by the paused duration so the
      // remaining time is exactly what it was when paused.
      const pausedFor = Date.now() - new Date(night.clock_paused_at!).getTime();
      const started = new Date(night.level_started_at ?? new Date().toISOString()).getTime();
      await patchNight({
        level_started_at: new Date(started + pausedFor).toISOString(),
        clock_paused_at: null,
      });
    } else {
      await patchNight({ clock_paused_at: new Date().toISOString() });
    }
  }

  async function goToLevel(target: number) {
    const max = (night.blind_levels ?? []).length;
    const lv = Math.min(Math.max(1, target), Math.max(1, max));
    const ok = await patchNight({
      current_level: lv,
      level_started_at: new Date().toISOString(),
      clock_paused_at: null,
      tournament_status: "running",
    });
    if (ok && lv > level) {
      const l = levelAt(night, lv);
      sendPush({
        data: {
          nightId,
          title: l?.isBreak ? "☕ Break time" : `⬆️ Level ${lv}`,
          body: l?.isBreak ? "Take five — the clock is running on the break." : `Blinds are now ${formatBlinds(l)}`,
          tag: `tournament-level-${nightId}-${lv}`,
          excludeSelf: true,
        },
      }).catch(() => {});
    }
  }

  async function addEntry(userId: string | null, name: string) {
    const { error } = await supabase.from("tournament_entries").insert({
      night_id: nightId,
      user_id: userId,
      player_name: name,
      chips: night.starting_stack,
      buy_ins: 1,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success(`${name} is in`);
    setAddPick("");
    setWalkinName("");
    qc.invalidateQueries({ queryKey: ["tournament-entries", nightId] });
  }

  async function updateEntry(e: TournamentEntry, patch: Record<string, any>) {
    const { error } = await supabase.from("tournament_entries").update(patch as any).eq("id", e.id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["tournament-entries", nightId] });
  }

  async function rebuy(e: TournamentEntry) {
    await updateEntry(e, { rebuys: (e.rebuys || 0) + 1, chips: (e.chips || 0) + (night.rebuy_chips || 0) });
    toast.success(`${e.player_name} re-bought`);
  }

  async function addon(e: TournamentEntry) {
    await updateEntry(e, { addons: (e.addons || 0) + 1, chips: (e.chips || 0) + (night.addon_chips || 0) });
    toast.success(`${e.player_name} took the add-on`);
  }

  async function bustOut(e: TournamentEntry, byUserId: string | null) {
    const place = alive.length; // last player standing keeps place 1
    await updateEntry(e, {
      place,
      chips: 0,
      eliminated_at: new Date().toISOString(),
      knocked_out_by: byUserId,
    });
    setBustPick("");
    const prize = payoutForPlace(pool, night.payout_split, place);
    sendPush({
      data: {
        nightId,
        title: place === 1 ? `🏆 ${e.player_name} wins!` : `☠️ ${e.player_name} is out (#${place})`,
        body:
          prize > 0
            ? `Finished #${place} for ${formatMoney(prize, night.currency)}`
            : `${Math.max(0, place - 1)} player${place - 1 === 1 ? "" : "s"} left`,
        tag: `tournament-ko-${nightId}-${e.id}`,
        excludeSelf: true,
      },
    }).catch(() => {});
    if (place === 1) await patchNight({ tournament_status: "finished", clock_paused_at: new Date().toISOString() });
  }

  async function undoBust(e: TournamentEntry) {
    await updateEntry(e, { place: null, eliminated_at: null, knocked_out_by: null, chips: night.starting_stack });
    if (night.tournament_status === "finished") await patchNight({ tournament_status: "running" });
  }

  async function removeEntry(e: TournamentEntry) {
    const { error } = await supabase.from("tournament_entries").delete().eq("id", e.id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["tournament-entries", nightId] });
  }

  const clockTone = expired ? "text-red-400" : paused ? "text-muted-foreground" : "text-gold";

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Clock */}
      <div className="card-felt shadow-card rounded-2xl p-5 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-display text-lg font-semibold">
            {night.tournament_status === "finished"
              ? "Tournament finished"
              : level > 0
                ? cur?.isBreak
                  ? "Break"
                  : `Level ${level}`
                : "Blind clock"}
          </div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {night.tournament_status === "running" ? (paused ? "Paused" : "Running") : night.tournament_status === "finished" ? "Done" : "Not started"}
          </div>
        </div>

        <div className={"mt-2 text-center font-mono text-6xl font-bold tabular-nums sm:text-7xl " + clockTone}>
          {night.tournament_status === "running" ? formatClock(left) : formatClock(0)}
        </div>

        <div className="mt-3 grid gap-2 text-center sm:grid-cols-3">
          <div className="rounded-xl bg-background/40 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Blinds</div>
            <div className="font-mono text-lg">{formatBlinds(cur)}</div>
          </div>
          <div className="rounded-xl bg-background/40 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Next</div>
            <div className="font-mono text-lg">{formatBlinds(next)}</div>
          </div>
          <div className="rounded-xl bg-background/40 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Avg stack</div>
            <div className="font-mono text-lg">{averageStack(entries).toLocaleString()}</div>
          </div>
        </div>

        {expired && <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-center text-sm text-red-300">Level time is up — advance to the next level.</div>}

        {canManage && night.status !== "completed" && night.status !== "cancelled" && (
          <div className="mt-4 flex flex-wrap gap-2">
            {night.tournament_status === "not_started" ? (
              <Button className="bg-emerald-500 text-white hover:bg-emerald-500/90" onClick={startTournament}>
                <Play className="mr-1 h-4 w-4" />Start clock
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={togglePause}>
                  {paused ? <><Play className="mr-1 h-4 w-4" />Resume</> : <><Pause className="mr-1 h-4 w-4" />Pause</>}
                </Button>
                <Button variant="outline" onClick={() => goToLevel(level - 1)} disabled={level <= 1}>
                  <SkipBack className="mr-1 h-4 w-4" />Prev
                </Button>
                <Button className="bg-gold shadow-gold" onClick={() => goToLevel(level + 1)}>
                  <SkipForward className="mr-1 h-4 w-4" />Next level
                </Button>
                <Button variant="outline" onClick={() => goToLevel(level)}>
                  <RotateCcw className="mr-1 h-4 w-4" />Restart level
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Prize pool */}
      <div className="card-felt shadow-card rounded-2xl p-5">
        <div className="mb-3 font-display text-lg font-semibold">
          <Trophy className="mr-1 inline h-4 w-4 text-gold" />Prize pool
        </div>
        <div className="font-mono text-3xl font-bold text-gold">{formatMoney(pool, night.currency)}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {entries.length} entr{entries.length === 1 ? "y" : "ies"} · {alive.length} left
        </div>
        <ul className="mt-3 space-y-1 text-sm">
          {payouts.length === 0 && <li className="text-muted-foreground">No prize split set.</li>}
          {payouts.map((p) => {
            const winner = busted.find((b) => b.place === p.place);
            return (
              <li key={p.place} className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2">
                <span>
                  <span className="text-gold">#{p.place}</span>
                  {winner ? <span className="ml-2">{winner.player_name}</span> : null}
                </span>
                <span className="font-mono">{formatMoney(p.amount, night.currency)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Players */}
      <div className="card-felt shadow-card rounded-2xl p-5 lg:col-span-3">
        <div className="mb-3 font-display text-lg font-semibold">
          <Users className="mr-1 inline h-4 w-4 text-gold" />Chip counts
        </div>

        {canManage && night.status !== "completed" && (
          <div className="mb-4 grid gap-2 rounded-xl border border-gold/25 bg-background/40 p-3 sm:grid-cols-2">
            <div className="flex gap-2">
              <Select value={addPick} onValueChange={setAddPick}>
                <SelectTrigger className="bg-background/60"><SelectValue placeholder="Add attending player…" /></SelectTrigger>
                <SelectContent>
                  {candidates.length === 0 ? (
                    <SelectItem value="none" disabled>Everyone attending is registered</SelectItem>
                  ) : (
                    candidates.map((c) => <SelectItem key={c.userId!} value={c.userId!}>{c.name}</SelectItem>)
                  )}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                disabled={!addPick}
                onClick={() => {
                  const c = candidates.find((x) => x.userId === addPick);
                  if (c) addEntry(c.userId, c.name);
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex gap-2">
              <Input placeholder="Walk-in name" value={walkinName} onChange={(e) => setWalkinName(e.target.value)} />
              <Button variant="outline" disabled={!walkinName.trim()} onClick={() => addEntry(null, walkinName.trim())}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {[...alive]
            .sort((a, b) => (b.chips || 0) - (a.chips || 0))
            .map((e) => (
              <div key={e.id} className="rounded-xl bg-background/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {e.user_id ? <PlayerLink userId={e.user_id} name={e.player_name} /> : e.player_name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Invested {formatMoney(investedBy(night, e), night.currency)}
                      {e.rebuys ? ` · ${e.rebuys} re-buy${e.rebuys === 1 ? "" : "s"}` : ""}
                      {e.addons ? ` · ${e.addons} add-on${e.addons === 1 ? "" : "s"}` : ""}
                    </div>
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <Input
                        type="number"
                        className="h-8 w-28 font-mono"
                        defaultValue={e.chips}
                        onBlur={(ev) => {
                          const v = Number(ev.target.value);
                          if (!Number.isNaN(v) && v !== e.chips) updateEntry(e, { chips: Math.max(0, Math.round(v)) });
                        }}
                      />
                      {night.rebuy_amount > 0 && (
                        <Button size="sm" variant="outline" onClick={() => rebuy(e)}>
                          <Coins className="mr-1 h-3.5 w-3.5" />Re-buy
                        </Button>
                      )}
                      {night.addon_amount > 0 && (
                        <Button size="sm" variant="outline" onClick={() => addon(e)}>
                          Add-on
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="text-red-400" onClick={() => bustOut(e, bustPick || null)}>
                        <Skull className="mr-1 h-3.5 w-3.5" />Bust
                      </Button>
                      {entries.length > 0 && e.place == null && night.tournament_status === "not_started" && (
                        <Button size="sm" variant="ghost" onClick={() => removeEntry(e)}>Remove</Button>
                      )}
                    </div>
                  ) : (
                    <div className="font-mono text-lg">{(e.chips || 0).toLocaleString()}</div>
                  )}
                </div>
              </div>
            ))}
          {alive.length === 0 && (
            <div className="rounded-md border border-dashed border-border/60 p-3 text-center text-sm text-muted-foreground">
              No players in the tournament yet.
            </div>
          )}
        </div>

        {canManage && alive.length > 1 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Credit the knockout to:</span>
            <Select value={bustPick} onValueChange={setBustPick}>
              <SelectTrigger className="h-8 w-52 bg-background/60"><SelectValue placeholder="Nobody" /></SelectTrigger>
              <SelectContent>
                {alive.filter((e) => e.user_id).map((e) => (
                  <SelectItem key={e.id} value={e.user_id!}>{e.player_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {busted.length > 0 && (
          <div className="mt-5 border-t border-border/60 pt-4">
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Finished</div>
            <ol className="space-y-1 text-sm">
              {busted.map((e) => (
                <li key={e.id} className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="text-gold">#{e.place}</span>
                    {e.user_id ? <PlayerLink userId={e.user_id} name={e.player_name} /> : e.player_name}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-emerald-400">
                      {payoutForPlace(pool, night.payout_split, e.place) > 0
                        ? formatMoney(payoutForPlace(pool, night.payout_split, e.place), night.currency)
                        : ""}
                    </span>
                    {canManage && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => undoBust(e)} title="Undo knockout">
                        <Undo2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
