import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, notAuthenticated, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "get_night_results",
  title: "Get night results",
  description: "Get the player results (buy-ins, rebuys, cash-outs, net, rank, awards) for one poker night, plus RSVPs.",
  inputSchema: {
    night_id: z.string().uuid().describe("The poker night id (from list_poker_nights)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ night_id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    const [night, results, rsvps] = await Promise.all([
      supabase
        .from("poker_nights")
        .select("id,title,format,status,starts_at,location,buy_in,rebuy_amount,currency,notes")
        .eq("id", night_id)
        .maybeSingle(),
      supabase
        .from("player_results")
        .select("player_name,user_id,buy_in,rebuys,cash_out,net_result,final_rank,award")
        .eq("night_id", night_id)
        .order("net_result", { ascending: false }),
      supabase.from("rsvps").select("name,email,status").eq("night_id", night_id),
    ]);
    if (night.error) return errorResult(night.error.message);
    if (!night.data) return errorResult("Night not found or not accessible.");
    if (results.error) return errorResult(results.error.message);
    const payload = { night: night.data, results: results.data ?? [], rsvps: rsvps.data ?? [] };
    return textResult(JSON.stringify(payload, null, 2), payload);
  },
});
