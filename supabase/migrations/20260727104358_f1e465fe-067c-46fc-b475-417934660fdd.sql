CREATE TABLE public.game_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  night_id uuid NOT NULL REFERENCES public.poker_nights(id) ON DELETE CASCADE,
  player_id uuid,
  event_type text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  chip_amount numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX game_events_night_created_idx ON public.game_events (night_id, created_at DESC);

GRANT SELECT ON public.game_events TO authenticated;
GRANT SELECT ON public.game_events TO anon;
GRANT ALL ON public.game_events TO service_role;
ALTER TABLE public.game_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.night_tv_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  night_id uuid NOT NULL UNIQUE REFERENCES public.poker_nights(id) ON DELETE CASCADE,
  code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  announcement text,
  settings jsonb NOT NULL DEFAULT '{
    "showMoney": true,
    "showChips": false,
    "showRankings": true,
    "sounds": true,
    "animations": true,
    "showFeed": true,
    "theme": "dark",
    "overlayEvents": ["player_joined","buy_in","rebuy","addon","eliminated","cash_out","break_start","break_end","blind_up","game_paused","game_resumed","winner","announcement"]
  }'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX night_tv_sessions_active_code_idx ON public.night_tv_sessions (code) WHERE active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.night_tv_sessions TO authenticated;
GRANT ALL ON public.night_tv_sessions TO service_role;
ALTER TABLE public.night_tv_sessions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.tv_session_active(_night uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.night_tv_sessions s WHERE s.night_id = _night AND s.active)
$$;

CREATE POLICY "Night viewers can read events" ON public.game_events
  FOR SELECT TO authenticated USING (public.can_view_night(night_id));
CREATE POLICY "Paired TVs can read events" ON public.game_events
  FOR SELECT TO anon USING (public.tv_session_active(night_id));
CREATE POLICY "Night admins can add events" ON public.game_events
  FOR INSERT TO authenticated WITH CHECK (public.is_night_admin(night_id));

CREATE POLICY "Night admins manage tv sessions" ON public.night_tv_sessions
  FOR ALL TO authenticated USING (public.is_night_admin(night_id)) WITH CHECK (public.is_night_admin(night_id));

CREATE TRIGGER night_tv_sessions_updated_at BEFORE UPDATE ON public.night_tv_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-log player events
CREATE OR REPLACE FUNCTION public.log_player_result_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _name text;
BEGIN
  SELECT COALESCE(p.nickname, p.name, NEW.player_name) INTO _name FROM public.profiles p WHERE p.id = NEW.user_id;
  _name := COALESCE(_name, NEW.player_name);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.game_events(night_id, player_id, event_type, amount, metadata, created_by)
    VALUES (NEW.night_id, NEW.user_id, 'player_joined', 0, jsonb_build_object('name', _name), auth.uid());
    IF COALESCE(NEW.buy_in, 0) > 0 THEN
      INSERT INTO public.game_events(night_id, player_id, event_type, amount, metadata, created_by)
      VALUES (NEW.night_id, NEW.user_id, 'buy_in', NEW.buy_in,
              jsonb_build_object('name', _name, 'total', COALESCE(NEW.buy_in,0) + COALESCE(NEW.rebuys,0)), auth.uid());
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.rebuys,0) > COALESCE(OLD.rebuys,0) THEN
    INSERT INTO public.game_events(night_id, player_id, event_type, amount, metadata, created_by)
    VALUES (NEW.night_id, NEW.user_id, 'rebuy', COALESCE(NEW.rebuys,0) - COALESCE(OLD.rebuys,0),
            jsonb_build_object('name', _name, 'total', COALESCE(NEW.buy_in,0) + COALESCE(NEW.rebuys,0)), auth.uid());
  END IF;

  IF COALESCE(NEW.cash_out,0) IS DISTINCT FROM COALESCE(OLD.cash_out,0) AND COALESCE(NEW.cash_out,0) <> 0 THEN
    INSERT INTO public.game_events(night_id, player_id, event_type, amount, metadata, created_by)
    VALUES (NEW.night_id, NEW.user_id, 'cash_out', NEW.cash_out,
            jsonb_build_object('name', _name, 'total', COALESCE(NEW.buy_in,0) + COALESCE(NEW.rebuys,0)), auth.uid());
  END IF;

  IF NEW.final_rank IS NOT NULL AND OLD.final_rank IS DISTINCT FROM NEW.final_rank THEN
    INSERT INTO public.game_events(night_id, player_id, event_type, amount, metadata, created_by)
    VALUES (NEW.night_id, NEW.user_id, CASE WHEN NEW.final_rank = 1 THEN 'winner' ELSE 'eliminated' END, 0,
            jsonb_build_object('name', _name, 'rank', NEW.final_rank), auth.uid());
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER player_results_game_events
AFTER INSERT OR UPDATE ON public.player_results
FOR EACH ROW EXECUTE FUNCTION public.log_player_result_events();

CREATE OR REPLACE FUNCTION public.log_night_status_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.started_at IS NULL AND NEW.started_at IS NOT NULL THEN
    INSERT INTO public.game_events(night_id, event_type, metadata, created_by)
    VALUES (NEW.id, 'game_started', jsonb_build_object('title', NEW.title), auth.uid());
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('completed','cancelled') THEN
    INSERT INTO public.game_events(night_id, event_type, metadata, created_by)
    VALUES (NEW.id, 'game_completed', jsonb_build_object('status', NEW.status), auth.uid());
    UPDATE public.night_tv_sessions SET active = active WHERE night_id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER poker_nights_game_events
AFTER UPDATE ON public.poker_nights
FOR EACH ROW EXECUTE FUNCTION public.log_night_status_events();

ALTER PUBLICATION supabase_realtime ADD TABLE public.game_events;