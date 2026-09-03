
-- =========== direct_message_reactions ===========
CREATE TABLE public.direct_message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.direct_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);
CREATE INDEX direct_message_reactions_msg_idx ON public.direct_message_reactions (message_id);

GRANT SELECT, INSERT, DELETE ON public.direct_message_reactions TO authenticated;
GRANT ALL ON public.direct_message_reactions TO service_role;

ALTER TABLE public.direct_message_reactions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_direct_message_participant(_msg uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.direct_messages m
    JOIN public.direct_chats c ON c.id = m.chat_id
    WHERE m.id = _msg AND (c.user_low = auth.uid() OR c.user_high = auth.uid())
  );
$$;

CREATE POLICY "Participants or admin can view direct reactions"
  ON public.direct_message_reactions FOR SELECT
  TO authenticated
  USING (public.is_direct_message_participant(message_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Participants can add own direct reactions"
  ON public.direct_message_reactions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_direct_message_participant(message_id));

CREATE POLICY "Participants can remove own direct reactions"
  ON public.direct_message_reactions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- =========== direct_message_pins ===========
CREATE TABLE public.direct_message_pins (
  chat_id uuid NOT NULL REFERENCES public.direct_chats(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.direct_messages(id) ON DELETE CASCADE,
  pinned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, message_id)
);

GRANT SELECT, INSERT, DELETE ON public.direct_message_pins TO authenticated;
GRANT ALL ON public.direct_message_pins TO service_role;

ALTER TABLE public.direct_message_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants or admin can view direct pins"
  ON public.direct_message_pins FOR SELECT
  TO authenticated
  USING (public.is_direct_chat_participant(chat_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Participants can pin in their direct chat"
  ON public.direct_message_pins FOR INSERT
  TO authenticated
  WITH CHECK (public.is_direct_chat_participant(chat_id));

CREATE POLICY "Participants can unpin in their direct chat"
  ON public.direct_message_pins FOR DELETE
  TO authenticated
  USING (public.is_direct_chat_participant(chat_id));

-- =========== realtime publication ===========
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_message_reactions;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_message_pins;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
