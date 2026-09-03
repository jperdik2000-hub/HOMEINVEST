-- Bots at poker tables: allow non-auth seat user ids, add is_bot / bot_name.

-- Drop foreign keys to auth.users on seat/hand/hole tables so bot uuids don't need real accounts.
ALTER TABLE public.poker_seats
  DROP CONSTRAINT IF EXISTS poker_seats_user_id_fkey;
ALTER TABLE public.poker_hand_seats
  DROP CONSTRAINT IF EXISTS poker_hand_seats_user_id_fkey;
ALTER TABLE public.poker_hole_cards
  DROP CONSTRAINT IF EXISTS poker_hole_cards_user_id_fkey;

-- Flag & optional display name for bot seats.
ALTER TABLE public.poker_seats
  ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_name TEXT;