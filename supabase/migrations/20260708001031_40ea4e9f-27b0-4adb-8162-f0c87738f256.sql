CREATE OR REPLACE FUNCTION public.notify_admins_rsvp_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR (TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.user_id IS DISTINCT FROM NEW.user_id)) THEN
    BEGIN
      PERFORM net.http_post(
        url := 'https://project--3360c40a-5423-4c35-af91-84bdd04fc577.lovable.app/api/public/hooks/rsvp',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
          )
        ),
        body := jsonb_build_object(
          'night_id', NEW.night_id,
          'user_id', NEW.user_id,
          'status', NEW.status
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_admins_rsvp_webhook failed: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_rsvp_notify_admins ON public.rsvps;
CREATE TRIGGER on_rsvp_notify_admins
AFTER INSERT OR UPDATE OF status, user_id ON public.rsvps
FOR EACH ROW EXECUTE FUNCTION public.notify_admins_rsvp_webhook();