import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InviteInput = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
});

export const inviteUserByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InviteInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Admin only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Sends the "invite" auth email via the scaffolded webhook. If the user
    // already exists, Supabase returns an error we surface to the admin.
    const { data: inviteRes, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      data.email,
      { redirectTo: "https://pokerath.com/hub" },
    );
    if (error) throw new Error(error.message);

    return {
      ok: true as const,
      userId: inviteRes.user?.id ?? null,
      email: data.email,
    };
  });