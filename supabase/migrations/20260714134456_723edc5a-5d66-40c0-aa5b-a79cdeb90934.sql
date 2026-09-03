DROP POLICY IF EXISTS "Host or rebuy manager manages player_results" ON public.player_results;
CREATE POLICY "Host, rebuy manager or admin manages player_results"
  ON public.player_results FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.poker_nights n WHERE n.id = night_id AND (n.host_id = auth.uid() OR n.rebuy_manager_id = auth.uid()))
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.poker_nights n WHERE n.id = night_id AND (n.host_id = auth.uid() OR n.rebuy_manager_id = auth.uid()))
    OR public.has_role(auth.uid(), 'admin')
  );