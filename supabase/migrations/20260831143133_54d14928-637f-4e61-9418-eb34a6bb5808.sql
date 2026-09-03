CREATE POLICY "Night admins can add rsvps for players"
ON public.rsvps FOR INSERT TO authenticated
WITH CHECK (public.is_night_admin(night_id));

CREATE POLICY "Night admins can update rsvps for players"
ON public.rsvps FOR UPDATE TO authenticated
USING (public.is_night_admin(night_id))
WITH CHECK (public.is_night_admin(night_id));