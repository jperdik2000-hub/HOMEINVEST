ALTER TABLE public.poker_hands
  ALTER COLUMN pot TYPE numeric(14,2) USING pot::numeric,
  ALTER COLUMN current_bet TYPE numeric(14,2) USING current_bet::numeric,
  ALTER COLUMN min_raise TYPE numeric(14,2) USING min_raise::numeric;
ALTER TABLE public.poker_hand_seats
  ALTER COLUMN starting_stack TYPE numeric(14,2) USING starting_stack::numeric,
  ALTER COLUMN stack TYPE numeric(14,2) USING stack::numeric,
  ALTER COLUMN committed_street TYPE numeric(14,2) USING committed_street::numeric,
  ALTER COLUMN committed_hand TYPE numeric(14,2) USING committed_hand::numeric;
ALTER TABLE public.poker_hand_actions
  ALTER COLUMN amount TYPE numeric(14,2) USING amount::numeric;
ALTER TABLE public.poker_seats
  ALTER COLUMN stack TYPE numeric(14,2) USING stack::numeric;
ALTER TABLE public.poker_wallets
  ALTER COLUMN chips TYPE numeric(14,2) USING chips::numeric;