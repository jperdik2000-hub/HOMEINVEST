import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Spade, Heart, Diamond, Club, ArrowRight, Users, Coins } from "lucide-react";


export const Route = createFileRoute("/_authenticated/hub")({
  head: () => ({
    meta: [
      { title: "Choose your table — Poker Club" },
      { name: "description", content: "Enter the Poker Club or step into the Casino." },
    ],
  }),
  component: HubPage,
});

function HubPage() {
  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin-hub"],
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
  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,hsl(var(--felt)/0.35),transparent_60%),radial-gradient(ellipse_at_bottom,hsl(var(--gold)/0.08),transparent_60%)]">
      <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-14 md:py-20">
        <div className="mb-2 flex items-center gap-1 text-gold">
          <Spade className="h-6 w-6" />
          <Heart className="h-6 w-6 -ml-1" />
          <Diamond className="h-6 w-6 ml-2" />
          <Club className="h-6 w-6 -ml-1" />
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight md:text-5xl">Where to tonight?</h1>
        <p className="mt-2 max-w-lg text-center text-sm text-muted-foreground md:text-base">
          {isAdmin
            ? "Head to the Poker Club to organise nights with the crew, or step into the Casino for live cash tables."
            : "Head to the Poker Club to organise nights with the crew."}
        </p>

        <div className={isAdmin ? "mt-10 grid w-full gap-5 md:grid-cols-2" : "mt-10 grid w-full max-w-md gap-5"}>

          <Link
            to="/dashboard"
            className="card-felt shadow-card group relative overflow-hidden rounded-2xl border border-border/60 p-6 transition hover:border-gold/50 hover:shadow-gold"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold/10 text-gold ring-1 ring-gold/40">
              <Users className="h-6 w-6" />
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Option 1</div>
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
            className="card-felt shadow-card group relative overflow-hidden rounded-2xl border border-border/60 p-6 transition hover:border-gold/50 hover:shadow-gold"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold/10 text-gold ring-1 ring-gold/40">
              <Coins className="h-6 w-6" />
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Option 2</div>
            <h2 className="mt-1 font-display text-2xl font-bold">Casino</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Live poker and blackjack tables with chips, cashier and settlements.
            </p>
            <div className="mt-6 flex items-center gap-2 text-sm font-medium text-gold">
              Enter the casino <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </div>
          </Link>
          )}

        </div>
      </div>
    </div>
  );
}