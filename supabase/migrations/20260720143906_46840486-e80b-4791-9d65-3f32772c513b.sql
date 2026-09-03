CREATE POLICY "Participants can view read pointers"
  ON public.direct_chat_reads FOR SELECT
  TO authenticated
  USING (public.is_direct_chat_participant(chat_id));

ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_chat_reads;