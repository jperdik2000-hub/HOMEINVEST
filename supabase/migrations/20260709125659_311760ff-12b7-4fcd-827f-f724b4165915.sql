
-- =========================================
-- Play-money wallet
-- =========================================
CREATE TABLE public.poker_wallets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chips BIGINT NOT NULL DEFAULT 100000 CHECK (chips >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.poker_wallets TO authenticated;
GRANT ALL ON public.poker_wallets TO service_role;
ALTER TABLE public.poker_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own wallet" ON public.poker_wallets FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users read others wallet" ON public.poker_wallets FOR SELECT TO authenticated USING (true);
-- (chips are public between club members; simpler than joining through seats)
CREATE TRIGGER trg_poker_wallets_updated BEFORE UPDATE ON public.poker_wallets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create wallet for existing + new users
INSERT INTO public.poker_wallets (user_id) SELECT id FROM auth.users ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_poker_wallet_for_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.poker_wallets(user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

-- Piggyback: extend handle_new_user by adding a separate trigger
DROP TRIGGER IF EXISTS on_auth_user_wallet_created ON auth.users;
CREATE TRIGGER on_auth_user_wallet_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_poker_wallet_for_new_user();

-- =========================================
-- Tables
-- =========================================
CREATE TABLE public.poker_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  small_blind INT NOT NULL DEFAULT 25 CHECK (small_blind > 0),
  big_blind INT NOT NULL DEFAULT 50 CHECK (big_blind >= small_blind),
  buy_in INT NOT NULL DEFAULT 5000 CHECK (buy_in > 0),
  max_seats INT NOT NULL DEFAULT 6 CHECK (max_seats BETWEEN 2 AND 9),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','active','ended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.poker_tables TO authenticated;
GRANT ALL ON public.poker_tables TO service_role;
ALTER TABLE public.poker_tables ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_poker_tables_updated BEFORE UPDATE ON public.poker_tables FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- Invitations
-- =========================================
CREATE TABLE public.poker_table_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(table_id, invited_user_id)
);
GRANT SELECT, INSERT, DELETE ON public.poker_table_invitations TO authenticated;
GRANT ALL ON public.poker_table_invitations TO service_role;
ALTER TABLE public.poker_table_invitations ENABLE ROW LEVEL SECURITY;

-- Access helper
CREATE OR REPLACE FUNCTION public.can_view_poker_table(_table UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    EXISTS(SELECT 1 FROM public.poker_tables t WHERE t.id = _table AND t.host_id = auth.uid())
    OR EXISTS(SELECT 1 FROM public.poker_table_invitations i WHERE i.table_id = _table AND i.invited_user_id = auth.uid());
$$;

CREATE POLICY "View tables you host or are invited to" ON public.poker_tables FOR SELECT TO authenticated
  USING (host_id = auth.uid() OR public.can_view_poker_table(id));
CREATE POLICY "Any user can create table" ON public.poker_tables FOR INSERT TO authenticated WITH CHECK (host_id = auth.uid());
CREATE POLICY "Host manages table" ON public.poker_tables FOR UPDATE TO authenticated USING (host_id = auth.uid());
CREATE POLICY "Host deletes table" ON public.poker_tables FOR DELETE TO authenticated USING (host_id = auth.uid());

CREATE POLICY "View invitations for viewable tables" ON public.poker_table_invitations FOR SELECT TO authenticated
  USING (invited_user_id = auth.uid() OR public.can_view_poker_table(table_id));
CREATE POLICY "Host manages invitations" ON public.poker_table_invitations FOR INSERT TO authenticated
  WITH CHECK (EXISTS(SELECT 1 FROM public.poker_tables t WHERE t.id = table_id AND t.host_id = auth.uid()));
CREATE POLICY "Host deletes invitations" ON public.poker_table_invitations FOR DELETE TO authenticated
  USING (EXISTS(SELECT 1 FROM public.poker_tables t WHERE t.id = table_id AND t.host_id = auth.uid()));

-- =========================================
-- Seats
-- =========================================
CREATE TABLE public.poker_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  seat_index INT NOT NULL CHECK (seat_index >= 0),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stack BIGINT NOT NULL CHECK (stack >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','sitting_out','left')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(table_id, seat_index),
  UNIQUE(table_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.poker_seats TO authenticated;
GRANT ALL ON public.poker_seats TO service_role;
ALTER TABLE public.poker_seats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View seats at viewable tables" ON public.poker_seats FOR SELECT TO authenticated
  USING (public.can_view_poker_table(table_id));
-- Writes go through server functions using service role; block direct writes
CREATE POLICY "No direct seat writes" ON public.poker_seats FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "No direct seat updates" ON public.poker_seats FOR UPDATE TO authenticated USING (false);

-- =========================================
-- Hands + actions + hole cards
-- =========================================
CREATE TABLE public.poker_hands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  hand_no INT NOT NULL,
  dealer_seat INT NOT NULL,
  current_seat INT,
  street TEXT NOT NULL DEFAULT 'preflop' CHECK (street IN ('preflop','flop','turn','river','showdown','ended')),
  board TEXT[] NOT NULL DEFAULT '{}',
  pot BIGINT NOT NULL DEFAULT 0,
  current_bet BIGINT NOT NULL DEFAULT 0,
  min_raise BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  winners JSONB,
  deadline TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  UNIQUE(table_id, hand_no)
);
GRANT SELECT ON public.poker_hands TO authenticated;
GRANT ALL ON public.poker_hands TO service_role;
ALTER TABLE public.poker_hands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View hands at viewable tables" ON public.poker_hands FOR SELECT TO authenticated
  USING (public.can_view_poker_table(table_id));

CREATE TABLE public.poker_hand_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hand_id UUID NOT NULL REFERENCES public.poker_hands(id) ON DELETE CASCADE,
  seq INT NOT NULL,
  seat_index INT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('post_sb','post_bb','fold','check','call','bet','raise','all_in','deal','win')),
  amount BIGINT NOT NULL DEFAULT 0,
  street TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(hand_id, seq)
);
GRANT SELECT ON public.poker_hand_actions TO authenticated;
GRANT ALL ON public.poker_hand_actions TO service_role;
ALTER TABLE public.poker_hand_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View actions at viewable tables" ON public.poker_hand_actions FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.poker_hands h WHERE h.id = hand_id AND public.can_view_poker_table(h.table_id)));

CREATE TABLE public.poker_hole_cards (
  hand_id UUID NOT NULL REFERENCES public.poker_hands(id) ON DELETE CASCADE,
  seat_index INT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cards TEXT[] NOT NULL,
  revealed BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (hand_id, seat_index)
);
GRANT SELECT ON public.poker_hole_cards TO authenticated;
GRANT ALL ON public.poker_hole_cards TO service_role;
ALTER TABLE public.poker_hole_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "See own hole cards or revealed" ON public.poker_hole_cards FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR revealed = true);

-- =========================================
-- Realtime
-- =========================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.poker_tables;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poker_seats;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poker_hands;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poker_hand_actions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poker_hole_cards;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poker_table_invitations;

ALTER TABLE public.poker_tables REPLICA IDENTITY FULL;
ALTER TABLE public.poker_seats REPLICA IDENTITY FULL;
ALTER TABLE public.poker_hands REPLICA IDENTITY FULL;
ALTER TABLE public.poker_hand_actions REPLICA IDENTITY FULL;
