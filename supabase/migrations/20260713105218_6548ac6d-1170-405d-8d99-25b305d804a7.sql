
ALTER TABLE public.poker_wallet_transactions
  ADD COLUMN IF NOT EXISTS settled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Allow the wallet owner OR an admin to update the settled flag on their transactions.
DROP POLICY IF EXISTS "Owner or admin can settle txs" ON public.poker_wallet_transactions;
CREATE POLICY "Owner or admin can settle txs"
  ON public.poker_wallet_transactions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Everyone signed in can read wallet balances (already true for poker_wallets, mirror for names via profiles).
-- Allow authenticated users to read every user's transaction summary is NOT desired; we'll aggregate server-side.
