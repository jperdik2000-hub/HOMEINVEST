import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Push notification for tournament milestones (knockouts, level changes, breaks,
 * final result). Only night admins may trigger it; RLS on poker_nights is not
 * enough here because we fan out to other users, so we check is_night_admin.
 */
export const notifyTournament = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        nightId: z.string().uuid(),
        title: z.string().min(1).max(120),
        body: z.string().min(1).max(200),
        tag: z.string().max(80).optional(),
        excludeSelf: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_night_admin", { _night: data.nightId });
    if (!isAdmin) throw new Error("Only the host can send tournament updates");

    const { data: entries } = await context.supabase
      .from("tournament_entries")
      .select("user_id")
      .eq("night_id", data.nightId);
    const { data: rsvps } = await context.supabase
      .from("rsvps")
      .select("user_id, status")
      .eq("night_id", data.nightId)
      .eq("status", "attending");

    const ids = new Set<string>();
    for (const row of entries ?? []) if (row.user_id) ids.add(row.user_id as string);
    for (const row of rsvps ?? []) if (row.user_id) ids.add(row.user_id as string);
    if (data.excludeSelf) ids.delete(context.userId);
    if (ids.size === 0) return { sent: 0 };

    const { sendPushToUsers } = await import("./push-send.server");
    return sendPushToUsers(Array.from(ids), "results_posted", {
      title: data.title,
      body: data.body,
      url: `/nights/${data.nightId}`,
      tag: data.tag ?? `tournament-${data.nightId}`,
    });
  });
