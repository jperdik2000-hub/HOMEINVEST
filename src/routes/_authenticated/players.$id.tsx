import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import {
  AWARDS,
  fetchAllResults,
  fetchNights,
  fetchProfiles,
  formatMoney,
  formatEUDate,
  formatDisplayName,
} from "@/lib/poker";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Award } from "lucide-react";
import { Upload, Trash2 } from "lucide-react";
import { Bell, ChevronDown } from "lucide-react";
import { PushNotificationSettings } from "@/components/PushNotificationSettings";
import { PlayerStatsPanel } from "@/components/PlayerStatsPanel";
export const Route = createFileRoute("/_authenticated/players/$id")({
  head: () => ({ meta: [{ title: "Player — Poker Club" }] }),
  component: Player,
});

function Player() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);
  const isMe = me === id;
  const isAdminQ = useQuery({
    queryKey: ["is-admin", me],
    enabled: !!me,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", me!)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
  });
  const isAdmin = !!isAdminQ.data;
  const canEditName = isMe || isAdmin;
  const [showNotifSettings, setShowNotifSettings] = useState(false);

  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });
  const results = useQuery({ queryKey: ["results"], queryFn: fetchAllResults });
  const nights = useQuery({ queryKey: ["nights"], queryFn: fetchNights });

  const profile = profiles.data?.find((p) => p.id === id);
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [avatar, setAvatar] = useState("");
  const [avatarDisplay, setAvatarDisplay] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setNickname(profile.nickname ?? "");
      setAvatar(profile.avatar_url ?? "");
    }
  }, [profile]);

  // Resolve avatar_url — supports full URLs (legacy) and storage paths ("avatars/<uid>/<file>").
  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      if (!avatar) {
        setAvatarDisplay("");
        return;
      }
      if (/^https?:\/\//i.test(avatar)) {
        setAvatarDisplay(avatar);
        return;
      }
      const { data } = await supabase.storage
        .from("avatars")
        .createSignedUrl(avatar, 60 * 60 * 24 * 7);
      if (!cancelled) setAvatarDisplay(data?.signedUrl ?? "");
    }
    resolve();
    return () => {
      cancelled = true;
    };
  }, [avatar]);

  async function uploadAvatar(file: File) {
    if (!isMe || !me) return;
    if (!file.type.startsWith("image/")) return toast.error("Please choose an image file.");
    if (file.size > 5 * 1024 * 1024) return toast.error("Image must be under 5 MB.");
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${me}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      // Best-effort: remove old avatar if it was a stored path we own.
      if (avatar && !/^https?:\/\//i.test(avatar) && avatar.startsWith(`${me}/`)) {
        await supabase.storage.from("avatars").remove([avatar]);
      }
      const { error: updErr } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", me);
      if (updErr) throw updErr;
      setAvatar(path);
      toast.success("Profile picture updated");
      qc.invalidateQueries({ queryKey: ["profiles"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function removeAvatar() {
    if (!isMe || !me) return;
    try {
      if (avatar && !/^https?:\/\//i.test(avatar) && avatar.startsWith(`${me}/`)) {
        await supabase.storage.from("avatars").remove([avatar]);
      }
      const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", me);
      if (error) throw error;
      setAvatar("");
      toast.success("Profile picture removed");
      qc.invalidateQueries({ queryKey: ["profiles"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not remove picture");
    }
  }

  const mine = useMemo(
    () => (results.data ?? []).filter((r) => r.user_id === id),
    [results.data, id],
  );
  const total = mine.reduce((s, r) => s + Number(r.net_result), 0);
  const avg = mine.length ? total / mine.length : 0;
  const best = mine.length ? Math.max(...mine.map((r) => Number(r.net_result))) : 0;
  const worst = mine.length ? Math.min(...mine.map((r) => Number(r.net_result))) : 0;
  const awards = mine.filter((r) => r.award).map((r) => r.award!);

  async function save() {
    const { error } = await supabase
      .from("profiles")
      .update({
        name: name.trim(),
        nickname: nickname.trim() || null,
        avatar_url: avatar.trim() || null,
      })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
    qc.invalidateQueries({ queryKey: ["profiles"] });
  }

  return (
    <AppShell>
      <div className="animate-in fade-in duration-500 mb-6 flex items-center gap-4">
        <div
          className="chip-ring h-16 w-16 shrink-0 rounded-full shadow-gold"
          style={
            avatarDisplay
              ? {
                  backgroundImage: `url(${avatarDisplay})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        />
        <div className="flex-1">
          <h1 className="font-display text-3xl font-bold">
            {formatDisplayName(profile?.name, profile?.nickname)}
          </h1>
          {profile?.nickname && <div className="text-sm text-muted-foreground">{profile.name}</div>}
        </div>
      </div>

      <div className="animate-in fade-in duration-500 grid gap-4 md:grid-cols-4">
        <Stat label="Games played" value={String(mine.length)} />
        <Stat label="Total P&L" value={formatMoney(total)} tone={total >= 0 ? "up" : "down"} />
        <Stat label="Avg / night" value={formatMoney(avg)} tone={avg >= 0 ? "up" : "down"} />
        <Stat label="Best / worst" value={`${formatMoney(best)} / ${formatMoney(worst)}`} />
      </div>

      <PlayerStatsPanel results={mine} nights={nights.data} />

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="card-felt shadow-card rounded-2xl p-5 lg:col-span-2">
          <div className="mb-3 font-display text-lg font-semibold">Recent performance</div>
          {mine.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-sm text-muted-foreground">
              No results yet.
            </div>
          ) : (
            <ul className="space-y-2 text-sm">
              {mine
                .slice(-10)
                .reverse()
                .map((r) => {
                  const n = nights.data?.find((x) => x.id === r.night_id);
                  return (
                    <li
                      key={r.id}
                      className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2 transition-colors duration-150 hover:bg-background/50"
                    >
                      <div>
                        <div>{n?.title ?? "Poker game"}</div>
                        <div className="text-xs text-muted-foreground">
                          {n && formatEUDate(n.starts_at)}
                        </div>
                      </div>
                      <div
                        className={
                          "font-mono tabular-nums " +
                          (Number(r.net_result) >= 0 ? "text-emerald-400" : "text-red-400")
                        }
                      >
                        {formatMoney(Number(r.net_result), n?.currency)}
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>

        <div className="card-felt shadow-card rounded-2xl p-5">
          <div className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
            <Award className="h-4 w-4 text-gold" />
            Awards
          </div>
          {awards.length === 0 ? (
            <div className="text-sm text-muted-foreground">No awards yet. Play harder.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {awards.map((a, i) => (
                <span
                  key={i}
                  className="rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs text-gold"
                >
                  {AWARDS.find((x) => x.value === a)?.label ?? a}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {canEditName && (
        <div className="card-felt shadow-card mt-6 rounded-2xl p-5">
          <div className="mb-3 font-display text-lg font-semibold">
            {isMe ? "Edit profile" : `Edit ${profile?.name || "player"} (admin)`}
          </div>
          {isMe && (
            <div className="mb-4 flex items-center gap-4">
              <div
                className="h-20 w-20 shrink-0 rounded-full border border-border/60 bg-background/40"
                style={
                  avatarDisplay
                    ? {
                        backgroundImage: `url(${avatarDisplay})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }
                    : undefined
                }
              />
              <div className="flex flex-col gap-2">
                <Label>Profile picture</Label>
                <div className="flex items-center gap-2">
                  <Button asChild size="sm" variant="outline" disabled={uploading}>
                    <label className="cursor-pointer">
                      <Upload className="mr-2 h-4 w-4" />
                      {uploading ? "Uploading…" : avatar ? "Replace" : "Upload"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadAvatar(f);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </Button>
                  {avatar && (
                    <Button size="sm" variant="ghost" onClick={removeAvatar} disabled={uploading}>
                      <Trash2 className="mr-2 h-4 w-4" /> Remove
                    </Button>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">PNG or JPG, up to 5 MB.</div>
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
            <div>
              <Label>Nickname</Label>
              <Input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={40}
              />
            </div>
          </div>
          <Button className="mt-4 bg-gold shadow-gold" onClick={save}>
            Save profile
          </Button>
        </div>
      )}
      {isMe && (
        <div className="card-felt shadow-card mt-6 rounded-2xl">
          <button
            type="button"
            onClick={() => setShowNotifSettings((v) => !v)}
            className="flex w-full items-center justify-between gap-2 p-5 text-left"
            aria-expanded={showNotifSettings}
          >
            <span className="flex items-center gap-2 font-display text-lg font-semibold">
              <Bell className="h-4 w-4 text-gold" /> Notification settings
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${showNotifSettings ? "rotate-180" : ""}`}
            />
          </button>
          {showNotifSettings && (
            <div className="border-t border-border/60 px-5 pb-5 pt-4">
              <PushNotificationSettings compact />
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="card-felt rounded-2xl p-4 transition-colors duration-200 hover:border-gold/25">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          "mt-1 font-mono text-xl tabular-nums " +
          (tone === "up"
            ? "text-emerald-400"
            : tone === "down"
              ? "text-red-400"
              : "text-foreground")
        }
      >
        {value}
      </div>
    </div>
  );
}
