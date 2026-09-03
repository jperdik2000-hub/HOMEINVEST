CREATE TABLE public.table_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.table_messages TO authenticated;
GRANT ALL ON public.table_messages TO service_role;

ALTER TABLE public.table_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players and invitees can read table messages"
  ON public.table_messages
  FOR SELECT
  TO authenticated
  USING (public.can_view_poker_table(table_id));

CREATE POLICY "Players and invitees can send table messages"
  ON public.table_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_view_poker_table(table_id)
    AND auth.uid() = user_id
  );

CREATE POLICY "Authors can delete their own messages"
  ON public.table_messages
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.table_messages;