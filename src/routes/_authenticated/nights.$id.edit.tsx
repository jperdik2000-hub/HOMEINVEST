import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  TournamentSetup,
  defaultTournamentSetup,
  type TournamentSetupValue,
} from "@/components/TournamentSetup";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import { z } from "zod";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { CalendarIcon, Clock } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  notifyLocationChanged,
  notifyBuyInChanged,
  notifyDateChanged,
  sendTestPushToMe,
} from "@/lib/push.functions";

export const Route = createFileRoute("/_authenticated/nights/$id/edit")({
  head: () => ({ meta: [{ title: "Edit Poker Club" }] }),
  component: EditNight,
});

function EditNight() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const night = useQuery({
    queryKey: ["night", id],
    queryFn: async () =>
      (await supabase.from("poker_nights").select("*").eq("id", id).single()).data,
  });

  const [title, setTitle] = useState("");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [dateOpen, setDateOpen] = useState(false);
  const [time, setTime] = useState("20:00");
  const [timeOpen, setTimeOpen] = useState(false);
  const [location, setLocation] = useState("");
  const [buyIn, setBuyIn] = useState("0");
  const [buyInChips, setBuyInChips] = useState("0");
  const currency = "EUR";
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("scheduled");
  const [loading, setLoading] = useState(false);
  const [originalLocation, setOriginalLocation] = useState<string>("");
  const [notifyOnChange, setNotifyOnChange] = useState(true);
  const [originalBuyIn, setOriginalBuyIn] = useState<number>(0);
  const [notifyBuyIn, setNotifyBuyIn] = useState(true);
  const [originalStartsAt, setOriginalStartsAt] = useState<string>("");
  const [notifyDate, setNotifyDate] = useState(true);
  const [testingPush, setTestingPush] = useState(false);
  const [format_, setFormat] = useState<"cash" | "tournament">("cash");
  const [tSetup, setTSetup] = useState<TournamentSetupValue>(() => defaultTournamentSetup(0));
  const notifyLocation = useServerFn(notifyLocationChanged);
  const notifyBuyInFn = useServerFn(notifyBuyInChanged);
  const notifyDateFn = useServerFn(notifyDateChanged);
  const sendTest = useServerFn(sendTestPushToMe);

  const [hour, minute] = time.split(":");

  useEffect(() => {
    const n = night.data;
    if (!n) return;
    setTitle(n.title);
    const d = new Date(n.starts_at);
    setDate(d);
    setOriginalStartsAt(n.starts_at);
    const pad = (x: number) => x.toString().padStart(2, "0");
    setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setLocation(n.location ?? "");
    setOriginalLocation(n.location ?? "");
    setBuyIn(String(n.buy_in));
    setOriginalBuyIn(Number(n.buy_in) || 0);
    setBuyInChips(String((n as any).buy_in_chips ?? 0));
    setFormat(((n as any).format ?? "cash") === "tournament" ? "tournament" : "cash");
    setTSetup({
      startingStack: Number((n as any).starting_stack ?? 10000),
      levelMinutes: Number((n as any).level_minutes ?? 20),
      rebuyAmount: Number((n as any).rebuy_amount ?? 0),
      rebuyChips: Number((n as any).rebuy_chips ?? 0),
      addonAmount: Number((n as any).addon_amount ?? 0),
      addonChips: Number((n as any).addon_chips ?? 0),
      blindLevels: (((n as any).blind_levels ?? []) as any[]).length
        ? ((n as any).blind_levels as any[])
        : defaultTournamentSetup(Number(n.buy_in) || 0).blindLevels,
      payoutSplit: (((n as any).payout_split ?? []) as any[]).length
        ? ((n as any).payout_split as any[])
        : defaultTournamentSetup(Number(n.buy_in) || 0).payoutSplit,
    });
    setNotes(n.notes ?? "");
    setStatus(n.status);
  }, [night.data]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const schema = z.object({
        title: z.string().trim().min(1).max(120),
        date: z.date(),
        time: z.string().min(1),
        location: z.string().max(200).optional(),
        buy_in: z.number().min(0).max(1_000_000),
        buy_in_chips: z.number().int().min(0).max(100_000_000),
        currency: z.string().length(3),
        notes: z.string().max(2000).optional(),
        status: z.enum(["scheduled", "completed"]),
      });
      const v = schema.parse({
        title,
        date,
        time,
        location,
        buy_in: Number(buyIn) || 0,
        buy_in_chips: Number(buyInChips) || 0,
        currency,
        notes,
        status,
      });
      const dateStr = format(v.date, "yyyy-MM-dd");
      const startsAt = `${dateStr}T${v.time}`;
      const newStartsAtIso = new Date(startsAt).toISOString();
      const { error } = await supabase
        .from("poker_nights")
        .update({
          title: v.title,
          starts_at: newStartsAtIso,
          location: v.location || null,
          buy_in: v.buy_in,
          buy_in_chips: v.buy_in_chips,
          format: format_,
          ...(format_ === "tournament"
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
          currency: v.currency.toUpperCase(),
          notes: v.notes || null,
          status: v.status,
        } as any)
        .eq("id", id);
      if (error) throw error;
      toast.success("Poker game updated");
      const newLoc = (v.location ?? "").trim();
      const oldLoc = originalLocation.trim();
      if (notifyOnChange && newLoc !== oldLoc) {
        try {
          const res: any = await notifyLocation({
            data: { nightId: id, oldLocation: oldLoc || null, newLocation: newLoc || null },
          });
          if (res?.targets > 0)
            toast.success(
              `Notified ${res.targets} player${res.targets === 1 ? "" : "s"} of the new location`,
            );
        } catch (err: any) {
          toast.error(err?.message ?? "Could not send location update");
        }
      }
      if (notifyBuyIn && v.buy_in !== originalBuyIn) {
        try {
          const res: any = await notifyBuyInFn({
            data: {
              nightId: id,
              oldBuyIn: originalBuyIn,
              newBuyIn: v.buy_in,
              currency: v.currency.toUpperCase(),
            },
          });
          if (res?.targets > 0)
            toast.success(
              `Notified ${res.targets} player${res.targets === 1 ? "" : "s"} of the new buy-in`,
            );
        } catch (err: any) {
          toast.error(err?.message ?? "Could not send buy-in update");
        }
      }
      if (
        notifyDate &&
        originalStartsAt &&
        newStartsAtIso !== new Date(originalStartsAt).toISOString()
      ) {
        try {
          const res: any = await notifyDateFn({
            data: {
              nightId: id,
              oldStartsAt: new Date(originalStartsAt).toISOString(),
              newStartsAt: newStartsAtIso,
            },
          });
          if (res?.targets > 0)
            toast.success(
              `Notified ${res.targets} player${res.targets === 1 ? "" : "s"} of the new date`,
            );
        } catch (err: any) {
          toast.error(err?.message ?? "Could not send date update");
        }
      }
      navigate({ to: "/nights/$id", params: { id } });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  async function handleTestPush() {
    setTestingPush(true);
    try {
      const res: any = await sendTest({});
      if (res?.noSubs) {
        toast.error(
          "No push subscription on this device. Enable notifications in your profile first.",
        );
      } else if ((res?.sent ?? 0) > 0) {
        toast.success(`Test push sent to ${res.sent} device${res.sent === 1 ? "" : "s"}`);
      } else {
        toast.warning("Test attempted but nothing was delivered.");
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to send test push");
    } finally {
      setTestingPush(false);
    }
  }

  if (night.isLoading)
    return (
      <AppShell>
        <div className="text-muted-foreground">Loading…</div>
      </AppShell>
    );
  if (!night.data)
    return (
      <AppShell>
        <div>Not found.</div>
      </AppShell>
    );

  return (
    <AppShell>
      <div className="animate-in fade-in duration-500 mx-auto max-w-2xl">
        <h1 className="font-display text-3xl font-bold">Edit Poker Club</h1>
        <p className="mb-6 text-sm text-muted-foreground">Update the details for this game.</p>
        <form onSubmit={save} className="card-felt shadow-card space-y-4 rounded-2xl p-6">
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
                    type="button"
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
          {(() => {
            if (!date || !originalStartsAt) return null;
            const dateStr = format(date, "yyyy-MM-dd");
            const newIso = new Date(`${dateStr}T${time}`).toISOString();
            const oldIso = new Date(originalStartsAt).toISOString();
            if (newIso === oldIso) return null;
            return (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={notifyDate}
                  onChange={(e) => setNotifyDate(e.target.checked)}
                  className="h-4 w-4 accent-gold"
                />
                Notify invited players (and me) that the date/time changed
              </label>
            );
          })()}
          <div>
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={200}
              placeholder="Where's the game?"
            />
            {location.trim() !== originalLocation.trim() && (
              <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={notifyOnChange}
                  onChange={(e) => setNotifyOnChange(e.target.checked)}
                  className="h-4 w-4 accent-gold"
                />
                Notify invited players that the location changed
              </label>
            )}
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
            {(Number(buyIn) || 0) !== originalBuyIn && (
              <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={notifyBuyIn}
                  onChange={(e) => setNotifyBuyIn(e.target.checked)}
                  className="h-4 w-4 accent-gold"
                />
                Notify invited players that the buy-in changed
              </label>
            )}
          </div>
          <div>
            <Label htmlFor="buyinchips">Chips per buy-in (virtual)</Label>
            <Input
              id="buyinchips"
              type="number"
              min={0}
              step={1}
              value={buyInChips}
              onChange={(e) => setBuyInChips(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Virtual chip amount each buy-in represents.
            </p>
          </div>
          <div>
            <Label>Format</Label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={format_ === "cash" ? "default" : "outline"}
                className={format_ === "cash" ? "bg-gold" : ""}
                onClick={() => setFormat("cash")}
              >
                Cash game
              </Button>
              <Button
                type="button"
                variant={format_ === "tournament" ? "default" : "outline"}
                className={format_ === "tournament" ? "bg-gold" : ""}
                onClick={() => setFormat("tournament")}
              >
                Tournament
              </Button>
            </div>
          </div>
          {format_ === "tournament" && <TournamentSetup value={tSetup} onChange={setTSetup} />}
          <div>
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={4}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1 bg-gold shadow-gold" disabled={loading}>
              {loading ? "Saving…" : "Save changes"}
            </Button>
            <Link to="/nights/$id" params={{ id }}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
          </div>
          <div className="border-t border-border/60 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleTestPush}
              disabled={testingPush}
              className="w-full"
            >
              {testingPush ? "Sending…" : "Send me a test push notification"}
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              Verifies push works on this device before you notify players.
            </p>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
