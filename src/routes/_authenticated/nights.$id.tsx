import { createFileRoute, Link, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { formatMoney, AWARDS, formatEUDateTime, formatDisplayName, fetchProfiles } from "@/lib/poker";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Calendar, MapPin, Coins, Users, Trash2, Trophy, Pencil, Plus, Minus, UserPlus, Play, MessageSquare, Tv } from "lucide-react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listInviteProfiles } from "@/lib/invite-profiles.functions";
import { notifyInvitesSent, remindPendingInvitees } from "@/lib/push.functions";
import { DebtLedger } from "@/components/DebtLedger";
import { TournamentPanel } from "@/components/TournamentPanel";
import { isTournament } from "@/lib/tournament";
import { GameBreakBanner } from "@/components/GameBreakBanner";

export const Route = createFileRoute("/_authenticated/nights/$id")({
  head: () => ({ meta: [{ title: "Poker Club" }] }),
  component: NightPage,
});

function NightPage() {
  const { id } = Route.useParams();
  const hasChildMatch = useRouterState({
    select: (state) => state.matches.some((match) =>
      match.routeId === "/_authenticated/nights/$id/edit" ||
      match.routeId === "/_authenticated/nights/$id/results" ||
      match.routeId === "/_authenticated/nights/$id/chat",
    ),
  });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)); }, []);
  const isAdminQ = useQuery({
    queryKey: ["is-admin", me],
    enabled: !!me,
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", me!).eq("role", "admin").maybeSingle();
      return !!data;
    },
  });
  const isAdmin = !!isAdminQ.data;
  const sendReminder = useServerFn(remindPendingInvitees);
  const [reminding, setReminding] = useState(false);
  const [selectedResponder, setSelectedResponder] = useState<string>("");
  async function sendPendingReminders() {
    setReminding(true);
    try {
      const res: any = await sendReminder({ data: { nightId: id } });
      if (!res?.targets) toast.info("No pending invitees to remind.");
      else toast.success(`Reminder sent to ${res.targets} invitee${res.targets === 1 ? "" : "s"}.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send reminder");
    } finally { setReminding(false); }
  }

  const night = useQuery({
    queryKey: ["night", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("poker_nights").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });
  const rsvps = useQuery({
    queryKey: ["rsvps", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("rsvps").select("*").eq("night_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });
  const invites = useQuery({
    queryKey: ["invites", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("invitations").select("*").eq("night_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });
  const results = useQuery({
    queryKey: ["night-results", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("player_results").select("*").eq("night_id", id).order("final_rank", { nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const profilesQ = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });
  const profileById = new Map((profilesQ.data ?? []).map((p) => [p.id, p]));
  const displayNameFor = (r: any): string => {
    if (r?.user_id) {
      const p = profileById.get(r.user_id);
      if (p) return formatDisplayName(p.name, p.nickname, r.name || r.email || "Player");
    }
    return r?.name || r?.email || "Player";
  };

  if (night.isLoading) return <AppShell><div className="text-muted-foreground">Loading…</div></AppShell>;
  if (!night.data) return <AppShell><div>Not found.</div></AppShell>;

  const n = night.data;
  const isHost = me === n.host_id;
  const isRebuyManager = !!me && me === (n as any).rebuy_manager_id;
  const canEditRebuys = isHost || isRebuyManager;
  const startedAt = (n as any).started_at as string | null;
  const isLive = !!startedAt && n.status !== "cancelled" && n.status !== "completed";
  const isTourney = isTournament(n as any);
  const canSeeLiveTab = canEditRebuys && !isTourney;
  const defaultTab = isTourney ? "tournament" : isLive ? "playing" : "details";

  async function setRsvp(status: "attending" | "maybe" | "declined") {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;
    const { error } = await supabase.from("rsvps").upsert({
      night_id: id, user_id: user.user.id, email: user.user.email!, name: (user.user.user_metadata?.name as string) ?? user.user.email, status,
    }, { onConflict: "night_id,email" });
    if (error) { toast.error(error.message); return; }
    toast.success("RSVP saved");
    qc.invalidateQueries({ queryKey: ["rsvps", id] });
  }

  async function setRsvpFor(
    person: { user_id: string; email: string; name: string },
    status: "attending" | "maybe" | "declined",
  ) {
    const { error } = await supabase.from("rsvps").upsert(
      { night_id: id, user_id: person.user_id, email: person.email, name: person.name, status },
      { onConflict: "night_id,email" },
    );
    if (error) { toast.error(error.message); return; }
    toast.success(`${person.name} marked ${status === "attending" ? "in" : status === "maybe" ? "maybe" : "can't play"}`);
    qc.invalidateQueries({ queryKey: ["rsvps", id] });
  }


  async function deleteNight() {
    if (!confirm("Permanently delete this poker game? Stats will not be saved.")) return;
    const { error } = await supabase.from("poker_nights").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Night deleted");
    qc.invalidateQueries({ queryKey: ["nights"] });
    qc.invalidateQueries({ queryKey: ["results"] });
    qc.invalidateQueries({ queryKey: ["night-results", id] });
    qc.invalidateQueries({ queryKey: ["live-results", id] });
    qc.invalidateQueries({ queryKey: ["leaderboard"] });
    navigate({ to: "/dashboard" });
  }

  async function startGame() {
    const { error } = await supabase.from("poker_nights").update({ started_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Game started");
    qc.invalidateQueries({ queryKey: ["night", id] });
  }

  async function undoStartGame() {
    if (!confirm("Undo start? The game will go back to not started.")) return;
    const { error } = await supabase.from("poker_nights").update({ started_at: null }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Start undone");
    qc.invalidateQueries({ queryKey: ["night", id] });
  }

  const myRsvp = rsvps.data?.find((r) => r.user_id === me);
  const attendingRsvps = rsvps.data?.filter((r) => r.status === "attending") ?? [];
  const attendingWithNames = attendingRsvps.map((r: any) => ({ ...r, name: displayNameFor(r) }));
  const rsvpNames = new Set(attendingWithNames.map((r) => (r.name || r.email || "").toLowerCase()));
  const rsvpUserIds = new Set(attendingRsvps.map((r) => r.user_id).filter(Boolean));
  const walkIns = (results.data ?? [])
    .filter((r: any) => !r.user_id || !rsvpUserIds.has(r.user_id))
    .filter((r: any) => !rsvpNames.has((r.player_name || "").toLowerCase()))
    .map((r: any) => ({ id: `walkin-${r.id}`, name: r.player_name, email: null, isWalkIn: true }));
  const attending = [...attendingWithNames, ...walkIns];
  const maybe = (rsvps.data?.filter((r) => r.status === "maybe") ?? []).map((r: any) => ({ ...r, name: displayNameFor(r) }));
  const declined = (rsvps.data?.filter((r) => r.status === "declined") ?? []).map((r: any) => ({ ...r, name: displayNameFor(r) }));

  const rsvpByUserId = new Map((rsvps.data ?? []).filter((r: any) => r.user_id).map((r: any) => [r.user_id, r.status]));
  const pendingInvitees = (invites.data ?? [])
    .filter((i: any) => i.invited_user_id && !rsvpByUserId.has(i.invited_user_id))
    .map((i: any) => ({
      id: `inv-${i.id}`,
      inviteId: i.id,
      name: displayNameFor({ user_id: i.invited_user_id, name: i.invited_name, email: i.invited_email })
        || (i.invited_email ? i.invited_email.split("@")[0] : "Invited"),
      email: i.invited_email,
    }));
  const reminderTargets = (invites.data ?? [])
    .filter((i: any) => i.invited_user_id && (!rsvpByUserId.has(i.invited_user_id) || rsvpByUserId.get(i.invited_user_id) === "maybe"))
    .map((i: any) => ({
      id: `inv-${i.id}`,
      name: displayNameFor({ user_id: i.invited_user_id, name: i.invited_name, email: i.invited_email })
        || (i.invited_email ? i.invited_email.split("@")[0] : "Invited"),
      email: i.invited_email,
    }));

  const manualPeople = (() => {
    const map = new Map<string, { user_id: string; email: string; name: string; status: string | null }>();
    for (const i of (invites.data ?? []) as any[]) {
      if (!i.invited_user_id) continue;
      map.set(i.invited_user_id, {
        user_id: i.invited_user_id,
        email: i.invited_email,
        name:
          displayNameFor({ user_id: i.invited_user_id, name: i.invited_name, email: i.invited_email }) ||
          (i.invited_email ? i.invited_email.split("@")[0] : "Invited"),
        status: rsvpByUserId.get(i.invited_user_id) ?? null,
      });
    }
    for (const r of (rsvps.data ?? []) as any[]) {
      if (!r.user_id) continue;
      map.set(r.user_id, {
        user_id: r.user_id,
        email: r.email,
        name: displayNameFor(r) || r.email,
        status: r.status,
      });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();
  const selectedPerson = manualPeople.find((p) => p.user_id === selectedResponder) ?? null;

  const canManage = isHost || isAdmin;

  async function removeInvitation(inviteId: string) {
    if (!confirm("Remove this invitation?")) return;
    const { error } = await supabase.from("invitations").delete().eq("id", inviteId);
    if (error) return toast.error(error.message);
    toast.success("Invitation removed");
    qc.invalidateQueries({ queryKey: ["invites", id] });
  }
  async function removeRsvp(rsvpId: string) {
    if (!confirm("Remove this person from the night?")) return;
    const { error } = await supabase.from("rsvps").delete().eq("id", rsvpId);
    if (error) return toast.error(error.message);
    toast.success("Removed");
    qc.invalidateQueries({ queryKey: ["rsvps", id] });
  }

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/nights/${id}` : "";

  if (hasChildMatch) {
    return <Outlet />;
  }

  return (
    <AppShell>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0 sm:flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="font-display min-w-0 flex-1 truncate text-2xl font-bold sm:text-3xl md:text-4xl">{n.title}</h1>
            <div className="flex shrink-0 items-center gap-2">
              {isHost && n.status !== "cancelled" && (
                <>
                  <Button asChild variant="outline" size="sm">
                    <Link to="/nights/$id/edit" params={{ id }}><Pencil className="mr-1 h-4 w-4"/>Edit</Link>
                  </Button>
                  <Button variant="outline" size="sm" onClick={deleteNight}><Trash2 className="mr-1 h-4 w-4"/>Delete</Button>
                </>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><Calendar className="h-4 w-4 text-gold"/>{formatEUDateTime(n.starts_at)}</span>
            {n.location && <span className="flex items-center gap-1"><MapPin className="h-4 w-4 text-gold"/>{n.location}</span>}
            <span className="flex items-center gap-1"><Coins className="h-4 w-4 text-gold"/>{formatMoney(Number(n.buy_in), n.currency)} buy-in</span>
            <span className="rounded bg-gold/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-gold">
              {isTourney ? "Tournament" : "Cash game"}
            </span>
            {isTourney && (
              <span className="flex items-center gap-1">
                <span className="font-mono text-gold">{Number((n as any).starting_stack || 0).toLocaleString()}</span> starting chips
              </span>
            )}
            {Number((n as any).buy_in_chips) > 0 && (
              <span className="flex items-center gap-1 text-muted-foreground">
                = <span className="font-mono text-gold">{Number((n as any).buy_in_chips).toLocaleString()}</span> chips
              </span>
            )}
          </div>
          {n.status === "cancelled" && <div className="mt-2 inline-block rounded bg-destructive/20 px-2 py-1 text-xs text-destructive">Cancelled</div>}
          {n.status === "completed" && <div className="mt-2 inline-block rounded bg-emerald-500/20 px-2 py-1 text-xs text-emerald-400">Completed</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => { navigator.clipboard.writeText(shareUrl); toast.success("Link copied"); }}>Copy link</Button>
          <Button asChild variant="outline">
            <Link to="/nights/$id/chat" params={{ id }}><MessageSquare className="mr-1 h-4 w-4"/>Chat</Link>
          </Button>
          {canEditRebuys && (
            <Button asChild variant="outline">
              <Link to="/game/$gameId/tv-control" params={{ gameId: id }}><Tv className="mr-1 h-4 w-4"/>Connect to TV</Link>
            </Button>
          )}
          {isHost && n.status !== "cancelled" && (
            <>
              {!startedAt && n.status !== "completed" && (
                <Button className="bg-emerald-500 hover:bg-emerald-500/90 text-white" onClick={startGame}>
                  <Play className="mr-1 h-4 w-4"/>Start game
                </Button>
              )}
              {startedAt && n.status !== "completed" && (
                <Button variant="outline" onClick={undoStartGame}>
                  Undo start
                </Button>
              )}
              {startedAt && (
                <Button asChild className="bg-gold shadow-gold">
                  <Link to="/nights/$id/results" params={{ id }}><Trophy className="mr-1 h-4 w-4"/>Log results</Link>
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {n.notes && (
        <div className="card-felt mb-6 rounded-2xl p-4 text-sm">
          <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Notes from the host</div>
          <div className="whitespace-pre-wrap">{n.notes}</div>
        </div>
      )}

      {isLive && <GameBreakBanner nightId={id} canManage={canManage} />}

      <Tabs defaultValue={defaultTab}>

        <TabsList className="mb-4">
          {isTourney && <TabsTrigger value="tournament">Tournament</TabsTrigger>}
          {isLive && !isTourney && <TabsTrigger value="playing">Playing now</TabsTrigger>}
          <TabsTrigger value="details">Details</TabsTrigger>
          {canSeeLiveTab && <TabsTrigger value="live">Live re-buys</TabsTrigger>}
        </TabsList>

        <TabsContent value="details">
        <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-felt shadow-card rounded-2xl p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-display text-lg font-semibold"><Users className="mr-1 inline h-4 w-4 text-gold"/>Attending ({attending.length})</div>
            {n.status !== "cancelled" && !startedAt && n.status !== "completed" && (
              <div className="flex gap-1">
                <Button size="sm" variant={myRsvp?.status === "attending" ? "default" : "outline"} onClick={() => setRsvp("attending")} className={myRsvp?.status === "attending" ? "bg-gold" : ""}>I'm in</Button>
                <Button size="sm" variant={myRsvp?.status === "maybe" ? "default" : "outline"} onClick={() => setRsvp("maybe")}>Maybe</Button>
                <Button size="sm" variant={myRsvp?.status === "declined" ? "default" : "outline"} onClick={() => setRsvp("declined")}>Can't</Button>
              </div>
            )}
          </div>
          {canManage && n.status !== "cancelled" && (
            <div className="mt-4 rounded-xl border border-gold/25 bg-background/40 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gold">Answer for a player</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                For players who tell you in person instead of using the app.
              </div>
              <div className="mt-3 grid gap-3">
                {manualPeople.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No invited players yet — invite players first.</div>
                ) : (
                  <>
                    <Select
                      value={selectedResponder}
                      onValueChange={setSelectedResponder}
                    >
                      <SelectTrigger className="w-full bg-background/60">
                        <SelectValue placeholder="Select a player…" />
                      </SelectTrigger>
                      <SelectContent>
                        {manualPeople.map((p) => (
                          <SelectItem key={p.user_id} value={p.user_id}>
                            {p.name} {p.status ? `(${p.status})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedPerson && (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/60 p-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{selectedPerson.name}</span>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="sm"
                            variant={selectedPerson.status === "attending" ? "default" : "outline"}
                            className={selectedPerson.status === "attending" ? "bg-gold" : ""}
                            onClick={() => setRsvpFor(selectedPerson, "attending")}
                          >
                            In
                          </Button>
                          <Button size="sm" variant={selectedPerson.status === "maybe" ? "default" : "outline"} onClick={() => setRsvpFor(selectedPerson, "maybe")}>
                            Maybe
                          </Button>
                          <Button size="sm" variant={selectedPerson.status === "declined" ? "default" : "outline"} onClick={() => setRsvpFor(selectedPerson, "declined")}>
                            Can't
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          <RsvpList title="Attending" items={attending} canRemove={canManage} onRemove={removeRsvp} />
          <RsvpList title="Maybe" items={maybe} canRemove={canManage} onRemove={removeRsvp} />
          <RsvpList title="Declined" items={declined} canRemove={canManage} onRemove={removeRsvp} />
          <RsvpList title="Invited (no reply yet)" items={pendingInvitees} canRemove={canManage} onRemove={(_, item) => removeInvitation(item.inviteId)} />

          {isAdmin && reminderTargets.length > 0 && (
            <Button size="sm" variant="outline" onClick={sendPendingReminders} disabled={reminding} className="mt-1">
              {reminding ? "Sending…" : `Remind ${reminderTargets.length} pending/maybe`}
            </Button>
          )}
          {invites.data && invites.data.length > 0 && (
            <div className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              {invites.data.length} invitation{invites.data.length === 1 ? "" : "s"} sent
            </div>
          )}
          {isHost && (
            <InviteRegisteredFriends
              nightId={id}
              startsAt={n.starts_at}
              title={n.title}
              location={n.location}
              buyIn={n.buy_in != null ? formatMoney(Number(n.buy_in), n.currency) : null}
              existingInviteeIds={new Set((invites.data ?? []).map((i: any) => i.invited_user_id).filter(Boolean))}
              attendingUserIds={new Set(attendingRsvps.map((r: any) => r.user_id).filter(Boolean))}
            />
          )}
        </div>

        <div className="card-felt shadow-card rounded-2xl p-5">
          <div className="mb-3 font-display text-lg font-semibold"><Trophy className="mr-1 inline h-4 w-4 text-gold"/>Results</div>
          {results.data && results.data.length > 0 ? (
            <ol className="space-y-2 text-sm">
              {results.data.map((r: any, i: number) => (
                <li key={r.id} className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-gold">#{r.final_rank ?? i + 1}</span>
                      <span>{r.player_name}</span>
                    </div>
                    {isAdmin ? (
                      <select
                        className="mt-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
                        value={r.award ?? ""}
                        onChange={async (e) => {
                          const value = e.target.value || null;
                          const { error } = await supabase.from("player_results").update({ award: value }).eq("id", r.id);
                          if (error) { toast.error(error.message); return; }
                          toast.success("Award updated");
                          qc.invalidateQueries({ queryKey: ["night-results", id] });
                          qc.invalidateQueries({ queryKey: ["results"] });
                        }}
                      >
                        <option value="">No award</option>
                        {AWARDS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                      </select>
                    ) : (
                      r.award && <div className="text-xs text-muted-foreground">{AWARDS.find(a => a.value === r.award)?.label}</div>
                    )}
                  </div>
                  <div className={"font-mono " + (Number(r.net_result) >= 0 ? "text-emerald-400" : "text-red-400")}>{formatMoney(Number(r.net_result), n.currency)}</div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="rounded-md border border-dashed border-border/60 p-3 text-center text-sm text-muted-foreground">No results yet.</div>
          )}
        </div>
        </div>
        <div className="mt-4">
          <DebtLedger nightId={id} currency={n.currency} isHost={isHost} currentUserId={me} />
        </div>
        </TabsContent>

        {isTourney && (
          <TabsContent value="tournament">
            <TournamentPanel
              night={n as any}
              canManage={isHost || isAdmin}
              attendingRsvps={attendingRsvps}
              profiles={profilesQ.data ?? []}
            />
          </TabsContent>
        )}

        {isLive && !isTourney && (
          <TabsContent value="playing">
            <PlayingNow nightId={id} currency={n.currency} profiles={profilesQ.data ?? []} />
          </TabsContent>
        )}

        {canSeeLiveTab && (
          <TabsContent value="live">
            <LiveRebuyTracker
              nightId={id}
              defaultBuyIn={Number(n.buy_in)}
              currency={n.currency}
              canEdit={canEditRebuys}
              attendingRsvps={attendingRsvps}
              profiles={profilesQ.data ?? []}
              isHost={isHost}
              rebuyManagerId={(n as any).rebuy_manager_id ?? null}
            />
          </TabsContent>
        )}
      </Tabs>
    </AppShell>
  );
}

function RsvpList({ title, items, canRemove, onRemove }: { title: string; items: any[]; canRemove?: boolean; onRemove?: (id: string, item: any) => void }) {
  if (!items.length) return null;
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((r) => (
          <span key={r.id} className="rounded-full border border-border/60 bg-background/40 px-3 py-1 text-xs">
            {r.isWalkIn ? (
              <Link
                to="/players/walkin/$name"
                params={{ name: encodeURIComponent(r.name || "") }}
                className="hover:text-gold"
              >
                {r.name || r.email}
              </Link>
            ) : r.user_id ? (
              <Link to="/players/$id" params={{ id: r.user_id }} className="hover:text-gold">
                {r.name || r.email}
              </Link>
            ) : (
              <>{r.name || r.email}</>
            )}
            {r.isWalkIn && <span className="ml-1 text-[10px] uppercase tracking-wide text-gold">walk-in</span>}
            {canRemove && !r.isWalkIn && onRemove && (
              <button
                type="button"
                aria-label="Remove"
                onClick={() => onRemove(r.id, r)}
                className="ml-2 text-muted-foreground hover:text-destructive"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function InviteRegisteredFriends({ nightId, startsAt, title, location, buyIn, existingInviteeIds, attendingUserIds }: {
  nightId: string; startsAt: string; title: string; location: string | null;
  buyIn: string | null; existingInviteeIds: Set<string>; attendingUserIds: Set<string>;
}) {
  const qc = useQueryClient();
  const loadInviteProfiles = useServerFn(listInviteProfiles);
  const notifyInvites = useServerFn(notifyInvitesSent);
  const profiles = useQuery({ queryKey: ["invite-profiles"], queryFn: () => loadInviteProfiles() });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [me, setMe] = useState<{ id: string; name?: string; email?: string } | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setMe({ id: data.user.id, name: data.user.user_metadata?.name as string | undefined, email: data.user.email ?? undefined });
    });
  }, []);

  const available = (profiles.data ?? []).filter(
    (p) => p.id !== me?.id && !existingInviteeIds.has(p.id) && !attendingUserIds.has(p.id),
  );

  function toggle(id: string) {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  }

  async function sendInvites() {
    if (selected.size === 0) return;
    setSending(true);
    try {
      const chosen = available.filter((p) => selected.has(p.id));
      const rows = chosen.map((p) => ({
        night_id: nightId, invited_user_id: p.id, invited_email: p.email, invited_name: p.name,
      }));
      const { data: createdInvites, error } = await supabase
        .from("invitations")
        .insert(rows)
        .select("id, invited_email, invited_name, token");
      if (error) throw error;

      const whenText = formatEUDateTime(startsAt);
      toast.success(`${createdInvites?.length ?? 0} invite${(createdInvites?.length ?? 0) === 1 ? "" : "s"} sent.`);

      try {
        await notifyInvites({ data: { nightId, userIds: chosen.map((p) => p.id), whenText } });
      } catch (err) { console.warn("push notify failed", err); }

      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["invites", nightId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send invites");
    } finally { setSending(false); }
  }

  return (
    <div className="mt-4 border-t border-border/60 pt-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Invite registered members</div>
      {profiles.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading members…</div>
      ) : available.length === 0 ? (
        <div className="text-sm text-muted-foreground">Everyone's already invited or attending.</div>
      ) : (
        <>
          <div className="grid gap-1 rounded-md border border-border/60 bg-background/30 p-2 max-h-48 overflow-auto">
            {available.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-background/40">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                <span className="text-sm">{formatDisplayName(p.name, p.nickname)} <span className="text-muted-foreground">· {p.email}</span></span>
              </label>
            ))}
          </div>
          <Button onClick={sendInvites} disabled={sending || selected.size === 0} className="mt-2 bg-gold shadow-gold">
            <UserPlus className="mr-1 h-4 w-4" />
            {sending ? "Sending…" : `Invite ${selected.size || ""} selected`.trim()}
          </Button>
        </>
      )}
    </div>
  );
}

function PlayingNow({ nightId, currency, profiles }: { nightId: string; currency: string; profiles: { id: string; name: string; nickname: string | null; email: string; avatar_url: string | null }[] }) {
  const qc = useQueryClient();
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const nameForRow = (r: any): string => {
    if (r?.user_id) {
      const p = profileById.get(r.user_id);
      if (p) return formatDisplayName(p.name, p.nickname, r.player_name || "Player");
    }
    return r?.player_name || "Player";
  };
  const live = useQuery({
    queryKey: ["live-results", nightId],
    queryFn: async () => {
      const { data, error } = await supabase.from("player_results").select("*").eq("night_id", nightId);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 5000,
  });

  useEffect(() => {
    const ch = supabase.channel(`playing-${nightId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "player_results", filter: `night_id=eq.${nightId}` }, () => {
        qc.invalidateQueries({ queryKey: ["live-results", nightId] });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [nightId, qc]);

  const rows = (live.data ?? []).slice().sort((a: any, b: any) => (Number(b.buy_in || 0) + Number(b.rebuys || 0)) - (Number(a.buy_in || 0) + Number(a.rebuys || 0)));
  const totalPot = rows.reduce((s, r) => s + Number(r.buy_in || 0) + Number(r.rebuys || 0), 0);
  const totalRebuys = rows.reduce((s, r) => s + Number(r.rebuys || 0), 0);
  const totalBuyIns = rows.reduce((s, r) => s + Number(r.buy_in || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card-felt shadow-card rounded-2xl p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">On the table</div>
          <div className="font-display text-3xl text-gold">{formatMoney(totalPot, currency)}</div>
        </div>
        <div className="card-felt shadow-card rounded-2xl p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Buy-ins</div>
          <div className="font-display text-2xl">{formatMoney(totalBuyIns, currency)}</div>
        </div>
        <div className="card-felt shadow-card rounded-2xl p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Re-buys</div>
          <div className="font-display text-2xl">{formatMoney(totalRebuys, currency)}</div>
        </div>
      </div>

      <div className="card-felt shadow-card rounded-2xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg font-semibold">Players ({rows.length})</div>
          <div className="text-xs text-muted-foreground">Live · auto-updates</div>
        </div>
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-sm text-muted-foreground">Nobody is seated yet.</div>
        ) : (
          <ul className="space-y-2">
            {rows.map((r: any) => {
              const buyIn = Number(r.buy_in || 0);
              const rebuysAmt = Number(r.rebuys || 0);
              const total = buyIn + rebuysAmt;
              return (
                <li key={r.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 p-3">
                  <div>
                    <div className="font-medium">
                      {r.user_id ? (
                        <Link to="/players/$id" params={{ id: r.user_id }} className="hover:text-gold">
                          {nameForRow(r)}
                        </Link>
                      ) : (
                        <Link
                          to="/players/walkin/$name"
                          params={{ name: encodeURIComponent(r.player_name || "") }}
                          className="hover:text-gold"
                        >
                          {nameForRow(r)}
                        </Link>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">Buy-in {formatMoney(buyIn, currency)} · Re-buys {formatMoney(rebuysAmt, currency)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-xl text-gold leading-none">{formatMoney(total, currency)}</div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">total in</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function LiveRebuyTrackerImpl({ nightId, defaultBuyIn, currency, canEdit, attendingRsvps, profiles, isHost, rebuyManagerId }: {
  nightId: string; defaultBuyIn: number; currency: string; canEdit: boolean; attendingRsvps: any[];
  profiles: { id: string; name: string; nickname: string | null; email: string; avatar_url: string | null }[];
  isHost: boolean; rebuyManagerId: string | null;
}) {
  return <LiveRebuyTrackerBody nightId={nightId} defaultBuyIn={defaultBuyIn} currency={currency} canEdit={canEdit} attendingRsvps={attendingRsvps} profiles={profiles} isHost={isHost} rebuyManagerId={rebuyManagerId} />;
}

const LiveRebuyTracker = LiveRebuyTrackerImpl;

function LiveRebuyTrackerBody({ nightId, defaultBuyIn, currency, canEdit, attendingRsvps, profiles, isHost, rebuyManagerId }: {
  nightId: string; defaultBuyIn: number; currency: string; canEdit: boolean; attendingRsvps: any[];
  profiles: { id: string; name: string; nickname: string | null; email: string; avatar_url: string | null }[];
  isHost: boolean; rebuyManagerId: string | null;
}) {
  const qc = useQueryClient();
  const [walkIn, setWalkIn] = useState("");
  const [rebuyInputs, setRebuyInputs] = useState<Record<string, string>>({});
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const nameForRsvp = (r: any): string => {
    if (r?.user_id) {
      const p = profileById.get(r.user_id);
      if (p) return formatDisplayName(p.name, p.nickname, r.name || r.email || "Player");
    }
    return r?.name || r?.email || "Player";
  };
  const accountNameForRsvp = (r: any): string => {
    if (r?.user_id) {
      const p = profileById.get(r.user_id);
      if (p) return p.name || r.name || r.email || "Player";
    }
    return r?.name || r?.email || "Player";
  };
  const nameForRow = (r: any): string => {
    if (r?.user_id) {
      const p = profileById.get(r.user_id);
      if (p) return formatDisplayName(p.name, p.nickname, r.player_name || "Player");
    }
    return r?.player_name || "Player";
  };

  async function setManager(uid: string | null) {
    const { error } = await supabase.from("poker_nights").update({ rebuy_manager_id: uid }).eq("id", nightId);
    if (error) toast.error(error.message);
    else {
      toast.success(uid ? "Re-buy manager assigned" : "Re-buy manager cleared");
      qc.invalidateQueries({ queryKey: ["night", nightId] });
    }
  }
  const live = useQuery({
    queryKey: ["live-results", nightId],
    queryFn: async () => {
      const { data, error } = await supabase.from("player_results").select("*").eq("night_id", nightId);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 5000,
  });

  useEffect(() => {
    const ch = supabase.channel(`live-${nightId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "player_results", filter: `night_id=eq.${nightId}` }, () => {
        qc.invalidateQueries({ queryKey: ["live-results", nightId] });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [nightId, qc]);

  // Previously-used walk-in names across every night the user can see (RLS scoped).
  // Lets the host re-seat the same walk-in in future games so their stats accumulate.
  const pastWalkIns = useQuery({
    queryKey: ["past-walkins"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_results")
        .select("player_name, night_id")
        .is("user_id", null);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const r of (data ?? []) as { player_name: string | null }[]) {
        const n = (r.player_name || "").trim();
        if (!n) continue;
        counts.set(n, (counts.get(n) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([name, games]) => ({ name, games }))
        .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
    },
    staleTime: 60_000,
  });

  const rows = live.data ?? [];
  const byUser = new Map<string, any>();
  const byName = new Map<string, any>();
  for (const r of rows) {
    if (r.user_id) byUser.set(r.user_id, r);
    else byName.set(r.player_name.toLowerCase(), r);
  }

  async function joinPlayer(user_id: string | null, name: string) {
    if (!canEdit) return;
    const existing = user_id ? byUser.get(user_id) : byName.get(name.toLowerCase());
    if (existing) return;
    const { error } = await supabase.from("player_results").insert({
      night_id: nightId, user_id, player_name: name, buy_in: defaultBuyIn, rebuys: 0, cash_out: 0,
    });
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["live-results", nightId] });
  }

  async function addRebuyAmount(row: any, amount: number) {
    if (!canEdit) return;
    if (!Number.isFinite(amount) || amount === 0) return;
    const next = Math.max(0, Number(row.rebuys || 0) + amount);
    const { error } = await supabase.from("player_results").update({ rebuys: next }).eq("id", row.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["live-results", nightId] });
  }

  async function resetRebuys(row: any) {
    if (!canEdit) return;
    const { error } = await supabase.from("player_results").update({ rebuys: 0 }).eq("id", row.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["live-results", nightId] });
  }

  async function removeRow(row: any) {
    if (!canEdit) return;
    if (!confirm(`Remove ${row.player_name} from live table?`)) return;
    const { error } = await supabase.from("player_results").delete().eq("id", row.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["live-results", nightId] });
  }

  async function addWalkIn() {
    const name = walkIn.trim();
    if (!name) return;
    await joinPlayer(null, name);
    setWalkIn("");
  }

  const notJoined = attendingRsvps.filter((r) => !(r.user_id && byUser.has(r.user_id)) && !byName.has((r.name || r.email || "").toLowerCase()));
  const totalRebuys = rows.reduce((s, r) => s + Number(r.rebuys || 0), 0);
  const totalPot = rows.reduce((s, r) => s + Number(r.buy_in || 0) + Number(r.rebuys || 0), 0);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card-felt shadow-card rounded-2xl p-5 lg:col-span-2">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg font-semibold">At the table ({rows.length})</div>
          <div className="text-xs text-muted-foreground">Buy-in {formatMoney(defaultBuyIn, currency)} · Re-buys {formatMoney(totalRebuys, currency)} · Pot {formatMoney(totalPot, currency)}</div>
        </div>

        {rows.length === 0 && <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-sm text-muted-foreground">Nobody at the table yet. Add players from the right.</div>}

        <ul className="space-y-2">
          {rows.map((r) => {
            const buyIn = Number(r.buy_in || 0);
            const rebuysAmt = Number(r.rebuys || 0);
            const total = buyIn + rebuysAmt;
            const inputVal = rebuyInputs[r.id] ?? "";
            const submit = () => {
              const amt = Number(inputVal);
              if (!Number.isFinite(amt) || amt <= 0) return;
              addRebuyAmount(r, amt);
              setRebuyInputs((s) => ({ ...s, [r.id]: "" }));
            };
            return (
              <li key={r.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-[8rem]">
                    <div className="font-medium">
                      {r.user_id ? (
                        <Link to="/players/$id" params={{ id: r.user_id }} className="hover:text-gold">
                          {nameForRow(r)}
                        </Link>
                      ) : (
                        <Link
                          to="/players/walkin/$name"
                          params={{ name: encodeURIComponent(r.player_name || "") }}
                          className="hover:text-gold"
                        >
                          {nameForRow(r)}
                        </Link>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">Buy-in {formatMoney(buyIn, currency)} · Re-buys {formatMoney(rebuysAmt, currency)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder={`Re-buy ${currency}`}
                      className="w-28"
                      value={inputVal}
                      disabled={!canEdit}
                      onChange={(e) => setRebuyInputs((s) => ({ ...s, [r.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
                    />
                    <Button size="icon" className="bg-gold" disabled={!canEdit || !inputVal || Number(inputVal) <= 0} onClick={submit}><Plus className="h-4 w-4"/></Button>
                    <Button size="icon" variant="outline" disabled={!canEdit || rebuysAmt <= 0} onClick={() => resetRebuys(r)} title="Reset re-buys"><Minus className="h-4 w-4"/></Button>
                    <div className="w-24 text-right">
                      <div className="font-display text-xl text-gold leading-none">{formatMoney(total, currency)}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">total in</div>
                    </div>
                    {canEdit && <Button size="icon" variant="ghost" onClick={() => removeRow(r)}><Trash2 className="h-4 w-4"/></Button>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="card-felt shadow-card rounded-2xl p-5">
        <div className="mb-3 font-display text-lg font-semibold"><UserPlus className="mr-1 inline h-4 w-4 text-gold"/>Add player</div>
        {!canEdit && <div className="mb-3 rounded bg-muted/30 p-2 text-xs text-muted-foreground">Only the host or the assigned re-buy manager can update the live table.</div>}
        {isHost && (
          <div className="mb-4 rounded-lg border border-border/60 bg-background/30 p-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Re-buy manager</div>
            <div className="mb-2 text-xs text-muted-foreground">Delegate live re-buy edits to one attending player.</div>
            <div className="flex gap-2">
              <select
                className="flex-1 rounded-md border border-border/60 bg-background/40 px-2 py-1 text-sm"
                value={rebuyManagerId ?? ""}
                onChange={(e) => setManager(e.target.value || null)}
              >
                <option value="">— No one (host only) —</option>
                {attendingRsvps.filter((r) => r.user_id).map((r) => (
                  <option key={r.id} value={r.user_id}>{nameForRsvp(r)}</option>
                ))}
              </select>
              {rebuyManagerId && (
                <Button size="sm" variant="outline" onClick={() => setManager(null)}>Clear</Button>
              )}
            </div>
          </div>
        )}
        {!isHost && rebuyManagerId && canEdit && (
          <div className="mb-3 rounded bg-gold/10 p-2 text-xs text-gold">The host has assigned you as re-buy manager.</div>
        )}
        {notJoined.length > 0 && (
          <div className="mb-4">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Attending — tap to seat</div>
            <div className="flex flex-wrap gap-2">
              {notJoined.map((r) => (
                <button key={r.id} disabled={!canEdit} onClick={() => joinPlayer(r.user_id ?? null, accountNameForRsvp(r))}
                  className="rounded-full border border-border/60 bg-background/40 px-3 py-1 text-xs hover:bg-gold/20 disabled:opacity-50">
                  + {nameForRsvp(r)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Walk-in</div>
        <div className="flex gap-2">
          <Input placeholder="Name" value={walkIn} onChange={(e) => setWalkIn(e.target.value)} disabled={!canEdit}/>
          <Button onClick={addWalkIn} disabled={!canEdit || !walkIn.trim()} className="bg-gold"><Plus className="h-4 w-4"/></Button>
        </div>
        {(() => {
          const seatedWalkNames = new Set(
            rows.filter((r: any) => !r.user_id).map((r: any) => (r.player_name || "").trim().toLowerCase()),
          );
          const suggestions = (pastWalkIns.data ?? []).filter(
            (w) => !seatedWalkNames.has(w.name.toLowerCase()),
          );
          if (suggestions.length === 0) return null;
          return (
            <div className="mt-3">
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Previous walk-ins — tap to seat
              </div>
              <div className="flex flex-wrap gap-2">
                {suggestions.slice(0, 20).map((w) => (
                  <div
                    key={w.name}
                    className="inline-flex items-center overflow-hidden rounded-full border border-border/60 bg-background/40 text-xs"
                    title={`${w.games} game${w.games === 1 ? "" : "s"}`}
                  >
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => joinPlayer(null, w.name)}
                      aria-label={`Seat ${w.name}`}
                      className="px-2 py-1 hover:bg-gold/20 disabled:opacity-50"
                    >
                      +
                    </button>
                    <Link
                      to="/players/walkin/$name"
                      params={{ name: encodeURIComponent(w.name) }}
                      className="border-l border-border/60 px-2 py-1 hover:bg-gold/20"
                    >
                      {w.name}
                      <span className="ml-1 text-[10px] text-muted-foreground">×{w.games}</span>
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        <div className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          When the game ends, the host can finalize cash-outs from <span className="text-gold">Log results</span>. Re-buys entered here carry over.
        </div>
      </div>
    </div>
  );
}