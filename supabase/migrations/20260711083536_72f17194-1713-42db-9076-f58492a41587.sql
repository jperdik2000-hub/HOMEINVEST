
-- Defaults
ALTER TABLE public.poker_tables ALTER COLUMN small_blind SET DEFAULT 0.5;
ALTER TABLE public.poker_tables ALTER COLUMN big_blind SET DEFAULT 0.5;
ALTER TABLE public.poker_tables ALTER COLUMN buy_in SET DEFAULT 50;
ALTER TABLE public.poker_tables ALTER COLUMN max_seats SET DEFAULT 8;

-- Track cumulative buy-in per seat
ALTER TABLE public.poker_seats ADD COLUMN IF NOT EXISTS total_buy_in numeric(14,2) NOT NULL DEFAULT 0;
UPDATE public.poker_seats SET total_buy_in = stack WHERE total_buy_in = 0;

-- Store settlement on end
ALTER TABLE public.poker_tables ADD COLUMN IF NOT EXISTS settlement jsonb;

-- Rebuy queue
CREATE TABLE IF NOT EXISTS public.poker_rebuy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid
);

CREATE INDEX IF NOT EXISTS poker_rebuy_requests_table_idx
  ON public.poker_rebuy_requests(table_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.poker_rebuy_requests TO authenticated;
GRANT ALL ON public.poker_rebuy_requests TO service_role;

ALTER TABLE public.poker_rebuy_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View own or as host"
  ON public.poker_rebuy_requests FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.poker_tables t
      WHERE t.id = table_id AND t.host_id = auth.uid()
    )
  );

CREATE POLICY "No direct rebuy inserts"
  ON public.poker_rebuy_requests FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "No direct rebuy updates"
  ON public.poker_rebuy_requests FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "No direct rebuy deletes"
  ON public.poker_rebuy_requests FOR DELETE
  TO authenticated
  USING (false);
