DROP POLICY IF EXISTS "Participants can view nights" ON public.poker_nights;
CREATE POLICY "Participants can view nights" ON public.poker_nights
  FOR SELECT TO authenticated
  USING (
    host_id = auth.uid()
    OR rebuy_manager_id = auth.uid()
    OR public.can_view_night(id)
  );

DROP FUNCTION IF EXISTS public.whoami();
DROP FUNCTION IF EXISTS public.debug_insert_night();
DROP FUNCTION IF EXISTS public.debug_wcheck();