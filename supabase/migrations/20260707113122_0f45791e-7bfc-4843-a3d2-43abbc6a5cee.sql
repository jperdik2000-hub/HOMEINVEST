ALTER TABLE public.poker_nights ADD COLUMN IF NOT EXISTS rebuy_manager_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "Host manages player_results" ON public.player_results;

CREATE POLICY "Host or rebuy manager manages player_results"
  ON public.player_results FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.poker_nights n WHERE n.id = night_id AND (n.host_id = auth.uid() OR n.rebuy_manager_id = auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.poker_nights n WHERE n.id = night_id AND (n.host_id = auth.uid() OR n.rebuy_manager_id = auth.uid())));