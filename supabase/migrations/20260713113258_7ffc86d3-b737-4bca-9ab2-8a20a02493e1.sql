
ALTER TABLE public.poker_wallet_transactions
  ADD COLUMN IF NOT EXISTS settlement_id UUID REFERENCES public.settlements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pwt_settlement_idx ON public.poker_wallet_transactions(settlement_id);

CREATE TABLE IF NOT EXISTS public.withdrawal_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_tx_id UUID NOT NULL REFERENCES public.poker_wallet_transactions(id) ON DELETE CASCADE,
  settlement_id UUID NOT NULL REFERENCES public.settlements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_settlement_idx ON public.withdrawal_allocations(settlement_id);
CREATE INDEX IF NOT EXISTS wa_user_idx ON public.withdrawal_allocations(user_id);

GRANT SELECT ON public.withdrawal_allocations TO authenticated;
GRANT ALL ON public.withdrawal_allocations TO service_role;

ALTER TABLE public.withdrawal_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_select_own" ON public.withdrawal_allocations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
