
-- Fix mutable search_path on set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Lock down SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- Remove the overly-permissive anon RSVP write policies; we'll rely on a
-- server function (service role) validated by invitation token for anon RSVPs.
DROP POLICY IF EXISTS "Anon rsvp insert (guarded by token elsewhere)" ON public.rsvps;
DROP POLICY IF EXISTS "Anon rsvp update" ON public.rsvps;
DROP POLICY IF EXISTS "Anon rsvp read" ON public.rsvps;
DROP POLICY IF EXISTS "Anon can view by token (list restricted client-side)" ON public.invitations;
REVOKE SELECT, INSERT, UPDATE ON public.rsvps FROM anon;
REVOKE SELECT ON public.invitations FROM anon;
