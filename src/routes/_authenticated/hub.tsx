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

// Fixed positions/timings for the rising embers — no per-render randomness.
const EMBERS = [
  { left: "6%", size: 3, duration: 9, delay: 0, drift: 10 },
  { left: "16%", size: 4, duration: 12, delay: 2.2, drift: -14 },
  { left: "27%", size: 2, duration: 8, delay: 4.5, drift: 8 },
  { left: "38%", size: 3, duration: 11, delay: 1.1, drift: -6 },
  { left: "52%", size: 2, duration: 10, delay: 3.4, drift: 12 },
  { left: "64%", size: 4, duration: 13, delay: 0.6, drift: -10 },
  { left: "75%", size: 3, duration: 9.5, delay: 5.2, drift: 6 },
  { left: "86%", size: 2, duration: 12.5, delay: 2.8, drift: -8 },
  { left: "93%", size: 3, duration: 10.5, delay: 6, drift: 14 },
];

const SUITS = [
  { Icon: Spade, dx: -18, dy: -10, dr: -16 },
  { Icon: Heart, dx: -6, dy: 8, dr: 10 },
  { Icon: Diamond, dx: 6, dy: -8, dr: -10 },
  { Icon: Club, dx: 18, dy: 10, dr: 16 },
];

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
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Ambient backdrop: drifting felt glow + a faint vignette */}
      <div
        className="animate-hub-drift pointer-events-none absolute left-1/2 top-1/2 h-[70vh] w-[70vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,oklch(0.45_0.12_155_/_0.35),transparent_70%)] blur-2xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_35%,oklch(0.13_0.01_90_/_0.6)_100%)]"
        aria-hidden="true"
      />
      <Spade
        className="pointer-events-none absolute left-1/2 top-1/2 h-[46rem] w-[46rem] -translate-x-1/2 -translate-y-1/2 text-gold opacity-[0.035]"
        aria-hidden="true"
      />

      {/* Rising embers */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {EMBERS.map((e, i) => (
          <span
            key={i}
            className="animate-ember absolute bottom-0 rounded-full bg-gold shadow-[0_0_6px_2px_oklch(0.80_0.14_85_/_0.6)]"
            style={{
              left: e.left,
              width: e.size,
              height: e.size,
              animationDuration: `${e.duration}s`,
              animationDelay: `${e.delay}s`,
              ["--drift" as string]: `${e.drift}px`,
              transform: `translateX(var(--drift))`,
            }}
          />
        ))}
      </div>

      <div className="relative mx-auto flex max-w-5xl flex-col items-center px-6 py-16 md:py-24">
        <div className="mb-4 flex items-center gap-1.5 text-gold">
          {SUITS.map(({ Icon, dx, dy, dr }, i) => (
            <Icon
              key={i}
              className="animate-deal h-7 w-7 drop-shadow-[0_0_10px_oklch(0.80_0.14_85_/_0.5)] md:h-8 md:w-8"
              style={{
                ["--dx" as string]: `${dx}px`,
                ["--dy" as string]: `${dy}px`,
                ["--dr" as string]: `${dr}deg`,
                ["--deal-delay" as string]: `${i * 90}ms`,
              }}
            />
          ))}
        </div>

        <p className="animate-in fade-in duration-700 text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </p>

        <h1 className="animate-in fade-in slide-in-from-top-2 duration-700 mt-2 text-center font-display text-4xl font-bold tracking-tight md:text-6xl">
          Where to <span className="text-shimmer">tonight?</span>
        </h1>

        <p className="animate-in fade-in duration-700 mt-3 max-w-lg text-center text-sm text-muted-foreground md:text-base">
          {isAdmin
            ? "Head to the Poker Club to organise nights with the crew, or step into the Casino for live cash tables."
            : "Head to the Poker Club to organise nights with the crew."}
        </p>

        {nextNight && (
          <Link
            to="/nights/$id"
            params={{ id: nextNight.id }}
            className="animate-in fade-in duration-700 mt-6 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-medium text-gold shadow-[0_0_20px_-6px_oklch(0.80_0.14_85_/_0.5)] transition hover:bg-gold/15"
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Next night: {nextNight.title} · {formatEUDate(nextNight.starts_at)}
          </Link>
        )}

        <div
          className={
            "animate-in fade-in slide-in-from-bottom-3 duration-700 " +
            (isAdmin
              ? "mt-12 grid w-full gap-6 md:grid-cols-2"
              : "mt-12 grid w-full max-w-md gap-6")
          }
        >
          <HubCard
            to="/dashboard"
            Icon={Users}
            WatermarkIcon={Spade}
            eyebrow="Option 1"
            title="Poker Club"
            description="Schedule nights, RSVP, log results, and track the leaderboard with your regulars."
            cta="Enter the club"
          />

          {isAdmin && (
            <HubCard
              to="/play"
              Icon={Coins}
              WatermarkIcon={Diamond}
              eyebrow="Option 2"
              title="Casino"
              description="Live poker and blackjack tables with chips, cashier and settlements."
              cta="Enter the casino"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function HubCard({
  to,
  Icon,
  WatermarkIcon,
  eyebrow,
  title,
  description,
  cta,
}: {
  to: string;
  Icon: typeof Users;
  WatermarkIcon: typeof Spade;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
}) {
  return (
    <Link
      to={to}
      className="group relative rounded-[28px] bg-gradient-to-b from-gold/25 via-border/40 to-transparent p-px transition duration-300 hover:from-gold/60 hover:shadow-gold focus-visible:from-gold/60 focus-visible:shadow-gold focus-visible:outline-none"
    >
      <div className="card-felt relative overflow-hidden rounded-[27px] p-7 transition duration-300 group-hover:-translate-y-1.5 md:p-8">
        {/* Diagonal shine sweep */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-y-12 left-[-60%] w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-[260%]"
        />
        {/* Oversized suit watermark */}
        <WatermarkIcon
          className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 rotate-12 text-gold/[0.05] transition duration-300 group-hover:rotate-6 group-hover:text-gold/[0.09]"
          aria-hidden="true"
        />

        <div className="relative">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[radial-gradient(circle_at_30%_30%,oklch(0.88_0.13_90),oklch(0.72_0.16_75))] text-[oklch(0.12_0.02_90)] shadow-gold ring-1 ring-gold/40 transition duration-300 group-hover:scale-110 group-hover:rotate-3">
            <Icon className="h-7 w-7" />
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {eyebrow}
          </div>
          <h2 className="mt-1 font-display text-2xl font-bold md:text-[1.7rem]">{title}</h2>
          <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
          <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-gold/30 px-4 py-2 text-sm font-medium text-gold transition duration-300 group-hover:border-gold/60 group-hover:bg-gold/10">
            {cta} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
          </div>
        </div>
      </div>
    </Link>
  );
}
