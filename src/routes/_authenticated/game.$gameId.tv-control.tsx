import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Tv, Copy, ExternalLink, RefreshCw, Power, Eye } from "lucide-react";
import { DEFAULT_TV_SETTINGS, TV_EVENT_TYPES, generateTvCode, mergeTvSettings, type TvSettings } from "@/lib/tv-shared";
import { TvDisplay } from "@/components/TvDisplay";
import { TvPhotoPanel } from "@/components/TvPhotoPanel";

export const Route = createFileRoute("/_authenticated/game/$gameId/tv-control")({
  head: () => ({
    meta: [
      { title: "TV Display Control — Poker Club" },
      { name: "description", content: "Pair a television to this live poker game and control what the display shows." },
      { property: "og:title", content: "TV Display Control — Poker Club" },
      { property: "og:description", content: "Pair a television to this live poker game and control what the display shows." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TvControlPage,
});

function TvControlPage() {
  const { gameId } = Route.useParams();
  const qc = useQueryClient();
  const [devices, setDevices] = useState(0);
  const [status, setStatus] = useState<"connected" | "disconnected" | "reconnecting">("reconnecting");
  const [announce, setAnnounce] = useState("");
  const [preview, setPreview] = useState(false);

  const night = useQuery({
    queryKey: ["night", gameId],
    queryFn: async () => {
      const { data, error } = await supabase.from("poker_nights").select("*").eq("id", gameId).single();
      if (error) throw error;
      return data;
    },
  });

  const session = useQuery({
    queryKey: ["tv-session", gameId],
    queryFn: async () => {
      const { data, error } = await supabase.from("night_tv_sessions").select("*").eq("night_id", gameId).maybeSingle();
      if (error) throw error;
      if (data) return data;
      const { data: created, error: err2 } = await supabase
        .from("night_tv_sessions")
        .insert({ night_id: gameId, code: generateTvCode(), settings: DEFAULT_TV_SETTINGS as any })
        .select("*")
        .single();
      if (err2) throw err2;
      return created;
    },
  });

  const settings: TvSettings = useMemo(() => mergeTvSettings(session.data?.settings), [session.data?.settings]);
  const code = (session.data?.code as string) ?? "";
  const active = !!session.data?.active;
  const finished = night.data?.status === "completed" || night.data?.status === "cancelled";

  const displayUrl =
    typeof window !== "undefined" && code ? `${window.location.origin}/tv/game/${gameId}?code=${code}` : "";
  const qrUrl = displayUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(displayUrl)}`
    : "";

  // Presence: count connected televisions.
  useEffect(() => {
    const ch = supabase.channel(`tv-presence-${gameId}`);
    const sync = () => {
      const n = Object.keys(ch.presenceState()).length;
      setDevices(n);
      setStatus(n > 0 ? "connected" : "disconnected");
    };
    ch.on("presence", { event: "sync" }, sync)
      .subscribe((s) => {
        if (s === "SUBSCRIBED") sync();
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") setStatus("reconnecting");
      });
    return () => { supabase.removeChannel(ch); };
  }, [gameId]);

  async function patch(patchData: {
    active?: boolean;
    announcement?: string | null;
    code?: string;
    settings?: TvSettings;
  }) {
    const { error } = await supabase
      .from("night_tv_sessions")
      .update(patchData as never)
      .eq("night_id", gameId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["tv-session", gameId] });
  }

  async function setSetting<K extends keyof TvSettings>(key: K, value: TvSettings[K]) {
    await patch({ settings: { ...settings, [key]: value } });
  }

  async function toggleOverlayEvent(type: string, on: boolean) {
    const next = on
      ? [...new Set([...settings.overlayEvents, type])]
      : settings.overlayEvents.filter((t) => t !== type);
    await setSetting("overlayEvents", next);
  }

  async function regenerate() {
    if (!confirm("Generate a new pairing code? Connected TVs will need to be re-paired.")) return;
    await patch({ code: generateTvCode(), active: true });
    await disconnectAll(true);
    toast.success("New pairing code generated");
  }

  async function disconnectAll(silent = false) {
    const ch = supabase.channel(`tv-presence-${gameId}`);
    await ch.subscribe();
    await ch.send({ type: "broadcast", event: "disconnect", payload: {} });
    supabase.removeChannel(ch);
    if (!silent) toast.success("All displays disconnected");
  }

  async function endSession() {
    await patch({ active: false, announcement: null });
    await disconnectAll(true);
    toast.success("TV session closed");
  }

  if (night.isLoading || session.isLoading) return <AppShell><div className="text-muted-foreground">Loading…</div></AppShell>;
  if (session.isError) return <AppShell><div>Only the host can manage the TV display.</div></AppShell>;

  if (preview) {
    return (
      <div className="relative">
        <Button className="absolute right-4 top-4 z-50" onClick={() => setPreview(false)}>Close preview</Button>
        <TvDisplay gameId={gameId} code={code} preview />
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto grid max-w-5xl gap-6">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold"><Tv className="h-6 w-6" /></div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black sm:text-2xl">TV display</h1>
              <p className="truncate text-sm text-muted-foreground">{night.data?.title}</p>
            </div>
          </div>
          <Button asChild variant="outline"><Link to="/nights/$id" params={{ id: gameId }}>Back to game</Link></Button>
        </header>

        {finished && (
          <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            This game is finished — the TV shows the final results screen until you close the session.
          </div>
        )}

        <section className="card-felt grid gap-6 rounded-2xl p-5 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="grid place-items-center gap-3">
            {qrUrl && active ? (
              <img src={qrUrl} alt="QR code linking to the TV display" className="h-[200px] w-[200px] rounded-xl bg-white p-2" />
            ) : (
              <div className="grid h-[200px] w-[200px] place-items-center rounded-xl bg-muted text-sm text-muted-foreground">Session closed</div>
            )}
          </div>
          <div className="grid content-start gap-4">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Pairing code</div>
              <div className="font-display text-5xl font-black tracking-[0.2em] tabular-nums text-gold">
                {active ? code : "——————"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                On the TV browser open <span className="font-mono">/tv</span> and enter this code. It only works for this game.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full px-3 py-1 ${status === "connected" ? "bg-gold text-[oklch(0.12_0.02_90)]" : "bg-secondary"}`}>
                {status === "connected" ? "Connected" : status === "reconnecting" ? "Reconnecting" : "Disconnected"}
              </span>
              <span className="text-muted-foreground">{devices} display{devices === 1 ? "" : "s"} connected</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(displayUrl); toast.success("Display link copied"); }}>
                <Copy className="mr-2 h-4 w-4" />Copy display link
              </Button>
              <Button variant="outline" onClick={() => window.open(displayUrl, "_blank", "noopener")}>
                <ExternalLink className="mr-2 h-4 w-4" />Open TV display
              </Button>
              <Button variant="outline" onClick={() => setPreview(true)}><Eye className="mr-2 h-4 w-4" />Preview</Button>
              <Button variant="outline" onClick={regenerate}><RefreshCw className="mr-2 h-4 w-4" />Regenerate code</Button>
              <Button variant="outline" onClick={() => disconnectAll()}>Disconnect all displays</Button>
              {active ? (
                <Button variant="destructive" onClick={endSession}><Power className="mr-2 h-4 w-4" />Close TV session</Button>
              ) : (
                <Button onClick={() => patch({ active: true, code: generateTvCode() })}>Start new TV session</Button>
              )}
            </div>
          </div>
        </section>

        <section className="card-felt grid gap-4 rounded-2xl p-5">
          <h2 className="text-lg font-bold">Display options</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle label="Show monetary values" checked={settings.showMoney} onChange={(v) => setSetting("showMoney", v)} />
            <Toggle label="Show chip balances" checked={settings.showChips} onChange={(v) => setSetting("showChips", v)} />
            <Toggle label="Show player rankings" checked={settings.showRankings} onChange={(v) => setSetting("showRankings", v)} />
            <Toggle label="Sounds" checked={settings.sounds} onChange={(v) => setSetting("sounds", v)} />
            <Toggle label="Animations" checked={settings.animations} onChange={(v) => setSetting("animations", v)} />
            <Toggle label="Activity feed" checked={settings.showFeed} onChange={(v) => setSetting("showFeed", v)} />
            <Toggle label="Light TV mode" checked={settings.theme === "light"} onChange={(v) => setSetting("theme", v ? "light" : "dark")} />
          </div>
        </section>

        <section className="card-felt grid gap-4 rounded-2xl p-5">
          <h2 className="text-lg font-bold">Full-screen overlays</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {TV_EVENT_TYPES.map((t) => (
              <Toggle
                key={t.value}
                label={t.label}
                checked={settings.overlayEvents.includes(t.value)}
                onChange={(v) => toggleOverlayEvent(t.value, v)}
              />
            ))}
          </div>
        </section>

        <section className="card-felt grid gap-3 rounded-2xl p-5">
          <h2 className="text-lg font-bold">Announcement</h2>
          <div className="flex flex-wrap gap-2">
            <Input
              value={announce}
              onChange={(e) => setAnnounce(e.target.value)}
              placeholder="e.g. Break in 5 minutes"
              className="min-w-[220px] flex-1"
            />
            <Button onClick={async () => { await patch({ announcement: announce.trim() || null }); toast.success("Sent to TV"); }}>
              Show on TV
            </Button>
            <Button variant="outline" onClick={async () => { setAnnounce(""); await patch({ announcement: null }); }}>
              Clear overlay
            </Button>
          </div>
          {session.data?.announcement && (
            <div className="text-sm text-muted-foreground">Currently showing: “{session.data.announcement}”</div>
          )}
        </section>

        <TvPhotoPanel
          nightId={gameId}
          activePhoto={session.data?.active_photo as { path: string; until: string; duration: number } | null | undefined}
        />
      </div>
    </AppShell>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
      <Label className="min-w-0 truncate text-sm">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}