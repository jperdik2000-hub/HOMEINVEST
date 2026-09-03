
-- 1) Tables

CREATE TABLE public.blackjack_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  min_bet NUMERIC NOT NULL DEFAULT 1 CHECK (min_bet > 0),
  max_bet NUMERIC NOT NULL DEFAULT 100 CHECK (max_bet >= min_bet),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blackjack_tables TO authenticated;
GRANT ALL ON public.blackjack_tables TO service_role;
ALTER TABLE public.blackjack_tables ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.blackjack_table_invitations (
  table_id UUID NOT NULL REFERENCES public.blackjack_tables(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, invited_user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blackjack_table_invitations TO authenticated;
GRANT ALL ON public.blackjack_table_invitations TO service_role;
ALTER TABLE public.blackjack_table_invitations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.blackjack_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES public.blackjack_tables(id) ON DELETE CASCADE,
  seat_index INT NOT NULL CHECK (seat_index >= 0 AND seat_index < 6),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (table_id, seat_index),
  UNIQUE (table_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blackjack_seats TO authenticated;
GRANT ALL ON public.blackjack_seats TO service_role;
ALTER TABLE public.blackjack_seats ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.blackjack_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES public.blackjack_tables(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'betting' CHECK (status IN ('betting','player','dealer','settled')),
  deck JSONB NOT NULL DEFAULT '[]'::jsonb,
  dealer_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
  dealer_hidden BOOLEAN NOT NULL DEFAULT true,
  current_seat INT,
  insurance_offered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);
CREATE INDEX blackjack_rounds_table_idx ON public.blackjack_rounds(table_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blackjack_rounds TO authenticated;
GRANT ALL ON public.blackjack_rounds TO service_role;
ALTER TABLE public.blackjack_rounds ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.blackjack_round_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES public.blackjack_rounds(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES public.blackjack_tables(id) ON DELETE CASCADE,
  seat_index INT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bet NUMERIC NOT NULL DEFAULT 0,
  insurance_bet NUMERIC NOT NULL DEFAULT 0,
  hands JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_hand INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'betting' CHECK (status IN ('betting','acting','done')),
  final_payout NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, seat_index)
);
CREATE INDEX blackjack_round_seats_round_idx ON public.blackjack_round_seats(round_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blackjack_round_seats TO authenticated;
GRANT ALL ON public.blackjack_round_seats TO service_role;
ALTER TABLE public.blackjack_round_seats ENABLE ROW LEVEL SECURITY;

-- 2) Security-definer helper (avoids recursive RLS)

CREATE OR REPLACE FUNCTION public.can_view_blackjack_table(_table UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.blackjack_tables t WHERE t.id = _table AND t.host_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.blackjack_table_invitations i WHERE i.table_id = _table AND i.invited_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.blackjack_seats s WHERE s.table_id = _table AND s.user_id = auth.uid());
$$;

-- 3) Policies

-- blackjack_tables
CREATE POLICY "members can view blackjack tables"
  ON public.blackjack_tables FOR SELECT TO authenticated
  USING (public.can_view_blackjack_table(id));

CREATE POLICY "users create own blackjack tables"
  ON public.blackjack_tables FOR INSERT TO authenticated
  WITH CHECK (host_id = auth.uid());

CREATE POLICY "host updates own blackjack table"
  ON public.blackjack_tables FOR UPDATE TO authenticated
  USING (host_id = auth.uid()) WITH CHECK (host_id = auth.uid());

CREATE POLICY "host deletes own blackjack table"
  ON public.blackjack_tables FOR DELETE TO authenticated
  USING (host_id = auth.uid());

-- blackjack_table_invitations
CREATE POLICY "members view invitations"
  ON public.blackjack_table_invitations FOR SELECT TO authenticated
  USING (public.can_view_blackjack_table(table_id) OR invited_user_id = auth.uid());

CREATE POLICY "host manages invitations"
  ON public.blackjack_table_invitations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.blackjack_tables t WHERE t.id = table_id AND t.host_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.blackjack_tables t WHERE t.id = table_id AND t.host_id = auth.uid()));

-- blackjack_seats
CREATE POLICY "members view seats"
  ON public.blackjack_seats FOR SELECT TO authenticated
  USING (public.can_view_blackjack_table(table_id));

CREATE POLICY "users sit themselves"
  ON public.blackjack_seats FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_view_blackjack_table(table_id));

CREATE POLICY "users leave own seat or host removes"
  ON public.blackjack_seats FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.blackjack_tables t WHERE t.id = table_id AND t.host_id = auth.uid()));

-- blackjack_rounds
CREATE POLICY "members view rounds"
  ON public.blackjack_rounds FOR SELECT TO authenticated
  USING (public.can_view_blackjack_table(table_id));

-- Writes to rounds/round_seats happen via service_role in server functions, so no INSERT/UPDATE policies needed for authenticated.

-- blackjack_round_seats
CREATE POLICY "members view round seats"
  ON public.blackjack_round_seats FOR SELECT TO authenticated
  USING (public.can_view_blackjack_table(table_id));

-- 4) updated_at triggers

CREATE TRIGGER blackjack_tables_updated
  BEFORE UPDATE ON public.blackjack_tables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER blackjack_rounds_updated
  BEFORE UPDATE ON public.blackjack_rounds
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER blackjack_round_seats_updated
  BEFORE UPDATE ON public.blackjack_round_seats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) Realtime

ALTER PUBLICATION supabase_realtime ADD TABLE public.blackjack_tables;
ALTER PUBLICATION supabase_realtime ADD TABLE public.blackjack_seats;
ALTER PUBLICATION supabase_realtime ADD TABLE public.blackjack_rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.blackjack_round_seats;
