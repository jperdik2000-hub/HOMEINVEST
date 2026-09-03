
-- Table-level: mode (currently dealers_choice supported; keep column for future)
ALTER TABLE public.poker_tables
  ADD COLUMN IF NOT EXISTS game_mode TEXT NOT NULL DEFAULT 'dealers_choice'
    CHECK (game_mode IN ('dealers_choice','holdem_only','omaha_only'));

-- Per-hand variant
ALTER TABLE public.poker_hands
  ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT 'holdem'
    CHECK (variant IN ('holdem','omaha'));
ALTER TABLE public.poker_hands
  ADD COLUMN IF NOT EXISTS side_pots JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Hole cards: showdown reveal / muck
ALTER TABLE public.poker_hole_cards
  ADD COLUMN IF NOT EXISTS mucked BOOLEAN NOT NULL DEFAULT false;

-- Let players flip revealed on their own hole cards (existing SELECT policy already covers reads).
CREATE POLICY "Player reveals own hole cards" ON public.poker_hole_cards
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Per-hand per-seat state
CREATE TABLE public.poker_hand_seats (
  hand_id UUID NOT NULL REFERENCES public.poker_hands(id) ON DELETE CASCADE,
  seat_index INTEGER NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  starting_stack BIGINT NOT NULL,
  stack BIGINT NOT NULL,
  committed_hand BIGINT NOT NULL DEFAULT 0,
  committed_street BIGINT NOT NULL DEFAULT 0,
  folded BOOLEAN NOT NULL DEFAULT false,
  all_in BOOLEAN NOT NULL DEFAULT false,
  last_action TEXT,
  has_acted BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (hand_id, seat_index)
);

GRANT SELECT ON public.poker_hand_seats TO authenticated;
GRANT ALL ON public.poker_hand_seats TO service_role;

ALTER TABLE public.poker_hand_seats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View hand seats at viewable tables" ON public.poker_hand_seats
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.poker_hands h
    WHERE h.id = hand_id AND public.can_view_poker_table(h.table_id)
  ));

ALTER PUBLICATION supabase_realtime ADD TABLE public.poker_hand_seats;
