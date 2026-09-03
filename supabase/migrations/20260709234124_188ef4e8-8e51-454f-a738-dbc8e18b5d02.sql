
-- 1) Add chip amount per buy-in to poker_nights
ALTER TABLE public.poker_nights ADD COLUMN IF NOT EXISTS buy_in_chips INTEGER NOT NULL DEFAULT 0;

-- 2) Debt ledger table: tracks who-pays-whom transfers per completed night, with paid flag
CREATE TABLE public.settlement_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  night_id UUID NOT NULL REFERENCES public.poker_nights(id) ON DELETE CASCADE,
  from_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  from_name TEXT NOT NULL,
  to_name TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  paid BOOLEAN NOT NULL DEFAULT false,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_settlement_payments_night ON public.settlement_payments(night_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.settlement_payments TO authenticated;
GRANT ALL ON public.settlement_payments TO service_role;

ALTER TABLE public.settlement_payments ENABLE ROW LEVEL SECURITY;

-- Participants of the night can view the ledger
CREATE POLICY "Participants can view ledger" ON public.settlement_payments
  FOR SELECT TO authenticated
  USING (public.can_view_night(night_id));

-- Host can fully manage entries
CREATE POLICY "Host manages ledger" ON public.settlement_payments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.poker_nights n WHERE n.id = night_id AND n.host_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.poker_nights n WHERE n.id = night_id AND n.host_id = auth.uid()));

-- The debtor or creditor can update the paid flag on their own row
CREATE POLICY "Payer or payee can update paid" ON public.settlement_payments
  FOR UPDATE TO authenticated
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid())
  WITH CHECK (from_user_id = auth.uid() OR to_user_id = auth.uid());

CREATE TRIGGER settlement_payments_set_updated_at
  BEFORE UPDATE ON public.settlement_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
