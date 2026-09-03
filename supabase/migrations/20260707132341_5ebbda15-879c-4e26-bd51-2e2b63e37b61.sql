CREATE OR REPLACE FUNCTION public.debug_insert_night() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_uid uuid; v_id uuid; v_check boolean; v_uid2 uuid;
BEGIN
  v_uid := auth.uid();
  v_check := (auth.uid() = v_uid);
  v_uid2 := auth.uid();
  BEGIN
    INSERT INTO public.poker_nights(host_id, title, starts_at, buy_in, currency)
      VALUES (v_uid, 'debug', now(), 0, 'EUR') RETURNING id INTO v_id;
    DELETE FROM public.poker_nights WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'uid', v_uid, 'uid2', v_uid2, 'check', v_check);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'uid', v_uid, 'uid2', v_uid2, 'check', v_check, 'sqlstate', SQLSTATE, 'err', SQLERRM);
  END;
END $$;