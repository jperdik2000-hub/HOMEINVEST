import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Cursor-follow spotlight + a slow parallax nudge on the giant watermark suit. */
function useSpotlight(reduced: boolean) {
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--sx", `${((e.clientX - rect.left) / rect.width) * 100}%`);
    el.style.setProperty("--sy", `${((e.clientY - rect.top) / rect.height) * 100}%`);
  };
  return onMove;
}

/** 3D tilt + a light glare that tracks the pointer, reset smoothly on leave. */
function useTiltCard(reduced: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotateY = (px - 0.5) * 12;
    const rotateX = (0.5 - py) * 12;
    el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-6px)`;
    el.style.setProperty("--gx", `${px * 100}%`);
    el.style.setProperty("--gy", `${py * 100}%`);
    el.style.setProperty("--glare", "1");
  };
  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "";
    el.style.setProperty("--glare", "0");
  };
  return { ref, onMove, onLeave };
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
  { Icon: Spade, dx: -22, dy: -14, dr: -20 },
  { Icon: Heart, dx: -8, dy: 10, dr: 12 },
  { Icon: Diamond, dx: 8, dy: -10, dr: -12 },
  { Icon: Club, dx: 22, dy: 14, dr: 20 },
];

// Angles the chip-burst dots fly out to, in degrees around the icon badge.
const BURST_ANGLES = [-70, -25, 25, 70, 110, 160];

function HubPage() {
  const reducedMotion = usePrefersReducedMotion();
  const onSpotlightMove = useSpotlight(reducedMotion);

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
    <div
      className="relative min-h-screen overflow-hidden bg-background"
      onPointerMove={onSpotlightMove}
      style={{ ["--sx" as string]: "50%", ["--sy" as string]: "20%" }}
    >
      {/* Ambient backdrop: drifting felt glow + a faint vignette.
          No Tailwind translate-* utilities here — the hub-drift keyframe
          owns `transform` outright (Tailwind's translate-* sets a separate
          `translate` property that would otherwise stack on top of it). */}
      <div
        className="animate-hub-drift pointer-events-none absolute left-1/2 top-1/2 h-[70vh] w-[70vh] rounded-full bg-[radial-gradient(circle,oklch(0.45_0.12_155_/_0.35),transparent_70%)] blur-2xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_35%,oklch(0.13_0.01_90_/_0.6)_100%)]"
        aria-hidden="true"
      />
      {/* Cursor-follow spotlight */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        style={{
          background:
            "radial-gradient(480px circle at var(--sx) var(--sy), oklch(0.80 0.14 85 / 0.07), transparent 70%)",
        }}
        aria-hidden="true"
      />
      <Spade
        className="pointer-events-none absolute left-1/2 top-1/2 h-[46rem] w-[46rem] text-gold opacity-[0.035] transition-transform duration-500 ease-out"
        style={{
          transform:
            "translate(calc(-50% + (var(--sx) - 50%) * -0.06), calc(-50% + (var(--sy) - 50%) * -0.06))",
        }}
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
            }}
          />
        ))}
      </div>

      <div className="relative mx-auto flex max-w-5xl flex-col items-center px-6 py-16 md:py-24">
        <div className="mb-4 flex items-center gap-1.5 text-gold">
          {SUITS.map(({ Icon, dx, dy, dr }, i) => (
            <Icon
              key={i}
              className="animate-suit h-7 w-7 drop-shadow-[0_0_10px_oklch(0.80_0.14_85_/_0.5)] md:h-8 md:w-8"
              style={{
                ["--dx" as string]: `${dx}px`,
                ["--dy" as string]: `${dy}px`,
                ["--dr" as string]: `${dr}deg`,
                ["--deal-delay" as string]: `${i * 90}ms`,
                ["--float-delay" as string]: `${480 + i * 90}ms`,
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

        <p className="animate-in fade-in duration-700 delay-150 mt-3 max-w-lg text-center text-sm text-muted-foreground md:text-base">
          {isAdmin
            ? "Head to the Poker Club to organise nights with the crew, or step into the Casino for live cash tables."
            : "Head to the Poker Club to organise nights with the crew."}
        </p>

        {nextNight && (
          <Link
            to="/nights/$id"
            params={{ id: nextNight.id }}
            className="animate-in fade-in zoom-in-95 duration-500 delay-300 mt-6 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-medium text-gold shadow-[0_0_20px_-6px_oklch(0.80_0.14_85_/_0.5)] transition hover:bg-gold/15"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-gold" />
            </span>
            <CalendarClock className="h-3.5 w-3.5" />
            Next night: {nextNight.title} · {formatEUDate(nextNight.starts_at)}
          </Link>
        )}

        <div
          className={
            isAdmin ? "mt-12 grid w-full gap-6 md:grid-cols-2" : "mt-12 grid w-full max-w-md gap-6"
          }
          style={{ perspective: 1200 }}
        >
          <HubCard
            to="/dashboard"
            Icon={Users}
            WatermarkIcon={Spade}
            eyebrow="Option 1"
            title="Poker Club"
            description="Schedule nights, RSVP, log results, and track the leaderboard with your regulars."
            cta="Enter the club"
            entrance="slide-in-from-left-10"
            delay="delay-500"
            reducedMotion={reducedMotion}
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
              entrance="slide-in-from-right-10"
              delay="delay-700"
              reducedMotion={reducedMotion}
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
  entrance,
  delay,
  reducedMotion,
}: {
  to: string;
  Icon: typeof Users;
  WatermarkIcon: typeof Spade;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
  entrance: string;
  delay: string;
  reducedMotion: boolean;
}) {
  const { ref, onMove, onLeave } = useTiltCard(reducedMotion);

  return (
    <Link
      to={to}
      className={`animate-in fade-in ${entrance} ${delay} group relative block rounded-[28px] bg-gradient-to-b from-gold/25 via-border/40 to-transparent p-px duration-700 transition hover:from-gold/60 hover:shadow-gold focus-visible:from-gold/60 focus-visible:shadow-gold focus-visible:outline-none active:scale-[0.985]`}
    >
      <div
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        className="card-felt relative overflow-hidden rounded-[27px] p-7 transition-transform duration-200 ease-out will-change-transform md:p-8"
        style={{ ["--glare" as string]: 0 }}
      >
        {/* Pointer-tracked glare */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[var(--glare,0)] transition-opacity duration-300"
          style={{
            background:
              "radial-gradient(220px circle at var(--gx,50%) var(--gy,50%), oklch(0.97 0.03 90 / 0.16), transparent 60%)",
          }}
          aria-hidden="true"
        />
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
          <div className="relative mb-5 flex h-14 w-14 items-center justify-center">
            <div className="animate-badge-glow absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_30%_30%,oklch(0.88_0.13_90),oklch(0.72_0.16_75))] ring-1 ring-gold/40 transition duration-300 group-hover:scale-110 group-hover:rotate-3" />
            <Icon className="relative h-7 w-7 text-[oklch(0.12_0.02_90)]" />
            {BURST_ANGLES.map((angle, i) => {
              const rad = (angle * Math.PI) / 180;
              const bx = Math.cos(rad) * 48;
              const by = Math.sin(rad) * 48;
              return (
                <span
                  key={i}
                  className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-[oklch(0.97_0.03_90)] opacity-0 shadow-[0_0_6px_1px_oklch(0.80_0.14_85_/_0.8)] group-hover:animate-chip-burst"
                  style={{
                    ["--bx" as string]: `${bx}px`,
                    ["--by" as string]: `${by}px`,
                    animationDelay: `${i * 35}ms`,
                  }}
                />
              );
            })}
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
