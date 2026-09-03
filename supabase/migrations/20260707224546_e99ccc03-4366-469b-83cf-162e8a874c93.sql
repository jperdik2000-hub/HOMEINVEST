DROP POLICY IF EXISTS "View self and co-participant profiles" ON public.profiles;
CREATE POLICY "Authenticated can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);