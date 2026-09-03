import { cn } from "@/lib/utils";

// Card codes: "As" "Kh" "2c" "Td". Suits: s(spade) h(heart) d(diamond) c(club).
// Casino-style layout: rank stacked over small suit in the top-left corner,
// large suit pip centered. Matches PokerStars/GGPoker/WSOP.

const SUIT_MAP: Record<string, { symbol: string; color: string }> = {
  s: { symbol: "♠", color: "text-neutral-900" },
  c: { symbol: "♣", color: "text-neutral-900" },
  h: { symbol: "♥", color: "text-[#d40000]" },
  d: { symbol: "♦", color: "text-[#d40000]" },
};

const RANK_LABEL: Record<string, string> = {
  A: "A", K: "K", Q: "Q", J: "J", T: "10",
  "9": "9", "8": "8", "7": "7", "6": "6", "5": "5", "4": "4", "3": "3", "2": "2",
};

export function PlayingCard({
  code,
  size = "md",
  faceDown = false,
  dim = false,
  className,
}: {
  code?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  faceDown?: boolean;
  dim?: boolean;
  className?: string;
}) {
  const dims = {
    xs: "w-8 h-12 rounded-[3px] p-[3px]",
    sm: "w-11 h-16 rounded-[4px] p-[4px]",
    md: "w-14 h-20 rounded-[5px] p-[5px]",
    lg: "w-20 h-28 rounded-[7px] p-[8px]",
  }[size];
  const cornerRankSize = {
    xs: "text-[13px] leading-none",
    sm: "text-[16px] leading-none",
    md: "text-[20px] leading-none",
    lg: "text-[26px] leading-none",
  }[size];
  const cornerSuitSize = {
    xs: "text-[11px] leading-none",
    sm: "text-[13px] leading-none",
    md: "text-[17px] leading-none",
    lg: "text-[22px] leading-none",
  }[size];
  const centerSuitSize = {
    xs: "text-[19px]",
    sm: "text-[24px]",
    md: "text-[34px]",
    lg: "text-[46px]",
  }[size];

  if (faceDown || !code) {
    return (
      <div
        className={cn(
          "border border-white/20 bg-gradient-to-br from-[#7b1e1e] via-[#3a0d0d] to-[#1a0505] shadow-md",
          "relative flex items-center justify-center overflow-hidden",
          dims,
          dim && "opacity-60",
          className,
        )}
      >
        <div className="absolute inset-0 opacity-70"
          style={{
            background: "repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 3px, transparent 3px 6px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.08) 0 3px, transparent 3px 6px)",
          }}
        />
        <span
          className="relative font-bold text-white/90"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: size === "lg" ? 31 : size === "md" ? 24 : size === "sm" ? 18 : 14,
            letterSpacing: "0.02em",
            textShadow: "0 1px 2px rgba(0,0,0,0.5)",
          }}
        >
          JP
        </span>
      </div>
    );
  }

  const rank = code[0];
  const suit = code[1];
  const meta = SUIT_MAP[suit];
  if (!meta) return null;
  const label = RANK_LABEL[rank] ?? rank;

  return (
    <div
      className={cn(
        "relative border border-neutral-300 bg-gradient-to-b from-white to-neutral-50 shadow-[0_2px_6px_-1px_rgba(0,0,0,0.35),0_1px_2px_rgba(0,0,0,0.2)] overflow-hidden select-none",
        meta.color,
        dims,
        dim && "opacity-40",
        className,
      )}
      style={{ fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif', WebkitFontSmoothing: "antialiased" }}
    >
      <div className="absolute left-0 top-0 flex flex-col items-center p-[inherit]">
        <span
          className={cn("font-bold tabular-nums", cornerRankSize)}
          style={{ letterSpacing: "-0.05em" }}
        >
          {label}
        </span>
      </div>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center leading-none",
          centerSuitSize,
        )}
      >
        {meta.symbol}
      </span>
    </div>
  );
}

export function CardBack(props: Omit<Parameters<typeof PlayingCard>[0], "faceDown">) {
  return <PlayingCard {...props} faceDown />;
}

// Casino-style fanned hand: first card fully visible; each subsequent card
// overlaps ~35% of the previous, offset slightly up and rotated slightly,
// so all ranks/suits (top-left corner) stay readable. The most recently
// dealt card slides in from the dealer's shoe (top of table).
export function FannedHand({
  cards,
  size = "xs",
  faceDownIndex,
  animateNewest = true,
  className,
}: {
  cards: string[];
  size?: "xs" | "sm" | "md" | "lg";
  faceDownIndex?: number;
  animateNewest?: boolean;
  className?: string;
}) {
  const dims = {
    xs: { w: 32, h: 48, dy: 10, rot: 4 },
    sm: { w: 44, h: 64, dy: 14, rot: 4 },
    md: { w: 56, h: 80, dy: 18, rot: 5 },
    lg: { w: 80, h: 112, dy: 24, rot: 6 },
  }[size];
  // Keep the center suit pip visible: step must exceed 50% of the card width.
  // Overlap ≈ 45% → step ≈ 55% of card width.
  const stepX = Math.round(dims.w * 0.55);
  const n = cards.length;
  if (n === 0) return null;
  // Add rotation buffer to width so the last card's tilt doesn't clip.
  const width = dims.w + stepX * (n - 1) + 10;
  const height = dims.h + dims.dy * (n - 1) + 6;

  return (
    <div className={cn("relative", className)} style={{ width, height }}>
      {cards.map((c, i) => {
        const x = i * stepX;
        // Fan upward as we go right: highest card is the latest.
        const y = dims.dy * (n - 1 - i);
        const rot = (i - (n - 1) / 2) * dims.rot;
        const isNewest = i === n - 1;
        return (
          <div
            key={`${i}-${c}`}
            className="absolute"
            style={{ left: x, top: y, zIndex: i + 1 }}
          >
            <div
              className={cn(
                isNewest && animateNewest && n > 1 && "animate-bj-deal",
              )}
              style={{ transformOrigin: "bottom center" }}
            >
              <div style={{ transform: `rotate(${rot}deg)`, transformOrigin: "bottom left" }}>
                <PlayingCard code={c} size={size} faceDown={faceDownIndex === i} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}