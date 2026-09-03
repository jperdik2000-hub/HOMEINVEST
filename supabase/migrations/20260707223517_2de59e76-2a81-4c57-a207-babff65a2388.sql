
CREATE OR REPLACE FUNCTION public.notify_admins_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://project--3360c40a-5423-4c35-af91-84bdd04fc577.lovable.app/api/public/hooks/new-user',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
        )
      ),
      body := jsonb_build_object(
        'user_id', NEW.id,
        'name', NEW.name,
        'email', NEW.email
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_admins_new_user failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_notify_admins ON public.profiles;
CREATE TRIGGER on_profile_created_notify_admins
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.notify_admins_new_user();
