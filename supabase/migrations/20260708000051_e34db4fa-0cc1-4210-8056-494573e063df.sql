CREATE OR REPLACE FUNCTION public.normalize_invite_notification_body()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _night_id uuid;
  _starts_at timestamptz;
  _location text;
  _tap_suffix text := '';
BEGIN
  IF NEW.event <> 'invite_received' OR NEW.url IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    _night_id := substring(NEW.url from '^/nights/([0-9a-fA-F-]{36})')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;

  IF _night_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT starts_at, location
  INTO _starts_at, _location
  FROM public.poker_nights
  WHERE id = _night_id;

  IF _starts_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.body ~* 'tap to RSVP' THEN
    _tap_suffix := ' — tap to RSVP';
  END IF;

  NEW.body := concat(
    to_char(_starts_at at time zone 'Europe/Athens', 'DD/MM/YYYY HH24:MI'),
    CASE WHEN _location IS NOT NULL AND btrim(_location) <> '' THEN ' · ' || _location ELSE '' END,
    _tap_suffix
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_invite_notification_body_on_notifications ON public.notifications;

CREATE TRIGGER normalize_invite_notification_body_on_notifications
BEFORE INSERT OR UPDATE OF event, body, url ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.normalize_invite_notification_body();

UPDATE public.notifications notif
SET body = concat(
  to_char(n.starts_at at time zone 'Europe/Athens', 'DD/MM/YYYY HH24:MI'),
  CASE WHEN n.location IS NOT NULL AND btrim(n.location) <> '' THEN ' · ' || n.location ELSE '' END,
  CASE WHEN notif.body ~* 'tap to RSVP' THEN ' — tap to RSVP' ELSE '' END
)
FROM public.poker_nights n
WHERE notif.event = 'invite_received'
  AND notif.url = '/nights/' || n.id::text;