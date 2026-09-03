
DELETE FROM public.settlements WHERE source_kind = 'dice';

DROP TABLE IF EXISTS public.dice_duels CASCADE;
DROP TABLE IF EXISTS public.dice_table_invitations CASCADE;
DROP TABLE IF EXISTS public.dice_tables CASCADE;

DROP FUNCTION IF EXISTS public.can_view_dice_table(uuid);

ALTER TYPE public.settlement_source RENAME TO settlement_source_old;
CREATE TYPE public.settlement_source AS ENUM ('poker', 'blackjack');
ALTER TABLE public.settlements
  ALTER COLUMN source_kind TYPE public.settlement_source
  USING source_kind::text::public.settlement_source;
DROP TYPE public.settlement_source_old;
