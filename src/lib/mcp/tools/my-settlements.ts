import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, notAuthenticated, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "get_my_settlements",
  title: "Get my settlements",
  description: "List money the signed-in user owes or is owed from poker sessions, with status.",
  inputSchema: {
    only_open: z.boolean().default(true).describe("When true, exclude fully settled debts."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ only_open }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    const me = ctx.getUserId()!;
    let q = supabase
      .from("settlements")
      .select("id,session_name,amount,status,creditor_id,debtor_id,marked_paid_at,confirmed_received_at,created_at")
      .or(`creditor_id.eq.${me},debtor_id.eq.${me}`)
      .order("created_at", { ascending: false });
    if (only_open) q = q.not("status", "in", "(payment_confirmed,fully_withdrawn,cancelled)");
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    const ids = [...new Set((data ?? []).flatMap((s) => [s.creditor_id, s.debtor_id]))];
    const { data: profiles } = ids.length
      ? await supabase.from("profiles").select("id,name,nickname").in("id", ids)
      : { data: [] as Array<{ id: string; name: string | null; nickname: string | null }> };
    const nameOf = (id: string) => {
      const p = profiles?.find((x) => x.id === id);
      return p?.nickname || p?.name || (id === me ? "You" : "Player");
    };
    const items = (data ?? []).map((s) => ({
      id: s.id,
      session: s.session_name,
      amount: Number(s.amount),
      status: s.status,
      direction: s.creditor_id === me ? "owed_to_me" : "i_owe",
      counterparty: nameOf(s.creditor_id === me ? s.debtor_id : s.creditor_id),
      created_at: s.created_at,
    }));
    return textResult(JSON.stringify(items, null, 2), { settlements: items });
  },
});
