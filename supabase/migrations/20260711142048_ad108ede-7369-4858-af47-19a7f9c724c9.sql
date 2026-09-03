ALTER TABLE public.poker_wallets ALTER COLUMN chips SET DEFAULT 0;
UPDATE public.poker_wallets SET chips = 0;