CREATE OR REPLACE FUNCTION public.debug_wcheck() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_err text; v_sqlstate text;
BEGIN
  BEGIN
    INSERT INTO public.poker_nights(host_id, title, starts_at, buy_in, currency)
      VALUES (v_uid, 'debug', now(), 0, 'EUR');
    DELETE FROM public.poker_nights WHERE title='debug' AND host_id=v_uid;
    v_err := 'NONE';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM; v_sqlstate := SQLSTATE;
  END;
  RETURN jsonb_build_object('uid', v_uid, 'err', v_err, 'sqlstate', v_sqlstate);
END $$;