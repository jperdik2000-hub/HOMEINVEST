ALTER TABLE public.poker_tables
  ALTER COLUMN small_blind TYPE numeric(12,2) USING small_blind::numeric,
  ALTER COLUMN big_blind TYPE numeric(12,2) USING big_blind::numeric,
  ALTER COLUMN buy_in TYPE numeric(12,2) USING buy_in::numeric;