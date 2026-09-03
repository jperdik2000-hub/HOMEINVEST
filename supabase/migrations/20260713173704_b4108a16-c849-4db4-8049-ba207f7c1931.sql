
ALTER TABLE public.dice_duels ALTER COLUMN table_id DROP NOT NULL;
ALTER TABLE public.settlements ALTER COLUMN source_table_id DROP NOT NULL;

-- Participants of a duel can always see it, even without a shared dice table.
CREATE POLICY "Participants can view their duels"
  ON public.dice_duels FOR SELECT TO authenticated
  USING (challenger_id = auth.uid() OR opponent_id = auth.uid());
