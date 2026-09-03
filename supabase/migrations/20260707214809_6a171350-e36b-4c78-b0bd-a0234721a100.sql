DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN SELECT jobname FROM cron.job WHERE jobname LIKE 'push-reminders%' LOOP
    PERFORM cron.unschedule(rec.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'push-reminders-1min',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--3360c40a-5423-4c35-af91-84bdd04fc577.lovable.app/api/public/hooks/push-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);