
-- Allow bot seats (no user_id) in blackjack tables
ALTER TABLE public.blackjack_seats ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.blackjack_seats ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.blackjack_seats ADD COLUMN IF NOT EXISTS bot_name TEXT;

ALTER TABLE public.blackjack_round_seats ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.blackjack_round_seats ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;
