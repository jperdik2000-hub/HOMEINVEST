
-- Helper: current user's email
CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT email FROM auth.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.can_view_night(_night uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    EXISTS(SELECT 1 FROM public.poker_nights n WHERE n.id = _night AND (n.host_id = auth.uid() OR n.rebuy_manager_id = auth.uid()))
    OR EXISTS(SELECT 1 FROM public.rsvps r WHERE r.night_id = _night AND r.user_id = auth.uid())
    OR EXISTS(SELECT 1 FROM public.player_results pr WHERE pr.night_id = _night AND pr.user_id = auth.uid())
    OR EXISTS(
      SELECT 1 FROM public.invitations i
      WHERE i.night_id = _night
        AND (i.invited_user_id = auth.uid() OR i.invited_email = public.current_user_email())
    );
$$;

CREATE OR REPLACE FUNCTION public.shares_night_with(_other uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me_nights AS (
    SELECT id FROM public.poker_nights WHERE host_id = auth.uid() OR rebuy_manager_id = auth.uid()
    UNION SELECT night_id FROM public.rsvps WHERE user_id = auth.uid()
    UNION SELECT night_id FROM public.player_results WHERE user_id = auth.uid()
    UNION SELECT night_id FROM public.invitations WHERE invited_user_id = auth.uid() OR invited_email = public.current_user_email()
  ),
  other_nights AS (
    SELECT id FROM public.poker_nights WHERE host_id = _other OR rebuy_manager_id = _other
    UNION SELECT night_id FROM public.rsvps WHERE user_id = _other
    UNION SELECT night_id FROM public.player_results WHERE user_id = _other
    UNION SELECT night_id FROM public.invitations WHERE invited_user_id = _other
  )
  SELECT EXISTS(SELECT 1 FROM me_nights m JOIN other_nights o ON m.id = o.id);
$$;

GRANT EXECUTE ON FUNCTION public.current_user_email() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_night(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_night_with(uuid) TO authenticated;

-- Lock down internal SECURITY DEFINER helpers so end users can't call them
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM PUBLIC, anon, authenticated;

-- Fix mutable search_path on the queue helpers that were missing SET search_path
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public;

-- Tighten SELECT policies
DROP POLICY IF EXISTS "Any signed-in user can view nights" ON public.poker_nights;
CREATE POLICY "Participants can view nights" ON public.poker_nights
  FOR SELECT TO authenticated USING (public.can_view_night(id));

DROP POLICY IF EXISTS "Signed-in users can view invitations" ON public.invitations;
CREATE POLICY "Host and invited user can view invitations" ON public.invitations
  FOR SELECT TO authenticated USING (
    invited_user_id = auth.uid()
    OR invited_email = public.current_user_email()
    OR EXISTS (SELECT 1 FROM public.poker_nights n WHERE n.id = invitations.night_id AND n.host_id = auth.uid())
  );

DROP POLICY IF EXISTS "Signed-in users can view rsvps" ON public.rsvps;
CREATE POLICY "Participants can view rsvps" ON public.rsvps
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.can_view_night(night_id)
  );

DROP POLICY IF EXISTS "Signed-in users can view results" ON public.player_results;
CREATE POLICY "Participants can view results" ON public.player_results
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.can_view_night(night_id)
  );

DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
CREATE POLICY "View self and co-participant profiles" ON public.profiles
  FOR SELECT TO authenticated USING (
    id = auth.uid() OR public.shares_night_with(id)
  );
