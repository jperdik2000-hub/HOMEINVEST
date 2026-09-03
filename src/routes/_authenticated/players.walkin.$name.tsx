import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlayerStatsPanel } from "@/components/PlayerStatsPanel";
import { AppShell } from "@/components/AppShell";
import {
  AWARDS,
  fetchAllResults,
  fetchNights,
  fetchProfiles,
  formatDisplayName,
  formatEUDate,
  formatMoney,
} from "@/lib/poker";
import { Award, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { linkWalkinToUser } from "@/lib/walkin.functions";
import { inviteUserByEmail } from "@/lib/invite-user.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { UserPlus, Mail } from "lucide-react";

export const Route = createFileRoute("/_authenticated/players/walkin/$name")({
  head: () => ({ meta: [{ title: "Walk-in — Poker Club" }] }),
  component: WalkinPlayer,
});

function WalkinPlayer() {
  const { name } = Route.useParams();
  const decoded = decodeURIComponent(name);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const results = useQuery({ queryKey: ["results"], queryFn: fetchAllResults });
  const nights = useQuery({ queryKey: ["nights"], queryFn: fetchNights });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });

  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);
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

  const linkFn = useServerFn(linkWalkinToUser);
  const inviteFn = useServerFn(inviteUserByEmail);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState<"link" | "invite" | null>(null);

  async function handleLink() {
    if (!selectedUser) {
      toast.error("Pick a registered player");
      return;
    }
    setBusy("link");
    try {
      const res = await linkFn({ data: { walkinName: decoded, userId: selectedUser } });
      toast.success(
        `Linked ${res.linkedCount} past game${res.linkedCount === 1 ? "" : "s"} to that player`,
      );
      await qc.invalidateQueries({ queryKey: ["results"] });
      navigate({ to: "/players/$id", params: { id: res.userId } });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to link");
    } finally {
      setBusy(null);
    }
  }

  async function handleInvite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      toast.error("Enter an email");
      return;
    }
    setBusy("invite");
    try {
      await inviteFn({ data: { email } });
      toast.success("Invite sent — link this walk-in once they sign up");
      setInviteEmail("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to invite");
    } finally {
      setBusy(null);
    }
  }

  const mine = useMemo(
    () =>
      (results.data ?? []).filter(
        (r: any) =>
          !r.user_id && (r.player_name || "").trim().toLowerCase() === decoded.trim().toLowerCase(),
      ),
    [results.data, decoded],
  );

  const total = mine.reduce((s: number, r: any) => s + Number(r.net_result), 0);
  const avg = mine.length ? total / mine.length : 0;
  const best = mine.length ? Math.max(...mine.map((r: any) => Number(r.net_result))) : 0;
  const worst = mine.length ? Math.min(...mine.map((r: any) => Number(r.net_result))) : 0;
  const awards = mine.filter((r: any) => r.award).map((r: any) => r.award!);

  const registered = (profiles.data ?? [])
    .slice()
    .sort((a, b) =>
      formatDisplayName(a.name, a.nickname).localeCompare(formatDisplayName(b.name, b.nickname)),
    );

  return (
    <AppShell>
      <div className="animate-in fade-in duration-500 mb-6 flex items-center gap-4">
        <div className="chip-ring flex h-16 w-16 shrink-0 items-center justify-center rounded-full shadow-gold">
          <Users className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold">{decoded}</h1>
          <div className="text-sm text-muted-foreground">Walk-in player</div>
        </div>
      </div>

      <div className="animate-in fade-in duration-500 grid gap-4 md:grid-cols-4">
        <Stat label="Games played" value={String(mine.length)} />
        <Stat label="Total P&L" value={formatMoney(total)} tone={total >= 0 ? "up" : "down"} />
        <Stat label="Avg / night" value={formatMoney(avg)} tone={avg >= 0 ? "up" : "down"} />
        <Stat label="Best / worst" value={`${formatMoney(best)} / ${formatMoney(worst)}`} />
      </div>

      <PlayerStatsPanel results={mine} nights={nights.data} />

      {isAdmin && (
        <div className="card-felt shadow-card mt-6 rounded-2xl p-5">
          <div className="mb-1 flex items-center gap-2 font-display text-lg font-semibold">
            <UserPlus className="h-4 w-4 text-gold" />
            Convert to registered player
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            Admin only. Link this walk-in's past games to a real account so future stats stack
            together.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-background/30 p-4">
              <div className="mb-2 text-sm font-medium">Link to an existing player</div>
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="mb-3 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
              >
                <option value="">Select a registered player…</option>
                {registered.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatDisplayName(p.name, p.nickname)} ({p.email})
                  </option>
                ))}
              </select>
              <Button
                onClick={handleLink}
                disabled={busy !== null || !selectedUser}
                className="w-full"
              >
                {busy === "link"
                  ? "Linking…"
                  : `Link ${mine.length} past game${mine.length === 1 ? "" : "s"}`}
              </Button>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/30 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Mail className="h-4 w-4" /> Invite them to sign up
              </div>
              <Input
                type="email"
                placeholder="player@email.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="mb-3"
              />
              <Button
                onClick={handleInvite}
                disabled={busy !== null || !inviteEmail.trim()}
                variant="secondary"
                className="w-full"
              >
                {busy === "invite" ? "Sending…" : "Send invite"}
              </Button>
              <p className="mt-2 text-[11px] text-muted-foreground">
                After they create their account, come back here and link the walk-in to their
                profile.
              </p>
            </div>
          </div>
        </div>
      )}

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
                .map((r: any) => {
                  const n = nights.data?.find((x: any) => x.id === r.night_id);
                  return (
                    <li
                      key={r.id}
                      className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2 transition-colors duration-150 hover:bg-background/50"
                    >
                      <div>
                        <div>
                          {n ? (
                            <Link
                              to="/nights/$id"
                              params={{ id: n.id }}
                              className="hover:text-gold"
                            >
                              {n.title ?? "Poker game"}
                            </Link>
                          ) : (
                            "Poker game"
                          )}
                        </div>
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
            <div className="text-sm text-muted-foreground">No awards yet.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {awards.map((a: string, i: number) => (
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
