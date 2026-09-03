ALTER TABLE public.blackjack_round_seats
  ADD COLUMN IF NOT EXISTS side_bet_21_3 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS side_bet_21_3_payout integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS side_bet_21_3_result text,
  ADD COLUMN IF NOT EXISTS side_bet_21_3_settled boolean NOT NULL DEFAULT false;