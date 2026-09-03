import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTvSnapshot } from "@/lib/tv.functions";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney, formatEUDate, formatEUTime } from "@/lib/poker";
import {
  mergeTvSettings,
  tvEventHeadline,
  tvFeedLine,
  initialsOf,
  activeBreakFrom,
  breakCountdown,
  type TvSettings,
} from "@/lib/tv-shared";
import { Spade, Wifi, WifiOff, Trophy, Users, Coins, RefreshCw, Timer, Coffee } from "lucide-react";
import { formatBlinds, formatClock, levelAt, secondsLeft } from "@/lib/tournament";

type Snapshot = Awaited<ReturnType<typeof getTvSnapshot>>;
type TvEvent = Snapshot["events"][number];
type ActivePhoto = NonNullable<Snapshot["activePhoto"]>;

function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined") return;
    let lock: any = null;
    let cancelled = false;
    const request = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request?.("screen");
      } catch { /* not supported — ignore */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible" && !cancelled) request(); };
    request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      try { lock?.release?.(); } catch { /* noop */ }
    };
  }, [enabled]);
}

function beep(kind: "good" | "big") {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "triangle";
    o.frequency.setValueAtTime(kind === "big" ? 660 : 440, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(kind === "big" ? 1320 : 880, ctx.currentTime + 0.25);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.55);
    setTimeout(() => ctx.close?.(), 800);
  } catch { /* noop */ }
}

