
-- Dice Duel tables
CREATE TABLE public.dice_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  host_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dice_tables TO authenticated;
GRANT ALL ON public.dice_tables TO service_role;
ALTER TABLE public.dice_tables ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.dice_table_invitations (
  table_id uuid NOT NULL REFERENCES public.dice_tables(id) ON DELETE CASCADE,
  invited_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, invited_user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dice_table_invitations TO authenticated;
GRANT ALL ON public.dice_table_invitations TO service_role;
ALTER TABLE public.dice_table_invitations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.dice_duels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.dice_tables(id) ON DELETE CASCADE,
  challenger_id uuid NOT NULL,
  opponent_id uuid NOT NULL,
  stake numeric NOT NULL CHECK (stake > 0),
  status text NOT NULL DEFAULT 'pending',
  challenger_rolls int[],
  opponent_rolls int[],
  reroll_count int NOT NULL DEFAULT 0,
  winner_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dice_duels TO authenticated;
GRANT ALL ON public.dice_duels TO service_role;
ALTER TABLE public.dice_duels ENABLE ROW LEVEL SECURITY;

CREATE INDEX dice_duels_table_idx ON public.dice_duels(table_id, created_at DESC);
CREATE INDEX dice_duels_opponent_pending_idx ON public.dice_duels(opponent_id) WHERE status = 'pending';

-- Access helper
CREATE OR REPLACE FUNCTION public.can_view_dice_table(_table uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.dice_tables t WHERE t.id = _table AND t.host_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.dice_table_invitations i WHERE i.table_id = _table AND i.invited_user_id = auth.uid());
$$;

-- Policies: dice_tables
CREATE POLICY "View dice tables you host or are invited to"
  ON public.dice_tables FOR SELECT TO authenticated
  USING (public.can_view_dice_table(id));

CREATE POLICY "Admins can create dice tables"
  ON public.dice_tables FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Host can update dice tables"
  ON public.dice_tables FOR UPDATE TO authenticated
  USING (host_id = auth.uid()) WITH CHECK (host_id = auth.uid());

CREATE POLICY "Host can delete dice tables"
  ON public.dice_tables FOR DELETE TO authenticated
  USING (host_id = auth.uid());

-- Policies: invitations
CREATE POLICY "View dice invitations for tables you can see"
  ON public.dice_table_invitations FOR SELECT TO authenticated
  USING (public.can_view_dice_table(table_id));

CREATE POLICY "Host manages dice invitations"
  ON public.dice_table_invitations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.dice_tables t WHERE t.id = table_id AND t.host_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.dice_tables t WHERE t.id = table_id AND t.host_id = auth.uid()));

-- Policies: duels
CREATE POLICY "View duels at tables you can see"
  ON public.dice_duels FOR SELECT TO authenticated
  USING (public.can_view_dice_table(table_id));
-- All writes go through server functions (service role); no direct client mutations.
