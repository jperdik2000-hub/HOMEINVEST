
CREATE TABLE public.poker_table_rigs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  host_id uuid NOT NULL,
  target_user_ids uuid[] NOT NULL DEFAULT '{}',
  variant text,
  armed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.poker_table_rigs TO authenticated;
GRANT ALL ON public.poker_table_rigs TO service_role;

ALTER TABLE public.poker_table_rigs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Host can manage their table rig"
  ON public.poker_table_rigs
  FOR ALL
  USING (
    auth.uid() = host_id
    AND EXISTS (SELECT 1 FROM public.poker_tables t WHERE t.id = table_id AND t.host_id = auth.uid())
  )
  WITH CHECK (
    auth.uid() = host_id
    AND EXISTS (SELECT 1 FROM public.poker_tables t WHERE t.id = table_id AND t.host_id = auth.uid())
  );