function elapsed(fromIso: string | null, now: number, untilIso?: string | null) {
  if (!fromIso) return "—";
  const end = untilIso ? new Date(untilIso).getTime() : now;
  const ms = Math.max(0, end - new Date(fromIso).getTime());
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function TvDisplay({
  gameId,
  code,
  preview = false,
  onUnpaired,
}: {
  gameId: string;
  code: string;
  preview?: boolean;
  onUnpaired?: () => void;
}) {
  const fetchSnapshot = useServerFn(getTvSnapshot);
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  const lastGood = useRef<Snapshot | null>(null);

  const q = useQuery({
    queryKey: ["tv-snapshot", gameId, code],
    queryFn: async () => (await fetchSnapshot({ data: { gameId, code } })) as Snapshot,
    refetchInterval: 5000,
    retry: true,
    staleTime: 0,
  });

  useEffect(() => { if (q.data) { lastGood.current = q.data; setOnline(true); } }, [q.data]);
  useEffect(() => {
    if (!q.error) return;
    const msg = String((q.error as any)?.message ?? "");
    if (/no longer paired|Invalid or expired/i.test(msg)) onUnpaired?.();
    setOnline(false);
  }, [q.error, onUnpaired]);

  const snap = q.data ?? lastGood.current;
  const settings: TvSettings = useMemo(() => mergeTvSettings(snap?.settings), [snap?.settings]);

  useWakeLock(!preview);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Realtime: refetch instantly when a new game event lands.
  useEffect(() => {
    const ch = supabase
      .channel(`tv-events-${gameId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "game_events", filter: `night_id=eq.${gameId}` },
        () => { q.refetch(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // Presence so the host can count connected displays + force-disconnect.
  useEffect(() => {
    if (preview) return;
    const ch = supabase.channel(`tv-presence-${gameId}`, { config: { presence: { key: `${Math.random()}` } } });
    ch.on("broadcast", { event: "disconnect" }, () => onUnpaired?.())
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await ch.track({ at: Date.now() });
      });
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, preview]);

  // Overlay queue — de-duplicated, ordered, one at a time.
  const [overlay, setOverlay] = useState<TvEvent | null>(null);
  const queue = useRef<TvEvent[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    if (!snap) return;
    const events = [...snap.events].reverse(); // oldest first
    if (!primed.current) {
      events.forEach((e) => seen.current.add(e.id));
      primed.current = true;
      return;
    }
    for (const e of events) {
      if (seen.current.has(e.id)) continue;
      seen.current.add(e.id);
      if (!settings.overlayEvents.includes(e.type)) continue;
      queue.current.push(e);
    }
    if (!overlay && queue.current.length) setOverlay(queue.current.shift()!);
  }, [snap, settings.overlayEvents, overlay]);

  useEffect(() => {
    if (!overlay) return;
    if (settings.sounds) beep(overlay.type === "winner" ? "big" : "good");
    const t = setTimeout(() => {
      setOverlay(queue.current.length ? queue.current.shift()! : null);
    }, 5000);
    return () => clearTimeout(t);
  }, [overlay, settings.sounds]);

  // Manual announcement from the host is shown as an overlay too.
  const lastAnnounce = useRef<string | null>(null);
  useEffect(() => {
    const a = snap?.announcement ?? null;
    if (a === lastAnnounce.current) return;
    lastAnnounce.current = a;
    if (!a) { setOverlay((o) => (o?.type === "announcement" ? null : o)); return; }
    setOverlay({
      id: `ann-${a}`,
      type: "announcement",
      amount: 0,
      chipAmount: null,
      metadata: { text: a },
      createdAt: new Date().toISOString(),
      playerId: null,
    } as TvEvent);
  }, [snap?.announcement]);

  if (!snap) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-4xl text-muted-foreground">
        {q.isError ? "Display unavailable" : "Connecting to the table…"}
      </div>
    );
  }

  const light = settings.theme === "light";
  const money = (n: number) => formatMoney(n, snap.night.currency);
  const finished = snap.night.status === "completed" || snap.night.status === "cancelled";
  const anim = settings.animations;
  const tourney = (snap as any).tournament as {
    status: string;
    levelMinutes: number;
    blindLevels: any[];
    payoutSplit: any[];
    currentLevel: number;
    levelStartedAt: string | null;
    clockPausedAt: string | null;
    prizePool: number;
    averageStack: number;
  } | null;
  const tourneyCfg = tourney
    ? {
        blind_levels: tourney.blindLevels,
        level_minutes: tourney.levelMinutes,
        current_level: tourney.currentLevel || 1,
        level_started_at: tourney.levelStartedAt,
        clock_paused_at: tourney.clockPausedAt,
      }
    : null;
  const tourneyLevel = tourneyCfg ? levelAt(tourneyCfg, tourneyCfg.current_level) : null;
  const tourneyNext = tourneyCfg ? levelAt(tourneyCfg, tourneyCfg.current_level + 1) : null;
  const tourneySecondsLeft =
    tourneyCfg && tourney?.status === "running" ? secondsLeft(tourneyCfg, now) : 0;

  const players = [...snap.players].sort((a, b) => {
    if (settings.showRankings && a.rank != null && b.rank != null) return a.rank - b.rank;
    if (a.rank != null && b.rank == null) return -1;
    if (b.rank != null && a.rank == null) return 1;
    return b.invested - a.invested;
  });

  const breakState = activeBreakFrom(
    snap.events.map((e) => ({ type: e.type, metadata: e.metadata, createdAt: e.createdAt })),
    now,
  );



  return (
    <div
      className={[
        "relative min-h-screen w-full overflow-hidden",
        light ? "bg-[oklch(0.97_0.01_90)] text-[oklch(0.16_0.02_150)]" : "bg-felt text-foreground",
      ].join(" ")}
    >
      {/* Header */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 px-[3vw] pt-[2.5vh]">
        <div className="flex min-w-0 items-center gap-[1.5vw]">
          <div className="grid h-[6vh] w-[6vh] shrink-0 place-items-center rounded-2xl bg-gold shadow-gold">
            <Spade className="h-[3.4vh] w-[3.4vh]" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-[3.2vh] leading-tight font-bold">{snap.night.title}</div>
            <div className="truncate text-[1.7vh] opacity-70">
              {formatEUDate(snap.night.startsAt)} · {formatEUTime(snap.night.startsAt)}
              {snap.night.location ? ` · ${snap.night.location}` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-[2vw] text-right">
          <div>
            <div className="text-[1.4vh] uppercase tracking-widest opacity-60">Elapsed</div>
            <div className="font-display text-[3.4vh] font-bold tabular-nums text-gold">
              {elapsed(snap.night.startedAt, now, snap.night.endedAt)}
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border px-[1vw] py-[0.6vh] text-[1.5vh]">
            {online ? <Wifi className="h-[2vh] w-[2vh] text-gold" /> : <WifiOff className="h-[2vh] w-[2vh] text-red" />}
            <span className="opacity-80">
              {online ? (finished ? "Finished" : snap.night.startedAt ? "Live" : "Waiting") : "Reconnecting…"}
            </span>
          </div>
        </div>
      </header>

      {finished ? (
        <FinalResults snap={snap} settings={settings} money={money} now={now} />
      ) : (
        <>
          {/* Tournament blind clock */}
          {tourney && (
            <section className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-[1.5vw] px-[3vw] pt-[2.5vh]">
              <div className="card-felt rounded-3xl px-[1.6vw] py-[1.6vh] text-center">
                <div className="text-[1.4vh] uppercase tracking-widest opacity-60">
                  {tourney.status === "finished"
                    ? "Finished"
                    : tourneyLevel?.isBreak
                      ? "Break"
                      : `Level ${tourney.currentLevel || 1}`}
                </div>
                <div
                  className={
                    "font-display text-[9vh] font-bold leading-none tabular-nums " +
                    (tourneySecondsLeft <= 0 ? "text-red-400" : tourney.clockPausedAt ? "opacity-60" : "text-gold")
                  }
                >
                  {formatClock(Math.max(0, tourneySecondsLeft))}
                </div>
              </div>
              <Stat icon={<Timer className="h-[2.4vh] w-[2.4vh]" />} label="Blinds" value={formatBlinds(tourneyLevel)} highlight />
              <Stat icon={<Timer className="h-[2.4vh] w-[2.4vh]" />} label="Next blinds" value={formatBlinds(tourneyNext)} />
              <Stat icon={<Coins className="h-[2.4vh] w-[2.4vh]" />} label="Avg stack" value={tourney.averageStack.toLocaleString()} />
            </section>
          )}

          {/* Stat strip */}
          <section className="grid grid-cols-4 gap-[1.5vw] px-[3vw] pt-[3vh]">
            <Stat icon={<Users className="h-[2.4vh] w-[2.4vh]" />} label="Active players" value={`${snap.totals.active}/${snap.totals.players}`} />
            <Stat icon={<Coins className="h-[2.4vh] w-[2.4vh]" />} label="Buy-ins" value={settings.showMoney ? money(snap.totals.buyInAmount) : `${snap.totals.players}`} />
            <Stat icon={<RefreshCw className="h-[2.4vh] w-[2.4vh]" />} label="Re-buys" value={settings.showMoney ? money(snap.totals.rebuyAmount) : `${snap.totals.rebuyCount}`} />
            <Stat
              icon={<Trophy className="h-[2.4vh] w-[2.4vh]" />}
              label={tourney ? "Prize pool" : "Total in play"}
              value={settings.showMoney ? money(tourney ? tourney.prizePool : snap.totals.total) : `${snap.totals.rebuyCount + snap.totals.players}`}
              highlight
            />
          </section>

          {/* Players + feed */}
          <section className={`grid gap-[1.5vw] px-[3vw] pt-[2.5vh] ${settings.showFeed ? "grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)]" : "grid-cols-1"}`}>
            <div className="card-felt overflow-hidden rounded-3xl">
              <div className="grid grid-cols-[3fr_1.4fr_1.2fr_1.6fr] gap-[1vw] px-[1.6vw] py-[1.4vh] text-[1.5vh] uppercase tracking-widest opacity-60">
                <div>Player</div>
                <div className="text-right">Buy-in</div>
                <div className="text-right">Re-buys</div>
                <div className="text-right">{settings.showChips && !settings.showMoney ? "Chips" : "Invested"}</div>
              </div>
              <div>
                {players.slice(0, 12).map((p) => (
                  <div
                    key={p.id}
                    className={`grid grid-cols-[3fr_1.4fr_1.2fr_1.6fr] items-center gap-[1vw] border-t border-border px-[1.6vw] py-[1.35vh] ${p.eliminated || p.cashedOut ? "opacity-45" : ""}`}
                  >
                    <div className="flex min-w-0 items-center gap-[1vw]">
                      {settings.showRankings && p.rank != null && (
                        <span className="w-[3vh] shrink-0 text-center font-display text-[2.4vh] font-bold text-gold">{p.rank}</span>
                      )}
                      {p.avatarUrl ? (
                        <img src={p.avatarUrl} alt="" className="h-[5vh] w-[5vh] shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="grid h-[5vh] w-[5vh] shrink-0 place-items-center rounded-full bg-secondary text-[1.9vh] font-bold">
                          {initialsOf(p.name)}
                        </span>
                      )}
                      <span className="truncate text-[2.6vh] font-semibold">{p.name}</span>
                      {(p.eliminated || p.cashedOut) && (
                        <span className="shrink-0 rounded-full bg-secondary px-[0.8vw] py-[0.3vh] text-[1.3vh] uppercase tracking-wide">
                          {p.cashedOut ? "Cashed out" : "Out"}
                        </span>
                      )}
                    </div>
                    <div className="text-right text-[2.2vh] tabular-nums">{settings.showMoney ? money(p.buyIn) : "—"}</div>
                    <div className="text-right text-[2.2vh] tabular-nums">{settings.showMoney ? money(p.rebuys) : "—"}</div>
                    <div className="text-right font-display text-[2.6vh] font-bold tabular-nums text-gold">
                      {settings.showMoney ? money(p.invested) : ""}
                      {settings.showMoney && settings.showChips ? " · " : ""}
                      {settings.showChips ? `${p.chips}` : ""}
                      {!settings.showMoney && !settings.showChips ? "—" : ""}
                    </div>
                  </div>
                ))}
                {players.length === 0 && (
                  <div className="px-[1.6vw] py-[6vh] text-center text-[2.4vh] opacity-60">Waiting for players…</div>
                )}
              </div>
            </div>

            {settings.showFeed && (
              <div className="card-felt rounded-3xl p-[1.4vw]">
                <div className="pb-[1vh] text-[1.5vh] uppercase tracking-widest opacity-60">Live activity</div>
                <ul className="space-y-[1.1vh]">
                  {snap.events.slice(0, 9).map((e) => (
                    <li key={e.id} className="flex gap-[0.8vw] text-[1.9vh] leading-snug">
                      <span className="shrink-0 tabular-nums opacity-60">{formatEUTime(e.createdAt)}</span>
                      <span className="min-w-0 truncate">{tvFeedLine(e.type, e.metadata, e.amount, money)}</span>
                    </li>
                  ))}
                  {snap.events.length === 0 && <li className="text-[1.9vh] opacity-60">No events yet.</li>}
                </ul>
              </div>
            )}
          </section>
        </>
      )}

      {/* Break screen — takes over the whole display while the clock runs */}
      {breakState && !finished && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-[oklch(0.10_0.02_150_/_0.92)] backdrop-blur-sm">
          <div className={`text-center ${anim ? "animate-scale-in" : ""}`}>
            <div className="mx-auto mb-[2vh] grid h-[14vh] w-[14vh] place-items-center rounded-full bg-gold/15 text-gold">
              <Coffee className="h-[7vh] w-[7vh]" />
            </div>
            <div className="font-display text-[8vh] leading-none font-black uppercase tracking-tight text-gold">
              {breakState.label || "Break"}
            </div>
            <div className="mt-[2vh] font-display text-[20vh] leading-none font-black tabular-nums">
              {breakCountdown(breakState.until, now)}
            </div>
            <div className="mt-[2vh] text-[3vh] opacity-70">
              Back to play in {breakState.minutes} minute{breakState.minutes === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      )}

      {/* Photo moment — takes precedence over break screen and overlays */}
      <PhotoOverlay photo={snap.activePhoto} url={snap.photoUrl} anim={anim} onExpire={() => q.refetch()} />

      {/* Overlay */}
      {overlay && (

        <div className="absolute inset-0 z-30 grid place-items-center bg-[oklch(0.10_0.02_150_/_0.82)] backdrop-blur-sm">
          <div className={`card-felt rounded-[3vh] px-[6vw] py-[6vh] text-center shadow-card ${anim ? "animate-scale-in" : ""}`}>
            {overlay.type !== "announcement" && (
              <div className={`mx-auto mb-[2vh] h-[12vh] w-[12vh] rounded-full chip-ring ${anim ? "animate-chip-in" : ""}`} />
            )}
            <div className="font-display text-[7vh] leading-none font-black uppercase tracking-tight text-gold">
              {tvEventHeadline(overlay.type, overlay.metadata)}
            </div>
            {overlay.amount > 0 && (
              <div className={`mt-[2vh] text-[9vh] leading-none font-black tabular-nums ${anim ? "animate-pot-pop" : ""}`}>
                +{money(overlay.amount)}
              </div>
            )}
            {overlay.metadata?.total != null && settings.showMoney && (
              <div className="mt-[2vh] text-[3vh] opacity-80">Total invested: {money(Number(overlay.metadata.total))}</div>
            )}
            {overlay.metadata?.rank != null && (
              <div className="mt-[1vh] text-[3vh] opacity-80">Finished #{overlay.metadata.rank}</div>
            )}
          </div>
        </div>
      )}

      {!online && (
        <div className="absolute bottom-[2vh] left-1/2 z-40 -translate-x-1/2 rounded-full bg-secondary px-[1.6vw] py-[0.8vh] text-[1.7vh] opacity-90">
          Reconnecting…
        </div>
      )}
    </div>
  );
}

function PhotoOverlay({
  photo,
  url,
  anim,
  onExpire,
}: {
  photo: ActivePhoto | null;
  url: string | null;
  anim: boolean;
  onExpire: () => void;
}) {
  const [progress, setProgress] = useState(100);
  const [expired, setExpired] = useState(false);
  const firedRef = useRef(false);
  const startedRef = useRef<number>(0);

  const key = photo ? `${photo.path}|${photo.until}` : "";
  const untilRaw = photo ? new Date(photo.until).getTime() : 0;
  const until = Number.isFinite(untilRaw) ? untilRaw : 0;
  const durationMs = Math.max(1000, ((photo?.duration ?? 10) as number) * 1000);

  // Start a monotonic local timer the first time this photo appears. TV boxes
  // often have a wrong system clock, so we never trust `until` alone.
  useEffect(() => {
    setExpired(false);
    firedRef.current = false;
    startedRef.current = Date.now();
    setProgress(100);
  }, [key]);

  useEffect(() => {
    if (!photo || !url) return;
    const tick = () => {
      const t = Date.now();
      const localRemaining = startedRef.current + durationMs - t;
      const serverRemaining = until > 0 ? until - t : Infinity;
      const remaining = Math.max(0, Math.min(localRemaining, serverRemaining));
      setProgress((remaining / durationMs) * 100);
      if (remaining <= 0) {
        setExpired(true);
        if (!firedRef.current) {
          firedRef.current = true;
          onExpire();
        }
      }
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [key, url, durationMs, until, onExpire, photo]);

  // Local safety net: never keep the photo up past its duration, even if the
  // server snapshot is stale, the clock is off, or the TV loses connection.
  if (!photo || !url || expired) return null;



  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black">
      <img
        src={url}
        alt=""
        className={`max-h-full max-w-full object-contain ${anim ? "animate-scale-in" : ""}`}
      />
      <div className="absolute bottom-0 left-0 right-0 h-2 bg-white/10">
        <div
          className="h-full bg-gold transition-all duration-300 ease-linear"
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </div>
    </div>
  );
}

function Stat({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="card-felt rounded-3xl px-[1.6vw] py-[1.8vh]">
      <div className="flex items-center gap-[0.6vw] text-[1.5vh] uppercase tracking-widest opacity-60">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-[0.6vh] font-display text-[4.4vh] leading-none font-black tabular-nums ${highlight ? "text-gold" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function FinalResults({ snap, settings, money, now }: { snap: Snapshot; settings: TvSettings; money: (n: number) => string; now: number }) {
  const ranked = [...snap.players].sort((a, b) => {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    if (a.rank != null) return -1;
    if (b.rank != null) return 1;
    return b.chips - b.invested - (a.chips - a.invested);
  });
  const winner = ranked[0];
  const biggestWinner = [...snap.players].sort((a, b) => (b.chips - b.invested) - (a.chips - a.invested))[0];
  const mostRebuys = [...snap.players].sort((a, b) => b.rebuys - a.rebuys)[0];

  return (
    <section className="px-[3vw] pt-[3vh]">
      <div className="card-felt rounded-3xl px-[3vw] py-[3vh] text-center">
        <div className="text-[1.7vh] uppercase tracking-[0.4em] opacity-60">Winner</div>
        <div className="mt-[1vh] font-display text-[8vh] leading-none font-black text-gold animate-scale-in">
          {winner?.name ?? "—"}
        </div>
        {settings.showMoney && winner && (
          <div className="mt-[1vh] text-[3vh] opacity-80">Net {money(winner.chips - winner.invested)}</div>
        )}
      </div>

      <div className="mt-[2vh] grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-[1.5vw]">
        <div className="card-felt rounded-3xl p-[1.4vw]">
          <div className="pb-[1vh] text-[1.5vh] uppercase tracking-widest opacity-60">Final ranking</div>
          {ranked.slice(0, 10).map((p, i) => (
            <div key={p.id} className="flex items-center gap-[1vw] border-t border-border py-[1.1vh] text-[2.3vh]">
              <span className="w-[3vh] text-center font-display font-bold text-gold">{p.rank ?? i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              {settings.showMoney && <span className="tabular-nums">{money(p.chips - p.invested)}</span>}
            </div>
          ))}
        </div>
        <div className="card-felt grid content-start gap-[1.4vh] rounded-3xl p-[1.4vw] text-[2.1vh]">
          <Line label="Duration" value={elapsed(snap.night.startedAt, now, snap.night.endedAt)} />
          <Line label="Players" value={`${snap.totals.players}`} />
          <Line label="Re-buys" value={`${snap.totals.rebuyCount}`} />
          {settings.showMoney && <Line label="Total played" value={money(snap.totals.total)} />}
          <Line label="Biggest winner" value={biggestWinner?.name ?? "—"} />
          <Line label="Most re-buys" value={mostRebuys?.name ?? "—"} />
        </div>
      </div>
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-[1vw]">
      <span className="shrink-0 opacity-60">{label}</span>
      <span className="min-w-0 truncate text-right font-display font-bold text-gold">{value}</span>
    </div>
  );
}