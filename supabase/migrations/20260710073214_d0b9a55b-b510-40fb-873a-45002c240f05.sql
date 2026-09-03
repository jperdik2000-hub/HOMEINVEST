
-- New variants: 5-card 1-board, 5-card 2-board, Pineapple. Plus discard street, turn timer, timeout_fold action.

ALTER TABLE public.poker_hands DROP CONSTRAINT IF EXISTS poker_hands_variant_check;
ALTER TABLE public.poker_hands ADD CONSTRAINT poker_hands_variant_check
  CHECK (variant IN ('holdem','omaha','five_one','five_two','pineapple'));

ALTER TABLE public.poker_hands DROP CONSTRAINT IF EXISTS poker_hands_street_check;
ALTER TABLE public.poker_hands ADD CONSTRAINT poker_hands_street_check
  CHECK (street IN ('preflop','flop','turn','river','showdown','ended','discard'));

ALTER TABLE public.poker_hand_actions DROP CONSTRAINT IF EXISTS poker_hand_actions_action_check;
ALTER TABLE public.poker_hand_actions ADD CONSTRAINT poker_hand_actions_action_check
  CHECK (action IN ('post_sb','post_bb','fold','check','call','bet','raise','all_in','deal','win','discard','timeout_fold'));

ALTER TABLE public.poker_hands
  ADD COLUMN IF NOT EXISTS turn_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discards JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Widen rig variant CHECK too (none existed; column is free text — leave as-is).
