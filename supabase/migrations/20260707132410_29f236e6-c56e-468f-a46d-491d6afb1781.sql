CREATE OR REPLACE FUNCTION public.debug_wcheck() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_err text; v_sqlstate text;
BEGIN
  -- try without RLS force
  BEGIN
    INSERT INTO public.poker_nights(host_id, title, starts_at, buy_in, currency)
      VALUES (v_uid, 'debug', now(), 0, 'EUR') RETURNING id INTO v_id;
    DELETE FROM public.poker_nights WHERE id = v_id;
    v_err := 'NONE';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM; v_sqlstate := SQLSTATE;
  END;
  RETURN jsonb_build_object('uid', v_uid, 'err', v_err, 'sqlstate', v_sqlstate,
    'policies', (SELECT jsonb_agg(jsonb_build_object('n',polname,'roles',polroles::regrole[]::text[],'w',pg_get_expr(polwithcheck,polrelid),'q',pg_get_expr(polqual,polrelid)))
                 FROM pg_policy WHERE polrelid='public.poker_nights'::regclass));
END $$;