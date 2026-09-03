# Total money through the app

Add a dashboard stat showing the total cash volume that has moved through completed in-person games.

## What it shows

- **Total money played** — sum of every player's buy-in plus rebuys across completed games. Today that is €7,470 over 28 player entries.
- Two supporting figures on the same card: number of completed games and average pot volume per game.
- Casino (virtual chips) volume is excluded.

## Placement

A new stat card at the top of the Poker Club dashboard, above the existing three cards (Upcoming games / Leaderboard / Recent games), styled with the same felt card look and gold accent.

## Technical notes

- Reuse the existing `results` query (`fetchAllResults`, already filtered to completed nights) — no new database work, no new server function.
- Compute in a `useMemo` in `src/routes/_authenticated/dashboard.tsx`: `sum(buy_in + rebuys)`, distinct `night_id` count, and the derived average.
- Format with the existing `formatMoney` helper so currency stays consistent.
