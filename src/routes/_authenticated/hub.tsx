import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchNights, formatEUDate } from "@/lib/poker";
import { Spade, Heart, Diamond, Club, ArrowRight, Users, Coins, CalendarClock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/hub")({
  head: () => ({
    meta: [
      { title: "Choose your table — Poker Club" },
      { name: "description", content: "Enter the Poker Club or step into the Casino." },
    ],
  }),
  component: HubPage,
});

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up?";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function HubPage() {
  const { data: me } = useQuery({
    queryKey: ["me-hub"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin-hub", me?.id],
    enabled: !!me?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", me!.id)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
  });

  const { data: nights } = useQuery({ queryKey: ["nights-hub"], queryFn: fetchNights });

  const nextNight = (nights ?? [])
    .filter((n) => n.status !== "cancelled" && n.status !== "completed")
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0];

  const firstName =
    (me?.user_metadata?.nickname as string) ||
    (me?.user_metadata?.name as string) ||
    me?.email?.split("@")[0] ||
    "";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(ellipse_at_top,hsl(var(--felt)/0.35),transparent_60%),radial-gradient(ellipse_at_bottom,hsl(var(--gold)/0.08),transparent_60%)]">
      <Spade
        className="pointer-events-none absolute left-1/2 top-1/2 h-[42rem] w-[42rem] -translate-x-1/2 -translate-y-1/2 text-gold opacity-[0.04]"
        aria-hidden="true"
      />

      <div className="relative mx-auto flex max-w-5xl flex-col items-center px-6 py-14 md:py-20">
        <div className="animate-in fade-in slide-in-from-top-2 duration-500 mb-3 flex items-center gap-1 text-gold">
          <Spade className="h-6 w-6" />
          <Heart className="h-6 w-6 -ml-1" />
          <Diamond className="h-6 w-6 ml-2" />
          <Club className="h-6 w-6 -ml-1" />
        </div>

        <p className="animate-in fade-in duration-500 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </p>

        <h1 className="animate-in fade-in slide-in-from-top-1 duration-500 mt-1 text-center font-display text-3xl font-bold tracking-tight md:text-5xl">
          Where to tonight?
        </h1>

        <p className="mt-2 max-w-lg text-center text-sm text-muted-foreground md:text-base">
          {isAdmin
            ? "Head to the Poker Club to organise nights with the crew, or step into the Casino for live cash tables."
            : "Head to the Poker Club to organise nights with the crew."}
        </p>

        {nextNight && (
          <Link
            to="/nights/$id"
            params={{ id: nextNight.id }}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-medium text-gold transition hover:bg-gold/15"
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Next night: {nextNight.title} · {formatEUDate(nextNight.starts_at)}
          </Link>
        )}

        <div
          className={
            "animate-in fade-in slide-in-from-bottom-2 duration-500 " +
            (isAdmin
              ? "mt-10 grid w-full gap-5 md:grid-cols-2"
              : "mt-10 grid w-full max-w-md gap-5")
          }
        >
          <Link
            to="/dashboard"
            className="card-felt shadow-card group relative overflow-hidden rounded-2xl border border-border/60 p-6 transition duration-300 hover:-translate-y-1 hover:border-gold/50 hover:shadow-gold focus-visible:-translate-y-1 focus-visible:border-gold/50 focus-visible:shadow-gold focus-visible:outline-none"
          >
            <Spade className="pointer-events-none absolute -right-5 -top-5 h-28 w-28 text-gold/[0.04] transition duration-300 group-hover:text-gold/[0.08]" />
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold/10 text-gold ring-1 ring-gold/40 transition duration-300 group-hover:scale-110">
              <Users className="h-6 w-6" />
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Option 1
            </div>
            <h2 className="mt-1 font-display text-2xl font-bold">Poker Club</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Schedule nights, RSVP, log results, and track the leaderboard with your regulars.
            </p>
            <div className="mt-6 flex items-center gap-2 text-sm font-medium text-gold">
              Enter the club <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </div>
          </Link>

          {isAdmin && (
            <Link
              to="/play"
              className="card-felt shadow-card group relative overflow-hidden rounded-2xl border border-border/60 p-6 transition duration-300 hover:-translate-y-1 hover:border-gold/50 hover:shadow-gold focus-visible:-translate-y-1 focus-visible:border-gold/50 focus-visible:shadow-gold focus-visible:outline-none"
            >
              <Diamond className="pointer-events-none absolute -right-5 -top-5 h-28 w-28 text-gold/[0.04] transition duration-300 group-hover:text-gold/[0.08]" />
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold/10 text-gold ring-1 ring-gold/40 transition duration-300 group-hover:scale-110">
                <Coins className="h-6 w-6" />
              </div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Option 2
              </div>
              <h2 className="mt-1 font-display text-2xl font-bold">Casino</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Live poker and blackjack tables with chips, cashier and settlements.
              </p>
              <div className="mt-6 flex items-center gap-2 text-sm font-medium text-gold">
                Enter the casino{" "}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </div>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
