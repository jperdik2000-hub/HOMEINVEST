import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Coffee } from "lucide-react";
import {
  PAYOUT_TEMPLATES,
  STRUCTURE_PRESETS,
  splitTotal,
  type BlindLevel,
  type PayoutSlice,
} from "@/lib/tournament";

export type TournamentSetupValue = {
  startingStack: number;
  levelMinutes: number;
  rebuyAmount: number;
  rebuyChips: number;
  addonAmount: number;
  addonChips: number;
  blindLevels: BlindLevel[];
  payoutSplit: PayoutSlice[];
};

export function defaultTournamentSetup(buyIn: number): TournamentSetupValue {
  const preset = STRUCTURE_PRESETS[0]!;
  return {
    startingStack: preset.startingStack,
    levelMinutes: preset.minutes,
    rebuyAmount: buyIn,
    rebuyChips: preset.startingStack,
    addonAmount: 0,
    addonChips: 0,
    blindLevels: preset.levels,
    payoutSplit: PAYOUT_TEMPLATES[3]!.split,
  };
}

/** Shared editor for tournament structure, re-buys and prize split. */
export function TournamentSetup({
  value,
  onChange,
}: {
  value: TournamentSetupValue;
  onChange: (next: TournamentSetupValue) => void;
}) {
  const set = (patch: Partial<TournamentSetupValue>) => onChange({ ...value, ...patch });

  const renumber = (rows: BlindLevel[]) => rows.map((l, i) => ({ ...l, level: i + 1 }));

  const updateLevel = (idx: number, patch: Partial<BlindLevel>) => {
    const rows = value.blindLevels.map((l, i) => (i === idx ? { ...l, ...patch } : l));
    set({ blindLevels: renumber(rows) });
  };

  const addLevel = (isBreak = false) => {
    const last = value.blindLevels.filter((l) => !l.isBreak).at(-1);
    const next: BlindLevel = isBreak
      ? { level: 0, small: 0, big: 0, ante: 0, isBreak: true, minutes: 10 }
      : {
          level: 0,
          small: last ? last.small * 2 : 25,
          big: last ? last.big * 2 : 50,
          ante: last ? last.ante * 2 : 0,
        };
    set({ blindLevels: renumber([...value.blindLevels, next]) });
  };

  const total = splitTotal(value.payoutSplit);

  return (
    <div className="space-y-4 rounded-xl border border-gold/25 bg-background/40 p-4">
      <div>
        <Label>Blind structure preset</Label>
        <Select
          onValueChange={(id) => {
            const p = STRUCTURE_PRESETS.find((s) => s.id === id);
            if (!p) return;
            set({ blindLevels: p.levels, levelMinutes: p.minutes, startingStack: p.startingStack, rebuyChips: p.startingStack });
          }}
        >
          <SelectTrigger className="mt-1 bg-background/60">
            <SelectValue placeholder="Load a preset…" />
          </SelectTrigger>
          <SelectContent>
            {STRUCTURE_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="tstack">Starting stack (chips)</Label>
          <Input
            id="tstack"
            type="number"
            min={1}
            value={value.startingStack}
            onChange={(e) => set({ startingStack: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label htmlFor="tmins">Minutes per level</Label>
          <Input
            id="tmins"
            type="number"
            min={1}
            max={120}
            value={value.levelMinutes}
            onChange={(e) => set({ levelMinutes: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label htmlFor="trebuy">Re-buy price (EUR, 0 = none)</Label>
          <Input
            id="trebuy"
            type="number"
            min={0}
            value={value.rebuyAmount}
            onChange={(e) => set({ rebuyAmount: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label htmlFor="trebuyc">Re-buy chips</Label>
          <Input
            id="trebuyc"
            type="number"
            min={0}
            value={value.rebuyChips}
            onChange={(e) => set({ rebuyChips: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label htmlFor="taddon">Add-on price (EUR, 0 = none)</Label>
          <Input
            id="taddon"
            type="number"
            min={0}
            value={value.addonAmount}
            onChange={(e) => set({ addonAmount: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label htmlFor="taddonc">Add-on chips</Label>
          <Input
            id="taddonc"
            type="number"
            min={0}
            value={value.addonChips}
            onChange={(e) => set({ addonChips: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      <div>
        <Label>Prize split</Label>
        <Select
          onValueChange={(id) => {
            const t = PAYOUT_TEMPLATES.find((x) => x.id === id);
            if (t) set({ payoutSplit: t.split.map((s) => ({ ...s })) });
          }}
        >
          <SelectTrigger className="mt-1 bg-background/60">
            <SelectValue placeholder="Load a template…" />
          </SelectTrigger>
          <SelectContent>
            {PAYOUT_TEMPLATES.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-2 space-y-2">
          {value.payoutSplit.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-16 text-sm text-muted-foreground">#{s.place}</span>
              <Input
                type="number"
                min={0}
                max={100}
                value={s.pct}
                onChange={(e) => {
                  const pct = Number(e.target.value) || 0;
                  set({ payoutSplit: value.payoutSplit.map((r, j) => (j === i ? { ...r, pct } : r)) });
                }}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">%</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() =>
                  set({
                    payoutSplit: value.payoutSplit
                      .filter((_, j) => j !== i)
                      .map((r, j) => ({ ...r, place: j + 1 })),
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                set({ payoutSplit: [...value.payoutSplit, { place: value.payoutSplit.length + 1, pct: 0 }] })
              }
            >
              <Plus className="mr-1 h-4 w-4" />
              Add place
            </Button>
            <span className={"text-xs " + (total === 100 ? "text-emerald-400" : "text-red-400")}>
              Total {total}% {total === 100 ? "" : "(must be 100%)"}
            </span>
          </div>
        </div>
      </div>

      <div>
        <Label>Blind levels ({value.blindLevels.length})</Label>
        <div className="mt-1 max-h-72 space-y-1 overflow-auto rounded-md border border-border/60 bg-background/30 p-2">
          {value.blindLevels.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-xs text-muted-foreground">{l.isBreak ? "☕" : `L${l.level}`}</span>
              {l.isBreak ? (
                <span className="flex-1 text-sm">Break</span>
              ) : (
                <>
                  <Input
                    type="number"
                    min={0}
                    value={l.small}
                    onChange={(e) => updateLevel(i, { small: Number(e.target.value) || 0 })}
                    className="h-8 w-20"
                  />
                  <Input
                    type="number"
                    min={0}
                    value={l.big}
                    onChange={(e) => updateLevel(i, { big: Number(e.target.value) || 0 })}
                    className="h-8 w-20"
                  />
                  <Input
                    type="number"
                    min={0}
                    value={l.ante}
                    onChange={(e) => updateLevel(i, { ante: Number(e.target.value) || 0 })}
                    className="h-8 w-20"
                    title="Ante"
                  />
                </>
              )}
              <Input
                type="number"
                min={1}
                value={l.minutes ?? value.levelMinutes}
                onChange={(e) => updateLevel(i, { minutes: Number(e.target.value) || 1 })}
                className="h-8 w-16"
                title="Minutes"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => set({ blindLevels: renumber(value.blindLevels.filter((_, j) => j !== i)) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => addLevel(false)}>
            <Plus className="mr-1 h-4 w-4" />
            Level
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => addLevel(true)}>
            <Coffee className="mr-1 h-4 w-4" />
            Break
          </Button>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">Columns: small blind · big blind · ante · minutes</div>
      </div>
    </div>
  );
}
