# Tournament Mode for Poker Nights

Add a game format choice when creating a night — **Cash game** (today's behaviour) or **Tournament** — and build a full tournament experience around it.

## Creating a night

- New "Format" toggle: Cash game / Tournament. Cash game stays exactly as it is.
- When Tournament is picked, extra fields appear:
  - Buy-in (already exists), starting chip stack
  - Re-buys allowed (yes/no, amount, chips), add-on (optional)
  - Blind structure: level length in minutes + a list of levels (small/big blind, ante). Ships with a default structure the host can edit, plus a Turbo preset.
  - Payout split: pick a template (Winner takes all, 70/30, 50/30/20, 40/30/20/10) or switch to Custom and type each place's percentage. Live validation that percentages total 100.
- All existing and past nights are treated as cash games.

## During the tournament (night page)

A new **Tournament** panel visible to everyone, editable by host/admin:

- **Blind clock**: current level, blinds/ante, countdown to next level, next blinds preview. Host controls Start / Pause / Next level / Previous level. The clock is driven by a stored level-start timestamp so every device and the TV stay in sync without a shared server tick.
- **Players & stacks**: list of entrants with current chip stack, host can adjust a stack, register a late entry, log a re-buy or add-on (which grows the prize pool automatically).
- **Knockouts**: "Bust out" button per player. Busting assigns the next finishing place from the bottom up, records who knocked them out, and pushes a live event.
- **Prize pool**: live total = buy-ins + re-buys + add-ons, with the money value of each paid place recomputed from the split.
- Live updates for all viewers over realtime, same as the chat/TV feed already does.

## TV display

- Tournament nights show a tournament layout: large blind clock, level, next blinds, prize pool, average stack, players remaining, chip-leader ordering.
- Knockout and level-change events animate as overlays through the existing event feed, with the existing sound support.

## Results

- Tournament nights log results by **finish order** instead of cash-out amounts: places are pre-filled from knockouts, and prize money per place is auto-calculated from the payout split (host can override).
- Cash games keep the current buy-in / re-buys / cash-out form.
- Net result, leaderboard, stats, settlements and history keep working unchanged, because prize money is written to the same cash-out field.

## Push notifications

- Tournament started, blind level up (optional, off by default), each knockout ("X busted in 5th"), and final results — reusing the existing push system and per-chat mute rules.

## Technical notes

- Migration: `poker_nights` gains `format` ('cash' | 'tournament', default 'cash'), `starting_stack`, `rebuy_amount`, `rebuy_chips`, `addon_amount`, `addon_chips`, `level_minutes`, `blind_levels` (jsonb), `payout_split` (jsonb), plus tournament clock state (`current_level`, `level_started_at`, `clock_paused_at`, `tournament_status`).
- New table `tournament_entries` (night_id, user_id/player_name, chips, buy-ins, re-buys, add-ons, place, knocked_out_by, eliminated_at) with GRANTs and RLS mirroring the existing night-visibility helpers (`can_view_night`, `is_night_admin`).
- Clock/knockout/re-buy mutations go through new server functions in `src/lib/tournament.functions.ts` using `requireSupabaseAuth`, with host/admin checks server-side.
- Knockouts and level changes also write to `game_events` so the existing TV feed and activity list pick them up with no extra wiring.
- UI work lands in `nights.new.tsx`, `nights.$id.tsx`, `nights.$id.edit.tsx`, `nights.$id.results.tsx`, `TvDisplay.tsx`, plus a new `TournamentPanel` and `BlindClock` component.
