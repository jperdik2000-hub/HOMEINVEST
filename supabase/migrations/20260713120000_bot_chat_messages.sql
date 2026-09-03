-- Allow bot-authored chat messages in table_messages.
ALTER TABLE public.table_messages
  DROP CONSTRAINT IF EXISTS table_messages_user_id_fkey;

ALTER TABLE public.table_messages
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.table_messages
  ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_name text;

-- Recreate the human insert policy so it still requires auth.uid() = user_id
-- for real users. Bot inserts go through the service role and bypass RLS.
DROP POLICY IF EXISTS "Players and invitees can send table messages" ON public.table_messages;
CREATE POLICY "Players and invitees can send table messages"
  ON public.table_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_view_poker_table(table_id)
    AND is_bot = false
    AND auth.uid() = user_id
  );
