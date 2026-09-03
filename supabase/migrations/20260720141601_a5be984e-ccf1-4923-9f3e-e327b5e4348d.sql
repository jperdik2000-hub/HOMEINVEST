
-- =========== direct_chats ===========
CREATE TABLE public.direct_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_high uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direct_chats_pair_ordered CHECK (user_low < user_high),
  CONSTRAINT direct_chats_pair_unique UNIQUE (user_low, user_high)
);

GRANT SELECT, INSERT, UPDATE ON public.direct_chats TO authenticated;
GRANT ALL ON public.direct_chats TO service_role;

ALTER TABLE public.direct_chats ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_direct_chat_participant(_chat uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.direct_chats c
    WHERE c.id = _chat AND (c.user_low = auth.uid() OR c.user_high = auth.uid())
  );
$$;

CREATE POLICY "Participants or admin can view direct chats"
  ON public.direct_chats FOR SELECT
  TO authenticated
  USING (user_low = auth.uid() OR user_high = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can insert a direct chat they belong to"
  ON public.direct_chats FOR INSERT
  TO authenticated
  WITH CHECK (user_low = auth.uid() OR user_high = auth.uid());

-- =========== direct_messages ===========
CREATE TABLE public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.direct_chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','image','gif')),
  body text,
  reply_to_id uuid REFERENCES public.direct_messages(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX direct_messages_chat_created_idx
  ON public.direct_messages (chat_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.direct_messages TO authenticated;
GRANT ALL ON public.direct_messages TO service_role;

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants or admin can view direct messages"
  ON public.direct_messages FOR SELECT
  TO authenticated
  USING (public.is_direct_chat_participant(chat_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Participants can send direct messages as themselves"
  ON public.direct_messages FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.is_direct_chat_participant(chat_id));

CREATE POLICY "Sender or admin can update their direct message"
  ON public.direct_messages FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (sender_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Bump direct_chats.updated_at on new messages
CREATE OR REPLACE FUNCTION public.bump_direct_chat_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.direct_chats SET updated_at = now() WHERE id = NEW.chat_id;
  RETURN NEW;
END; $$;

CREATE TRIGGER direct_messages_bump_chat
AFTER INSERT ON public.direct_messages
FOR EACH ROW EXECUTE FUNCTION public.bump_direct_chat_updated_at();

-- =========== direct_chat_reads ===========
CREATE TABLE public.direct_chat_reads (
  chat_id uuid NOT NULL REFERENCES public.direct_chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_message_id uuid,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.direct_chat_reads TO authenticated;
GRANT ALL ON public.direct_chat_reads TO service_role;

ALTER TABLE public.direct_chat_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own read pointer only"
  ON public.direct_chat_reads FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.is_direct_chat_participant(chat_id));

-- =========== direct_chat_mutes ===========
CREATE TABLE public.direct_chat_mutes (
  chat_id uuid NOT NULL REFERENCES public.direct_chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

GRANT SELECT, INSERT, DELETE ON public.direct_chat_mutes TO authenticated;
GRANT ALL ON public.direct_chat_mutes TO service_role;

ALTER TABLE public.direct_chat_mutes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own mute row only"
  ON public.direct_chat_mutes FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.is_direct_chat_participant(chat_id));

-- =========== get_or_create_direct_chat helper ===========
CREATE OR REPLACE FUNCTION public.get_or_create_direct_chat(_other uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _low uuid;
  _high uuid;
  _id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _other IS NULL OR _other = _me THEN RAISE EXCEPTION 'Invalid recipient'; END IF;

  IF _me < _other THEN _low := _me; _high := _other;
  ELSE _low := _other; _high := _me; END IF;

  SELECT id INTO _id FROM public.direct_chats WHERE user_low = _low AND user_high = _high;
  IF _id IS NOT NULL THEN RETURN _id; END IF;

  INSERT INTO public.direct_chats(user_low, user_high) VALUES (_low, _high)
  ON CONFLICT (user_low, user_high) DO UPDATE SET updated_at = direct_chats.updated_at
  RETURNING id INTO _id;

  RETURN _id;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_or_create_direct_chat(uuid) TO authenticated;
