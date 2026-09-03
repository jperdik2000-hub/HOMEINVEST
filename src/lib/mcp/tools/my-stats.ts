import { defineTool } from "@lovable.dev/mcp-js";
import { errorResult, notAuthenticated, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "get_my_stats",
  title: "Get my stats",
  description: "Summarize the signed-in player's lifetime poker club stats: games played, total buy-in, total cash-out, net profit, win rate, best and worst night.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId();
    const { data, error } = await supabase
      .from("player_results")
      .select("night_id,buy_in,rebuys,cash_out,net_result,final_rank,award,created_at")
      .eq("user_id", userId!)
      .order("created_at", { ascending: true });
    if (error) return errorResult(error.message);
    const rows = data ?? [];
    const games = rows.length;
    const totalBuyIn = rows.reduce((s, r) => s + Number(r.buy_in ?? 0), 0);
    const totalCashOut = rows.reduce((s, r) => s + Number(r.cash_out ?? 0), 0);
    const nets = rows.map((r) => Number(r.net_result ?? Number(r.cash_out ?? 0) - Number(r.buy_in ?? 0)));
    const net = nets.reduce((s, n) => s + n, 0);
    const wins = nets.filter((n) => n > 0).length;
    const stats = {
      games,
      total_buy_in: totalBuyIn,
      total_cash_out: totalCashOut,
      net_profit: net,
      win_rate: games ? Math.round((wins / games) * 1000) / 10 : 0,
      best_night: games ? Math.max(...nets) : 0,
      worst_night: games ? Math.min(...nets) : 0,
      total_rebuys: rows.reduce((s, r) => s + Number(r.rebuys ?? 0), 0),
      awards: rows.map((r) => r.award).filter(Boolean),
    };
    return textResult(JSON.stringify(stats, null, 2), stats);
  },
});
