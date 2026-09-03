import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, notAuthenticated, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "get_leaderboard",
  title: "Get leaderboard",
  description: "Rank all players by lifetime net profit across completed poker nights.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(20).describe("How many players to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("player_results")
      .select("player_name,user_id,buy_in,cash_out,net_result");
    if (error) return errorResult(error.message);
    const agg = new Map<string, { player_name: string; user_id: string | null; games: number; net: number }>();
    for (const r of data ?? []) {
      const key = r.user_id ?? `walkin:${r.player_name}`;
      const net = Number(r.net_result ?? Number(r.cash_out ?? 0) - Number(r.buy_in ?? 0));
      const cur = agg.get(key) ?? { player_name: r.player_name, user_id: r.user_id, games: 0, net: 0 };
      cur.games += 1;
      cur.net += net;
      agg.set(key, cur);
    }
    const board = [...agg.values()]
      .sort((a, b) => b.net - a.net)
      .slice(0, limit)
      .map((p, i) => ({ rank: i + 1, ...p }));
    return textResult(JSON.stringify(board, null, 2), { leaderboard: board });
  },
});
