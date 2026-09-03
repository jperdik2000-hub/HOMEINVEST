
-- =========================================
-- Night chat: tables
-- =========================================
CREATE TABLE public.night_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  night_id UUID NOT NULL UNIQUE REFERENCES public.poker_nights(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.night_chats TO authenticated;
GRANT ALL ON public.night_chats TO service_role;
ALTER TABLE public.night_chats ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.night_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.night_chats(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','image','gif','voice','video','file','poll','system')),
  body TEXT,
  reply_to_id UUID REFERENCES public.night_chat_messages(id) ON DELETE SET NULL,
  system_event TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX idx_ncm_chat_created ON public.night_chat_messages(chat_id, created_at DESC);
CREATE INDEX idx_ncm_sender ON public.night_chat_messages(sender_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.night_chat_messages TO authenticated;
GRANT ALL ON public.night_chat_messages TO service_role;
ALTER TABLE public.night_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.night_chat_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.night_chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);
CREATE INDEX idx_ncr_message ON public.night_chat_reactions(message_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.night_chat_reactions TO authenticated;
GRANT ALL ON public.night_chat_reactions TO service_role;
ALTER TABLE public.night_chat_reactions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.night_chat_reads (
  chat_id UUID NOT NULL REFERENCES public.night_chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_message_id UUID REFERENCES public.night_chat_messages(id) ON DELETE SET NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.night_chat_reads TO authenticated;
GRANT ALL ON public.night_chat_reads TO service_role;
ALTER TABLE public.night_chat_reads ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.night_chat_pins (
  chat_id UUID NOT NULL REFERENCES public.night_chats(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.night_chat_messages(id) ON DELETE CASCADE,
  pinned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, message_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.night_chat_pins TO authenticated;
GRANT ALL ON public.night_chat_pins TO service_role;
ALTER TABLE public.night_chat_pins ENABLE ROW LEVEL SECURITY;

-- =========================================
-- Access helpers
-- =========================================
CREATE OR REPLACE FUNCTION public.can_access_night_chat(_chat UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.can_view_night(c.night_id)
  FROM public.night_chats c WHERE c.id = _chat
$$;

CREATE OR REPLACE FUNCTION public.night_chat_is_open(_chat UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT status = 'open' FROM public.night_chats WHERE id = _chat
$$;

CREATE OR REPLACE FUNCTION public.is_night_admin(_night UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.poker_nights n
    WHERE n.id = _night AND (n.host_id = auth.uid() OR n.rebuy_manager_id = auth.uid())
  ) OR public.has_role(auth.uid(), 'admin')
$$;

CREATE OR REPLACE FUNCTION public.is_night_chat_admin(_chat UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_night_admin(c.night_id) FROM public.night_chats c WHERE c.id = _chat
$$;

-- =========================================
-- RLS policies
-- =========================================
CREATE POLICY "View chat if can view night" ON public.night_chats FOR SELECT TO authenticated
  USING (public.can_view_night(night_id));
CREATE POLICY "Admins update chat" ON public.night_chats FOR UPDATE TO authenticated
  USING (public.is_night_admin(night_id))
  WITH CHECK (public.is_night_admin(night_id));

CREATE POLICY "View messages if in chat" ON public.night_chat_messages FOR SELECT TO authenticated
  USING (public.can_access_night_chat(chat_id));
CREATE POLICY "Send messages if in open chat" ON public.night_chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_night_chat(chat_id)
    AND public.night_chat_is_open(chat_id)
    AND sender_id = auth.uid()
    AND kind <> 'system'
  );
CREATE POLICY "Edit own message" ON public.night_chat_messages FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() AND public.night_chat_is_open(chat_id))
  WITH CHECK (sender_id = auth.uid());
CREATE POLICY "Delete own or as admin" ON public.night_chat_messages FOR DELETE TO authenticated
  USING (
    public.night_chat_is_open(chat_id)
    AND (sender_id = auth.uid() OR public.is_night_chat_admin(chat_id))
  );

CREATE POLICY "View reactions" ON public.night_chat_reactions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.night_chat_messages m WHERE m.id = message_id AND public.can_access_night_chat(m.chat_id)));
CREATE POLICY "Add own reaction if open" ON public.night_chat_reactions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.night_chat_messages m WHERE m.id = message_id AND public.can_access_night_chat(m.chat_id) AND public.night_chat_is_open(m.chat_id))
  );
CREATE POLICY "Remove own reaction" ON public.night_chat_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "View own reads" ON public.night_chat_reads FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Insert own reads" ON public.night_chat_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_access_night_chat(chat_id));
CREATE POLICY "Update own reads" ON public.night_chat_reads FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "View pins" ON public.night_chat_pins FOR SELECT TO authenticated
  USING (public.can_access_night_chat(chat_id));
CREATE POLICY "Admin pins" ON public.night_chat_pins FOR INSERT TO authenticated
  WITH CHECK (public.is_night_chat_admin(chat_id) AND public.night_chat_is_open(chat_id) AND pinned_by = auth.uid());
CREATE POLICY "Admin unpin" ON public.night_chat_pins FOR DELETE TO authenticated
  USING (public.is_night_chat_admin(chat_id) AND public.night_chat_is_open(chat_id));

-- =========================================
-- Updated-at trigger
-- =========================================
CREATE TRIGGER night_chats_set_updated_at BEFORE UPDATE ON public.night_chats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- Auto-create chat per night
-- =========================================
CREATE OR REPLACE FUNCTION public.create_chat_for_new_night()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _chat_id UUID;
BEGIN
  INSERT INTO public.night_chats(night_id) VALUES (NEW.id)
  ON CONFLICT (night_id) DO NOTHING
  RETURNING id INTO _chat_id;

  IF _chat_id IS NULL THEN
    SELECT id INTO _chat_id FROM public.night_chats WHERE night_id = NEW.id;
  END IF;

  INSERT INTO public.night_chat_messages(chat_id, sender_id, kind, system_event, metadata)
  VALUES (_chat_id, NULL, 'system', 'night_created',
          jsonb_build_object('title', NEW.title, 'starts_at', NEW.starts_at, 'location', NEW.location, 'buy_in', NEW.buy_in));
  RETURN NEW;
END; $$;

CREATE TRIGGER after_night_insert_create_chat AFTER INSERT ON public.poker_nights
  FOR EACH ROW EXECUTE FUNCTION public.create_chat_for_new_night();

-- Backfill chats for existing nights
INSERT INTO public.night_chats(night_id)
SELECT id FROM public.poker_nights WHERE id NOT IN (SELECT night_id FROM public.night_chats);

-- =========================================
-- System messages for night updates
-- =========================================
CREATE OR REPLACE FUNCTION public.night_change_to_chat()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _chat_id UUID;
BEGIN
  SELECT id INTO _chat_id FROM public.night_chats WHERE night_id = NEW.id;
  IF _chat_id IS NULL THEN RETURN NEW; END IF;

  IF OLD.starts_at IS DISTINCT FROM NEW.starts_at THEN
    INSERT INTO public.night_chat_messages(chat_id, kind, system_event, metadata)
    VALUES (_chat_id, 'system', 'date_changed', jsonb_build_object('old', OLD.starts_at, 'new', NEW.starts_at));
  END IF;
  IF OLD.location IS DISTINCT FROM NEW.location THEN
    INSERT INTO public.night_chat_messages(chat_id, kind, system_event, metadata)
    VALUES (_chat_id, 'system', 'location_changed', jsonb_build_object('old', OLD.location, 'new', NEW.location));
  END IF;
  IF OLD.buy_in IS DISTINCT FROM NEW.buy_in THEN
    INSERT INTO public.night_chat_messages(chat_id, kind, system_event, metadata)
    VALUES (_chat_id, 'system', 'buy_in_changed', jsonb_build_object('old', OLD.buy_in, 'new', NEW.buy_in));
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('completed','cancelled') THEN
    INSERT INTO public.night_chat_messages(chat_id, kind, system_event, metadata)
    VALUES (_chat_id, 'system',
            CASE WHEN NEW.status = 'completed' THEN 'night_completed' ELSE 'night_cancelled' END,
            jsonb_build_object('status', NEW.status));
    UPDATE public.night_chats SET status = 'closed', closed_at = now() WHERE id = _chat_id AND status = 'open';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER after_night_update_chat_events AFTER UPDATE ON public.poker_nights
  FOR EACH ROW EXECUTE FUNCTION public.night_change_to_chat();

-- =========================================
-- RSVP + invitation system events
-- =========================================
CREATE OR REPLACE FUNCTION public.rsvp_to_chat()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _chat_id UUID; _name TEXT;
BEGIN
  SELECT id INTO _chat_id FROM public.night_chats WHERE night_id = NEW.night_id;
  IF _chat_id IS NULL THEN RETURN NEW; END IF;

  IF (TG_OP = 'INSERT') OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT COALESCE(p.nickname, p.name, NEW.name, split_part(NEW.email,'@',1))
      INTO _name FROM public.profiles p WHERE p.id = NEW.user_id;
    INSERT INTO public.night_chat_messages(chat_id, sender_id, kind, system_event, metadata)
    VALUES (_chat_id, NEW.user_id, 'system', 'rsvp_' || NEW.status,
            jsonb_build_object('name', COALESCE(_name, NEW.name, split_part(NEW.email,'@',1)), 'status', NEW.status));
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER after_rsvp_change_chat AFTER INSERT OR UPDATE OF status ON public.rsvps
  FOR EACH ROW EXECUTE FUNCTION public.rsvp_to_chat();

CREATE OR REPLACE FUNCTION public.invitation_to_chat()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _chat_id UUID; _name TEXT;
BEGIN
  SELECT id INTO _chat_id FROM public.night_chats WHERE night_id = NEW.night_id;
  IF _chat_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(p.nickname, p.name, NEW.invited_name, split_part(NEW.invited_email,'@',1))
    INTO _name FROM public.profiles p WHERE p.id = NEW.invited_user_id;
  INSERT INTO public.night_chat_messages(chat_id, kind, system_event, metadata)
  VALUES (_chat_id, 'system', 'invited',
          jsonb_build_object('name', COALESCE(_name, NEW.invited_name, split_part(NEW.invited_email,'@',1))));
  RETURN NEW;
END; $$;

CREATE TRIGGER after_invitation_insert_chat AFTER INSERT ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.invitation_to_chat();

-- =========================================
-- Realtime publication
-- =========================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.night_chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.night_chat_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.night_chat_reads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.night_chat_pins;
ALTER PUBLICATION supabase_realtime ADD TABLE public.night_chats;
