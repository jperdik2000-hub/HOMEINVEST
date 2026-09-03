import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LinkInput = z.object({
  walkinName: z.string().trim().min(1).max(120),
  userId: z.string().uuid(),
});

/**
 * Admin-only: reassign every walk-in `player_results` row whose
 * `player_name` matches (case-insensitive) to the given registered user.
 * Future stats then aggregate under that user's profile.
 */
export const linkWalkinToUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => LinkInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Admin only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Ensure the target user exists.
    const { data: prof, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id,name")
      .eq("id", data.userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prof) throw new Error("Target user not found");

    const { data: updated, error } = await supabaseAdmin
      .from("player_results")
      .update({ user_id: data.userId })
      .is("user_id", null)
      .ilike("player_name", data.walkinName.trim())
      .select("id");
    if (error) throw new Error(error.message);

    return { ok: true as const, linkedCount: updated?.length ?? 0, userId: data.userId };
  });