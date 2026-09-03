import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Clock, Coins, Timer } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDisplayName } from "@/lib/poker";
import { listInviteProfiles } from "@/lib/invite-profiles.functions";
import { notifyInvitesSent } from "@/lib/push.functions";
import {
  TournamentSetup,
  defaultTournamentSetup,
  type TournamentSetupValue,
} from "@/components/TournamentSetup";
import { splitTotal } from "@/lib/tournament";

export const Route = createFileRoute("/_authenticated/nights/new")({
  head: () => ({ meta: [{ title: "New Poker Club — Poker Club" }] }),
  component: NewNight,
});

function NewNight() {
  const navigate = useNavigate();
  const meCheck = useQuery({
    queryKey: ["is-admin-check"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user.id)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
  });
  const [title, setTitle] = useState("Poker Night");
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    d.setHours(20, 0, 0, 0);
    return d;
  });
  const [time, setTime] = useState("20:00");
  const [dateOpen, setDateOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [hour, minute] = time.split(":");
  const [location, setLocation] = useState("");
  const [buyIn, setBuyIn] = useState("50");
  const currency = "EUR";
  const [notes, setNotes] = useState("");
  const [format_, setFormat] = useState<"cash" | "tournament">("cash");
  const [tSetup, setTSetup] = useState<TournamentSetupValue>(() => defaultTournamentSetup(50));
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [extraEmails, setExtraEmails] = useState("");
  const [loading, setLoading] = useState(false);

  const loadInviteProfiles = useServerFn(listInviteProfiles);
  const sendInvitePushes = useServerFn(notifyInvitesSent);
  const profiles = useQuery({ queryKey: ["invite-profiles"], queryFn: () => loadInviteProfiles() });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const schema = z.object({
        title: z.string().trim().min(1).max(120),
        starts_at: z.string().min(1),
        location: z.string().max(200).optional(),
        buy_in: z.number().min(0).max(1_000_000),
        currency: z.string().length(3),
        notes: z.string().max(2000).optional(),
      });
      const dateStr = format(date, "yyyy-MM-dd");
      const startsAt = `${dateStr}T${time}`;
      // Build the human-readable "when" from what the user picked, NOT via a
      // Date/ISO round-trip. Otherwise the email render (which happens on the
      // server in UTC) can drift by the local UTC offset.
      const [yyyy, mm, dd] = dateStr.split("-");
      const whenText = `${dd}/${mm}/${yyyy} ${time}`;
      const locationName = location.trim();
      const v = schema.parse({
        title,
        starts_at: startsAt,
        location: locationName,
        buy_in: Number(buyIn) || 0,
        currency,
        notes,
      });
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not signed in");

      const isTourney = format_ === "tournament";
      if (isTourney) {
        if (splitTotal(tSetup.payoutSplit) !== 100)
          throw new Error("Prize split must add up to 100%");
        if (tSetup.blindLevels.length === 0) throw new Error("Add at least one blind level");
      }

      const { data: night, error } = await supabase
        .from("poker_nights")
        .insert({
          host_id: user.user.id,
          title: v.title,
          starts_at: new Date(v.starts_at).toISOString(),
          location: v.location || null,
          buy_in: v.buy_in,
          currency: v.currency.toUpperCase(),
          notes: v.notes || null,
          format: format_,
          ...(isTourney
            ? {
                starting_stack: tSetup.startingStack,
                level_minutes: tSetup.levelMinutes,
                rebuy_amount: tSetup.rebuyAmount,
                rebuy_chips: tSetup.rebuyChips,
                addon_amount: tSetup.addonAmount,
                addon_chips: tSetup.addonChips,
                blind_levels: tSetup.blindLevels,
                payout_split: tSetup.payoutSplit,
              }
            : {}),
        } as any)
        .select()
        .single();
      if (error) throw error;

      // Build invitations
      const invites: any[] = [];
      const all = profiles.data ?? [];
      for (const id of invitedIds) {
        const p = all.find((x) => x.id === id);
        if (p)
          invites.push({
            night_id: night.id,
            invited_user_id: p.id,
            invited_email: p.email,
            invited_name: p.name,
          });
      }
      const extras = extraEmails
        .split(/[,\n;\s]+/)
        .map((s) => s.trim())
        .filter((s) => /.+@.+\..+/.test(s));
      for (const e of extras) invites.push({ night_id: night.id, invited_email: e });
      if (invites.length) {
        const { data: createdInvites, error: ie } = await supabase
          .from("invitations")
          .insert(invites)
          .select("id, invited_email, invited_name, token");

        if (ie) {
          toast.warning("Night created, but some invites failed: " + ie.message);
        } else if (createdInvites?.length) {
          // Fire push notifications to all registered invitees (best-effort).
          const registeredIds = Array.from(invitedIds);
          if (registeredIds.length) {
            sendInvitePushes({
              data: { nightId: night.id, userIds: registeredIds, whenText },
            }).catch((e) => console.error("invite push failed", e));
          }
        }
      }
      toast.success("Poker game created!");
      navigate({ to: "/nights/$id", params: { id: night.id } });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to create");
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string) {
    const n = new Set(invitedIds);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setInvitedIds(n);
  }

  return (
    <AppShell>
      {meCheck.isSuccess && !meCheck.data && (
        <div className="mx-auto max-w-2xl">
          <div className="card-felt shadow-card rounded-2xl p-6 text-center">
            <h1 className="font-display text-2xl font-bold">Admins only</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Only the club admin can create new games. Ask the admin to schedule the next one.
            </p>
          </div>
        </div>
      )}
      {meCheck.data && (
        <div className="animate-in fade-in duration-500 mx-auto max-w-2xl">
          <h1 className="font-display text-3xl font-bold">Create Poker Club</h1>
          <p className="mb-6 text-sm text-muted-foreground">Set up the game and invite the crew.</p>

          <form onSubmit={submit} className="card-felt shadow-card space-y-4 rounded-2xl p-6">
            <div>
              <Label htmlFor="title">Event title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={120}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Date</Label>
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !date && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {date ? format(date, "PPP") : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={(d) => {
                        if (d) {
                          setDate(d);
                          setDateOpen(false);
                        }
                      }}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label htmlFor="time">Time (24h)</Label>
                <Popover open={timeOpen} onOpenChange={setTimeOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="time"
                      type="button"
                      variant="outline"
                      className="w-full justify-start text-left font-normal"
                    >
                      <Clock className="mr-2 h-4 w-4" />
                      {time}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-2" align="start">
                    <div className="flex gap-2 pointer-events-auto">
                      <div className="flex flex-col">
                        <div className="text-center text-xs text-muted-foreground mb-1">Hour</div>
                        <div className="h-48 w-16 overflow-y-auto rounded border border-border/60 snap-y">
                          {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map(
                            (h) => (
                              <button
                                key={h}
                                type="button"
                                onClick={() => setTime(`${h}:${minute}`)}
                                className={cn(
                                  "block w-full py-2 text-center text-sm snap-start hover:bg-background/50",
                                  h === hour && "bg-gold/20 font-semibold",
                                )}
                              >
                                {h}
                              </button>
                            ),
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <div className="text-center text-xs text-muted-foreground mb-1">Min</div>
                        <div className="h-48 w-16 overflow-y-auto rounded border border-border/60 snap-y">
                          {Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0")).map(
                            (m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setTime(`${hour}:${m}`)}
                                className={cn(
                                  "block w-full py-2 text-center text-sm snap-start hover:bg-background/50",
                                  m === minute && "bg-gold/20 font-semibold",
                                )}
                              >
                                {m}
                              </button>
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div>
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={200}
                placeholder="Where's the game?"
              />
            </div>
            <div>
              <Label htmlFor="buyin">Buy-in (EUR)</Label>
              <Input
                id="buyin"
                type="number"
                min={0}
                value={buyIn}
                onChange={(e) => setBuyIn(e.target.value)}
              />
            </div>
            <div>
              <Label>Format</Label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={format_ === "cash" ? "default" : "outline"}
                  className={
                    format_ === "cash"
                      ? "bg-gold shadow-gold transition-shadow"
                      : "transition-shadow"
                  }
                  onClick={() => setFormat("cash")}
                >
                  <Coins className="mr-1 h-4 w-4" />
                  Cash game
                </Button>
                <Button
                  type="button"
                  variant={format_ === "tournament" ? "default" : "outline"}
                  className={
                    format_ === "tournament"
                      ? "bg-gold shadow-gold transition-shadow"
                      : "transition-shadow"
                  }
                  onClick={() => {
                    setFormat("tournament");
                    setTSetup((s) => ({ ...s, rebuyAmount: s.rebuyAmount || Number(buyIn) || 0 }));
                  }}
                >
                  <Timer className="mr-1 h-4 w-4" />
                  Tournament
                </Button>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {format_ === "cash"
                  ? "Buy-ins, re-buys and cash-outs — results are net win/loss."
                  : "Blind clock, chip stacks, knockouts and a prize pool split by finishing place."}
              </div>
            </div>
            {format_ === "tournament" && <TournamentSetup value={tSetup} onChange={setTSetup} />}
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
                placeholder="Bring cash, small blinds start at $1/$2…"
              />
            </div>

            <div>
              <Label>Invite registered friends</Label>
              <div className="mt-1 grid gap-1 rounded-md border border-border/60 bg-background/30 p-2 max-h-48 overflow-auto">
                {(() => {
                  const list = (profiles.data ?? []).filter((p) => p.id !== me.data?.id);
                  if (list.length === 0) {
                    return (
                      <div className="p-2 text-sm text-muted-foreground">No other members yet.</div>
                    );
                  }
                  return list.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors duration-150 hover:bg-background/40"
                    >
                      <input
                        type="checkbox"
                        checked={invitedIds.has(p.id)}
                        onChange={() => toggle(p.id)}
                      />
                      <span className="text-sm">
                        {formatDisplayName(p.name, p.nickname)}{" "}
                        <span className="text-muted-foreground">· {p.email}</span>
                      </span>
                    </label>
                  ));
                })()}
              </div>
            </div>

            <div>
              <Label htmlFor="extra">Invite by email (comma or newline separated)</Label>
              <Textarea
                id="extra"
                value={extraEmails}
                onChange={(e) => setExtraEmails(e.target.value)}
                placeholder="alice@example.com, bob@example.com"
              />
            </div>

            <Button type="submit" className="w-full bg-gold shadow-gold" disabled={loading}>
              {loading ? "Creating…" : "Create poker game"}
            </Button>
          </form>
        </div>
      )}
    </AppShell>
  );
}
