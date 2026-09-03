
CREATE POLICY "Admins can delete invitations"
ON public.invitations FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete rsvps"
ON public.rsvps FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
