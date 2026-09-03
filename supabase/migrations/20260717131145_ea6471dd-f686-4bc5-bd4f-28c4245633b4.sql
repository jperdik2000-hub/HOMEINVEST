ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS chat_message boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.night_chat_mutes (
  chat_id UUID NOT NULL REFERENCES public.night_chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.night_chat_mutes TO authenticated;
GRANT ALL ON public.night_chat_mutes TO service_role;

ALTER TABLE public.night_chat_mutes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own mute select" ON public.night_chat_mutes FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "own mute insert" ON public.night_chat_mutes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own mute delete" ON public.night_chat_mutes FOR DELETE TO authenticated
  USING (auth.uid() = user_id);