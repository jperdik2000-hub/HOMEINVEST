CREATE OR REPLACE FUNCTION public.admin_reset_casino()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  TRUNCATE TABLE
    public.poker_hand_actions,
    public.poker_hand_seats,
    public.poker_hole_cards,
    public.poker_hands,
    public.poker_rebuy_requests,
    public.poker_seats,
    public.poker_table_invitations,
    public.poker_tables,
    public.poker_wallet_transactions,
    public.blackjack_round_seats,
    public.blackjack_rounds,
    public.blackjack_seats,
    public.blackjack_table_invitations,
    public.blackjack_tables,
    public.table_messages,
    public.withdrawal_allocations,
    public.settlement_payments,
    public.settlements
  RESTART IDENTITY CASCADE;

  UPDATE public.poker_wallets SET chips = 0, eligible_to_withdraw = 0;
END;
$function$;