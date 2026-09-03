ALTER TABLE public.poker_nights
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS starting_stack integer NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS rebuy_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rebuy_chips integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS addon_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS addon_chips integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level_minutes integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS blind_levels jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS payout_split jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS current_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS clock_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS tournament_status text NOT NULL DEFAULT 'not_started';

ALTER TABLE public.poker_nights
  ADD CONSTRAINT poker_nights_format_chk CHECK (format IN ('cash','tournament')),
  ADD CONSTRAINT poker_nights_tstatus_chk CHECK (tournament_status IN ('not_started','running','finished'));

CREATE TABLE IF NOT EXISTS public.tournament_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  night_id uuid NOT NULL REFERENCES public.poker_nights(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  player_name text NOT NULL,
  chips integer NOT NULL DEFAULT 0,
  buy_ins integer NOT NULL DEFAULT 1,
  rebuys integer NOT NULL DEFAULT 0,
  addons integer NOT NULL DEFAULT 0,
  place integer,
  knocked_out_by uuid,
  eliminated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tournament_entries_night_idx ON public.tournament_entries(night_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_entries TO authenticated;
GRANT ALL ON public.tournament_entries TO service_role;

ALTER TABLE public.tournament_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View entries for viewable nights"
  ON public.tournament_entries FOR SELECT TO authenticated
  USING (public.can_view_night(night_id));

CREATE POLICY "Night admins insert entries"
  ON public.tournament_entries FOR INSERT TO authenticated
  WITH CHECK (public.is_night_admin(night_id));

CREATE POLICY "Night admins update entries"
  ON public.tournament_entries FOR UPDATE TO authenticated
  USING (public.is_night_admin(night_id))
  WITH CHECK (public.is_night_admin(night_id));

CREATE POLICY "Night admins delete entries"
  ON public.tournament_entries FOR DELETE TO authenticated
  USING (public.is_night_admin(night_id));

CREATE TRIGGER tournament_entries_set_updated_at
  BEFORE UPDATE ON public.tournament_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();