CREATE TABLE public.night_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  night_id uuid NOT NULL REFERENCES public.poker_nights(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.night_photos TO authenticated;
GRANT ALL ON public.night_photos TO service_role;
ALTER TABLE public.night_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Night viewers can read photos" ON public.night_photos
  FOR SELECT TO authenticated USING (public.can_view_night(night_id));
CREATE POLICY "Night admins can manage photos" ON public.night_photos
  FOR ALL TO authenticated USING (public.is_night_admin(night_id)) WITH CHECK (public.is_night_admin(night_id));

ALTER TABLE public.night_tv_sessions ADD COLUMN IF NOT EXISTS active_photo jsonb;

CREATE OR REPLACE FUNCTION public.can_access_night_photo_path(path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_view_night((string_to_array(path, '/'))[1]::uuid)
  WHERE path LIKE '%/%'
$$;

CREATE OR REPLACE FUNCTION public.is_night_admin_for_photo_path(path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_night_admin((string_to_array(path, '/'))[1]::uuid)
  WHERE path LIKE '%/%'
$$;

CREATE POLICY "Night viewers can read photo files" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'night-photos' AND public.can_access_night_photo_path(name));
CREATE POLICY "Night admins can upload photo files" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'night-photos' AND public.is_night_admin_for_photo_path(name));
CREATE POLICY "Night admins can delete photo files" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'night-photos' AND public.is_night_admin_for_photo_path(name));