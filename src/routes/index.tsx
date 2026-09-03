import { createFileRoute } from "@tanstack/react-router";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Trophy, Calendar, TrendingUp, Sparkles, Users, Spade, Heart, Diamond, Club } from "lucide-react";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/hub", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) navigate({ to: "/hub", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);
  return (
    <div className="min-h-screen overflow-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gold text-black shadow-gold">
            <Spade className="h-4 w-4" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">Poker Club</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/auth"><Button variant="ghost">Log In</Button></Link>
          <Link to="/auth" search={{ mode: "signup" as const }}>
            <Button className="bg-gold shadow-gold">Create Account</Button>
          </Link>
        </div>
      </header>

      <section className="relative mx-auto max-w-6xl px-6 pt-12 pb-20 text-center md:pt-24 md:pb-32">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[40rem] opacity-60">
          <div className="absolute left-1/2 top-0 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-gold/10 blur-[100px]" />
          <div className="absolute right-0 top-1/2 h-[24rem] w-[24rem] -translate-y-1/2 rounded-full bg-felt/20 blur-[80px]" />
        </div>

        <div className="relative mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-medium text-gold">
          <Sparkles className="h-3 w-3" /> Private club for serious players
        </div>
        <h1 className="relative font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
          High-stakes <span className="text-gold">Hold'em</span>
        </h1>
        <p className="relative mx-auto mt-5 max-w-xl text-base text-muted-foreground md:text-lg">
          Track every game, invite the crew, and settle up like a pro. Your private casino table is one click away.
        </p>
        <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/auth" search={{ mode: "signup" as const }}>
            <Button size="lg" className="bg-gold shadow-gold">Create Account</Button>
          </Link>
          <Link to="/auth">
            <Button size="lg" variant="outline">Log In</Button>
          </Link>
        </div>

        <div className="relative mx-auto mt-12 flex items-center justify-center gap-4 text-gold/60 md:mt-16">
          <Spade className="h-6 w-6" />
          <Heart className="h-6 w-6 text-red" />
          <Diamond className="h-6 w-6" />
          <Club className="h-6 w-6" />
        </div>
      </section>

      <section className="relative mx-auto grid max-w-6xl gap-4 px-6 pb-24 md:grid-cols-3">
        <PreviewCard icon={<Trophy className="h-5 w-5 text-gold" />} title="Leaderboard" caption="All-time standings">
          <ol className="space-y-2 text-sm">
            {[["Perdis","+$1,240"],["Zeppos","+$860"],["Tsilis","+$420"]].map(([n,v],i) => (
              <li key={n} className="flex items-center justify-between rounded-md bg-background/40 px-3 py-2">
                <span className="flex items-center gap-2"><span className="text-gold">#{i+1}</span>{n}</span>
                <span className="font-mono text-emerald-400">{v}</span>
              </li>
            ))}
          </ol>
        </PreviewCard>
        <PreviewCard icon={<Calendar className="h-5 w-5 text-gold" />} title="Upcoming Nights" caption="Next games on the calendar">
          <div className="space-y-2 text-sm">
            <div className="rounded-md bg-background/40 px-3 py-2">
              <div className="font-medium">Friday Cash Game</div>
              <div className="text-xs text-muted-foreground">Sat · 8:00 PM · Spia Neti</div>
            </div>
            <div className="rounded-md bg-background/40 px-3 py-2">
              <div className="font-medium">Monthly Tournament</div>
              <div className="text-xs text-muted-foreground">Fri 21st · 7:30 PM · $50 buy-in</div>
            </div>
          </div>
        </PreviewCard>
        <PreviewCard icon={<TrendingUp className="h-5 w-5 text-gold" />} title="Your Stats" caption="Fun analytics">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Stat label="Games" value="18" />
            <Stat label="Win rate" value="44%" />
            <Stat label="Best night" value="+$310" />
            <Stat label="Avg / night" value="+$27" />
          </div>
        </PreviewCard>
      </section>

      <footer className="border-t border-border/50 py-8 text-center text-xs text-muted-foreground">
        <Users className="mx-auto mb-2 h-4 w-4 text-gold" />
        Built for friends. Not a gambling platform.
      </footer>
    </div>
  );
}

function PreviewCard({ icon, title, caption, children }: { icon: React.ReactNode; title: string; caption: string; children: React.ReactNode }) {
  return (
    <div className="card-felt shadow-card rounded-2xl p-5">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <div>
          <div className="font-display text-lg font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{caption}</div>
        </div>
      </div>
      {children}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-base text-foreground">{value}</div>
    </div>
  );
}
