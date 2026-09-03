import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, notAuthenticated, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "list_poker_nights",
  title: "List poker nights",
  description: "List poker nights (cash games and tournaments) visible to the signed-in user, newest first.",
  inputSchema: {
    status: z.enum(["all", "upcoming", "completed"]).default("all").describe("Filter by night status."),
    limit: z.number().int().min(1).max(50).default(10).describe("Maximum number of nights to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("poker_nights")
      .select("id,title,format,status,starts_at,location,buy_in,rebuy_amount,currency,tournament_status")
      .order("starts_at", { ascending: false })
      .limit(limit);
    if (status === "upcoming") q = q.neq("status", "completed").gte("starts_at", new Date().toISOString());
    if (status === "completed") q = q.eq("status", "completed");
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return textResult(JSON.stringify(data ?? [], null, 2), { nights: data ?? [] });
  },
});
