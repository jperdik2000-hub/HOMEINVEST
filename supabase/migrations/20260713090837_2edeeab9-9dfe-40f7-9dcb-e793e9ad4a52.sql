ALTER TABLE public.blackjack_round_seats
  ADD COLUMN IF NOT EXISTS cards_pending INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_kind TEXT;