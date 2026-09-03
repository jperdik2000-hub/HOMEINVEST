
REVOKE EXECUTE ON FUNCTION public.current_user_email() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_night(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.shares_night_with(uuid) FROM PUBLIC, anon;
-- Also lock handle_new_user (trigger function, not meant to be called directly)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
