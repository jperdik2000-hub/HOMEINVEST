import { useEffect, useMemo, useState } from "react";
import { evaluateVariant, winProbabilityVariant, type EvalVariant } from "@/lib/poker-eval";
import { Sparkles } from "lucide-react";

export function HandOdds({
  hole,
  board,
  opponents,
  variant,
}: {
  hole: string[];
  board: string[];
  opponents: number;
  variant: EvalVariant;
}) {
  const evalResult = useMemo(() => {
    if (hole.length < 2) return null;
    return evaluateVariant(variant, hole, board);
  }, [hole, board, variant]);

  const [prob, setProb] = useState<{ win: number; tie: number } | null>(null);

  useEffect(() => {
    if (hole.length < 2 || opponents < 1) { setProb(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      // Fewer iterations for heavier variants (Omaha/5-card) to keep UI snappy.
      const heavy = variant === "omaha" || variant === "five_one" || variant === "five_two";
      const iters = heavy ? 800 : board.length === 0 ? 1200 : 2000;
      const r = winProbabilityVariant(variant, hole, board, opponents, iters);
      if (!cancelled) setProb(r);
    }, 30);
    return () => { cancelled = true; clearTimeout(t); };
  }, [hole.join(","), board.join(","), opponents, variant]);

  if (!evalResult) return null;

  const winPct = prob ? Math.round(prob.win * 100) : null;
  const tiePct = prob ? Math.round(prob.tie * 100) : null;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs sm:text-sm">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-gold" />
        <span className="text-muted-foreground">Your hand:</span>
        <span className="font-semibold">{evalResult.label}</span>
      </div>
      {opponents >= 1 && (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">Win:</span>
          <span className="font-mono font-semibold text-gold">
            {winPct === null ? "…" : `${winPct}%`}
            {tiePct !== null && tiePct > 0 ? ` (tie ${tiePct}%)` : ""}
          </span>
          <span className="text-[10px] text-muted-foreground">vs {opponents}</span>
        </div>
      )}
    </div>
  );
}