CREATE TABLE public.poker_wallet_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('deposit','buy_in','cashout','settlement','adjust')),
  amount NUMERIC NOT NULL,
  balance_after NUMERIC,
  table_id UUID REFERENCES public.poker_tables(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.poker_wallet_transactions TO authenticated;
GRANT ALL ON public.poker_wallet_transactions TO service_role;

ALTER TABLE public.poker_wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own transactions"
  ON public.poker_wallet_transactions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX poker_wallet_transactions_user_created_idx
  ON public.poker_wallet_transactions (user_id, created_at DESC);