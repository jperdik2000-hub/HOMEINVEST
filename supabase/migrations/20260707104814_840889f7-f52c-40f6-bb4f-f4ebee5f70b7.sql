
-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  nickname TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles are viewable by authenticated users"
  ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, nickname, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'nickname',
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Poker nights
CREATE TABLE public.poker_nights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  location TEXT,
  buy_in NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled|completed|cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.poker_nights TO authenticated;
GRANT ALL ON public.poker_nights TO service_role;
ALTER TABLE public.poker_nights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Any signed-in user can view nights"
  ON public.poker_nights FOR SELECT TO authenticated USING (true);
CREATE POLICY "Any signed-in user can create a night"
  ON public.poker_nights FOR INSERT TO authenticated WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Host can update their night"
  ON public.poker_nights FOR UPDATE TO authenticated USING (auth.uid() = host_id);
CREATE POLICY "Host can delete their night"
  ON public.poker_nights FOR DELETE TO authenticated USING (auth.uid() = host_id);

CREATE TRIGGER poker_nights_set_updated_at BEFORE UPDATE ON public.poker_nights
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Invitations (for both registered and email-only invitees)
CREATE TABLE public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  night_id UUID NOT NULL REFERENCES public.poker_nights(id) ON DELETE CASCADE,
  invited_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_name TEXT,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invitations TO authenticated;
GRANT ALL ON public.invitations TO service_role;
GRANT SELECT ON public.invitations TO anon; -- RSVP link lookup by token
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can view invitations"
  ON public.invitations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anon can view by token (list restricted client-side)"
  ON public.invitations FOR SELECT TO anon USING (true);
CREATE POLICY "Host can create invitations"
  ON public.invitations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.poker_nights n WHERE n.id = night_id AND n.host_id = auth.uid()));
CREATE POLICY "Host can delete invitations"
  ON public.invitations FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.poker_nights n WHERE n.id = night_id AND n.host_id = auth.uid()));

-- RSVPs
CREATE TABLE public.rsvps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  night_id UUID NOT NULL REFERENCES public.poker_nights(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL CHECK (status IN ('attending','maybe','declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (night_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rsvps TO authenticated;
GRANT ALL ON public.rsvps TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.rsvps TO anon; -- token-based RSVP
ALTER TABLE public.rsvps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can view rsvps"
  ON public.rsvps FOR SELECT TO authenticated USING (true);
CREATE POLICY "Signed-in users can rsvp for themselves"
  ON public.rsvps FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own rsvp"
  ON public.rsvps FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Host can manage all rsvps for their night"
  ON public.rsvps FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.poker_nights n WHERE n.id = night_id AND n.host_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.poker_nights n WHERE n.id = night_id AND n.host_id = auth.uid()));
CREATE POLICY "Anon rsvp read"
  ON public.rsvps FOR SELECT TO anon USING (true);
CREATE POLICY "Anon rsvp insert (guarded by token elsewhere)"
  ON public.rsvps FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon rsvp update"
  ON public.rsvps FOR UPDATE TO anon USING (true);

CREATE TRIGGER rsvps_set_updated_at BEFORE UPDATE ON public.rsvps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Player results per night
CREATE TABLE public.player_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  night_id UUID NOT NULL REFERENCES public.poker_nights(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  player_name TEXT NOT NULL,
  buy_in NUMERIC(10,2) NOT NULL DEFAULT 0,
  rebuys NUMERIC(10,2) NOT NULL DEFAULT 0,
  cash_out NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_result NUMERIC(10,2) GENERATED ALWAYS AS (cash_out - (buy_in + rebuys)) STORED,
  final_rank INT,
  award TEXT, -- e.g. 'bad_beat','bluff_king','unluckiest','biggest_donator','comeback_king'
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_results TO authenticated;
GRANT ALL ON public.player_results TO service_role;
ALTER TABLE public.player_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can view results"
  ON public.player_results FOR SELECT TO authenticated USING (true);
CREATE POLICY "Host can manage results"
  ON public.player_results FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.poker_nights n WHERE n.id = night_id AND n.host_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.poker_nights n WHERE n.id = night_id AND n.host_id = auth.uid()));

CREATE INDEX idx_pr_night ON public.player_results(night_id);
CREATE INDEX idx_pr_user ON public.player_results(user_id);
CREATE INDEX idx_inv_night ON public.invitations(night_id);
CREATE INDEX idx_rsvp_night ON public.rsvps(night_id);
CREATE INDEX idx_nights_starts ON public.poker_nights(starts_at);
