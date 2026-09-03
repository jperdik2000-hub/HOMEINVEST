import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { currentPushStatus, enablePush, disablePush, syncPushSubscription } from "@/lib/push-client";
import {
  getMyNotificationPrefs,
  updateMyNotificationPrefs,
} from "@/lib/push.functions";

type Prefs = {
  invite_received: boolean;
  reminder_24h: boolean;
  reminder_1h: boolean;
  results_posted: boolean;
};

const DEFAULTS: Prefs = {
  invite_received: true,
  reminder_24h: true,
  reminder_1h: true,
  results_posted: true,
};

export function PushNotificationSettings({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<string>("loading");
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const loadPrefs = useServerFn(getMyNotificationPrefs);
  const savePrefs = useServerFn(updateMyNotificationPrefs);

  useEffect(() => {
    currentPushStatus().then((s) => {
      setStatus(s);
      if (s === "granted") syncPushSubscription().catch(() => {});
    });
    loadPrefs()
      .then((p) => setPrefs({ ...DEFAULTS, ...(p as Prefs) }))
      .catch(() => {});
  }, [loadPrefs]);

  async function turnOn() {
    setBusy(true);
    const res = await enablePush();
    setBusy(false);
    if (res.ok) {
      toast.success("Notifications enabled");
      setStatus("granted");
    } else {
      toast.error(res.reason ?? "Could not enable");
      const s = await currentPushStatus();
      setStatus(s);
    }
  }

  async function turnOff() {
    setBusy(true);
    const res = await disablePush();
    setBusy(false);
    if (res.ok) {
      toast.success("Notifications disabled on this device");
      const s = await currentPushStatus();
      setStatus(s);
    } else {
      toast.error(res.reason ?? "Could not disable");
    }
  }

  async function togglePref(key: keyof Prefs, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      await savePrefs({ data: next });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    }
  }

  return (
    <div className={compact ? "space-y-3" : "card-felt shadow-card mt-6 rounded-2xl p-5"}>
      <div className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
        <Bell className="h-4 w-4 text-gold" /> Push notifications
      </div>

      {status === "preview" && (
        <p className="text-sm text-muted-foreground">
          Push notifications work on the published app. Open{" "}
          <span className="font-mono text-xs">poker-club-ath.lovable.app</span> to enable them.
        </p>
      )}
      {status === "unsupported" && (
        <p className="text-sm text-muted-foreground">
          Your browser doesn't support push. On iPhone, add this app to your Home Screen first.
        </p>
      )}
      {status === "denied" && (
        <p className="text-sm text-muted-foreground">
          Notifications are blocked. Enable them for this site in your browser settings, then reload.
        </p>
      )}
      {status === "default" && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Get pinged about new games, invites, reminders, and results.
          </p>
          <Button onClick={turnOn} disabled={busy} className="bg-gold shadow-gold">
            <Bell className="mr-2 h-4 w-4" /> Enable
          </Button>
        </div>
      )}
      {status === "granted" && (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-emerald-400">Notifications enabled on this device.</p>
            <Button onClick={turnOff} disabled={busy} variant="outline" size="sm">
              <BellOff className="mr-2 h-4 w-4" /> Turn off
            </Button>
          </div>
          <div className="space-y-3 border-t border-border/60 pt-4">
            <PrefRow label="I'm invited" hint="Ping me when a host adds me to a game." value={prefs.invite_received} onChange={(v) => togglePref("invite_received", v)} />
            <PrefRow label="24-hour reminder" hint="Nudge me the day before if I haven't RSVP'd." value={prefs.reminder_24h} onChange={(v) => togglePref("reminder_24h", v)} />
            <PrefRow label="1-hour reminder" hint="Ping me one hour before the game starts." value={prefs.reminder_1h} onChange={(v) => togglePref("reminder_1h", v)} />
            <PrefRow label="Results posted" hint="Tell me the final score after a game I played in." value={prefs.results_posted} onChange={(v) => togglePref("results_posted", v)} />
          </div>
        </>
      )}
    </div>
  );
}

function PrefRow({ label, hint, value, onChange }: {
  label: string; hint: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}