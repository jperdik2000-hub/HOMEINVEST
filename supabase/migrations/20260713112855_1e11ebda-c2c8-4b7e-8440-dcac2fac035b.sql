
-- Wallet: eligible-to-withdraw
ALTER TABLE public.poker_wallets
  ADD COLUMN IF NOT EXISTS eligible_to_withdraw NUMERIC NOT NULL DEFAULT 0;

-- Settlement status enum
DO $$ BEGIN
  CREATE TYPE public.settlement_status AS ENUM (
    'unpaid','payment_marked_sent','payment_confirmed',
    'partially_withdrawn','fully_withdrawn','disputed','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.settlement_source AS ENUM ('poker','blackjack');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind public.settlement_source NOT NULL,
  source_table_id UUID NOT NULL,
  session_name TEXT NOT NULL,
  debtor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creditor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  status public.settlement_status NOT NULL DEFAULT 'unpaid',
  payment_method TEXT,
  payment_note TEXT,
  dispute_reason TEXT,
  marked_paid_at TIMESTAMPTZ,
  confirmed_received_at TIMESTAMPTZ,
  withdrawn_amount NUMERIC NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (debtor_id <> creditor_id)
);

CREATE INDEX IF NOT EXISTS settlements_debtor_idx ON public.settlements(debtor_id);
CREATE INDEX IF NOT EXISTS settlements_creditor_idx ON public.settlements(creditor_id);
CREATE INDEX IF NOT EXISTS settlements_source_idx ON public.settlements(source_kind, source_table_id);

GRANT SELECT, INSERT, UPDATE ON public.settlements TO authenticated;
GRANT ALL ON public.settlements TO service_role;

ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settlements_select_own_or_admin" ON public.settlements
  FOR SELECT TO authenticated
  USING (
    debtor_id = auth.uid()
    OR creditor_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

-- Only admins can insert directly (server fn uses service role but keep policy strict)
CREATE POLICY "settlements_insert_admin" ON public.settlements
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Updates are gated per-action in server functions using service role;
-- allow participants to update their own rows (server fns validate transitions).
CREATE POLICY "settlements_update_participants" ON public.settlements
  FOR UPDATE TO authenticated
  USING (
    debtor_id = auth.uid()
    OR creditor_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    debtor_id = auth.uid()
    OR creditor_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE TRIGGER settlements_set_updated_at
  BEFORE UPDATE ON public.settlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
