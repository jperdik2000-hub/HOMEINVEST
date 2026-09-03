import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin-only: wipe all casino data (poker + blackjack tables/hands/wallets/
 * settlements/chat) and reset every player's chip and locked balances to 0.
 * Does NOT touch the poker club (poker_nights, rsvps, invitations, results, profiles).
 */
export const resetCasino = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase
      .rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Admin only");
    const { error } = await (context.supabase as any).rpc("admin_reset_casino");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
