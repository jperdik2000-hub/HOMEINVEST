import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const TableIdSchema = z.object({ table_id: z.string().uuid() });

/**
 * Debit a player's wallet by `amount` and log a buy_in transaction. Throws
 * when the wallet doesn't exist or has insufficient chips. Skipped by callers
 * for bot seats (bots don't have wallets).
 */
async function debitWalletForRebuy(
  admin: any,
  user_id: string,
  table_id: string,
  amount: number,
) {
  const { data: w } = await admin
    .from("poker_wallets").select("chips").eq("user_id", user_id).maybeSingle();
  const chips = Number(w?.chips ?? 0);
  if (chips < amount) {
    throw new Error(`Not enough chips in wallet (${chips}). Need ${amount}.`);
  }
  const next = chips - amount;
  const { error: wErr } = await admin
    .from("poker_wallets").update({ chips: next }).eq("user_id", user_id);
  if (wErr) throw new Error(wErr.message);
  await admin.from("poker_wallet_transactions").insert({
    user_id, kind: "buy_in", amount: -amount, balance_after: next,
    table_id, note: "Table rebuy",
  });
}

/** Player (or host on own seat) asks for a rebuy. If host requests, it is auto-approved. */
export const requestRebuy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ table_id: z.string().uuid(), amount: z.coerce.number().positive().max(1_000_000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin
      .from("poker_tables").select("id,host_id,status").eq("id", data.table_id).maybeSingle();
    if (!table) throw new Error("Table not found");
    if (table.status === "ended") throw new Error("Table has ended");
    const { data: seat } = await supabaseAdmin
      .from("poker_seats").select("id,user_id,status,stack,total_buy_in")
      .eq("table_id", data.table_id).eq("user_id", context.userId).maybeSingle();
    if (!seat || seat.status === "left") throw new Error("You are not seated at this table");

    const isHost = table.host_id === context.userId;
    if (isHost) {
      // Auto-approve: debit host wallet, then add to stack + total_buy_in.
      await debitWalletForRebuy(supabaseAdmin, context.userId, data.table_id, data.amount);
      await supabaseAdmin.from("poker_seats").update({
        stack: Number(seat.stack) + data.amount,
        total_buy_in: Number((seat as any).total_buy_in ?? 0) + data.amount,
      }).eq("id", seat.id);
      await supabaseAdmin.from("poker_rebuy_requests").insert({
        table_id: data.table_id, user_id: context.userId, amount: data.amount,
        status: "approved", decided_at: new Date().toISOString(), decided_by: context.userId,
      });
      return { ok: true, auto_approved: true };
    }

    // Cancel any existing pending request from this user for this table
    await supabaseAdmin.from("poker_rebuy_requests")
      .update({ status: "denied", decided_at: new Date().toISOString(), decided_by: context.userId })
      .eq("table_id", data.table_id).eq("user_id", context.userId).eq("status", "pending");

    // Sanity-check the player has enough wallet chips before creating the
    // request. The actual debit happens when the host approves.
    const { data: w } = await supabaseAdmin
      .from("poker_wallets").select("chips").eq("user_id", context.userId).maybeSingle();
    if (Number(w?.chips ?? 0) < data.amount) {
      throw new Error(`Not enough chips in wallet (${Number(w?.chips ?? 0)}). Need ${data.amount}.`);
    }

    const { error } = await supabaseAdmin.from("poker_rebuy_requests").insert({
      table_id: data.table_id, user_id: context.userId, amount: data.amount, status: "pending",
    });
    if (error) throw new Error(error.message);
    return { ok: true, auto_approved: false };
  });

/** Host approves a pending rebuy: credits stack + total_buy_in for that seat. */
export const approveRebuy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ request_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req } = await supabaseAdmin
      .from("poker_rebuy_requests").select("id,table_id,user_id,amount,status")
      .eq("id", data.request_id).maybeSingle();
    if (!req) throw new Error("Request not found");
    if (req.status !== "pending") throw new Error("Request already decided");
    const { data: table } = await supabaseAdmin
      .from("poker_tables").select("host_id,status").eq("id", req.table_id).maybeSingle();
    if (!table) throw new Error("Table not found");
    if (table.host_id !== context.userId) throw new Error("Only the host can approve");
    if (table.status === "ended") throw new Error("Table has ended");
    const { data: seat } = await supabaseAdmin
      .from("poker_seats").select("id,stack,total_buy_in,status")
      .eq("table_id", req.table_id).eq("user_id", req.user_id).maybeSingle();
    if (!seat || seat.status === "left") throw new Error("Player is not seated");
    // Debit the player's wallet at approval time.
    await debitWalletForRebuy(supabaseAdmin, req.user_id, req.table_id, Number(req.amount));
    await supabaseAdmin.from("poker_seats").update({
      stack: Number(seat.stack) + Number(req.amount),
      total_buy_in: Number((seat as any).total_buy_in ?? 0) + Number(req.amount),
    }).eq("id", seat.id);
    await supabaseAdmin.from("poker_rebuy_requests").update({
      status: "approved", decided_at: new Date().toISOString(), decided_by: context.userId,
    }).eq("id", req.id);
    return { ok: true };
  });

export const denyRebuy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ request_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req } = await supabaseAdmin
      .from("poker_rebuy_requests").select("id,table_id,status").eq("id", data.request_id).maybeSingle();
    if (!req) throw new Error("Request not found");
    if (req.status !== "pending") throw new Error("Request already decided");
    const { data: table } = await supabaseAdmin
      .from("poker_tables").select("host_id").eq("id", req.table_id).maybeSingle();
    if (!table || table.host_id !== context.userId) throw new Error("Only the host can deny");
    await supabaseAdmin.from("poker_rebuy_requests").update({
      status: "denied", decided_at: new Date().toISOString(), decided_by: context.userId,
    }).eq("id", req.id);
    return { ok: true };
  });

/** Host adds a rebuy directly for any seated player (including bots). */
export const hostAddRebuy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      table_id: z.string().uuid(),
      seat_index: z.number().int().min(0).max(8),
      amount: z.coerce.number().positive().max(1_000_000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin
      .from("poker_tables").select("id,host_id,status").eq("id", data.table_id).maybeSingle();
    if (!table) throw new Error("Table not found");
    if (table.host_id !== context.userId) throw new Error("Only the host can add rebuys");
    if (table.status === "ended") throw new Error("Table has ended");
    const { data: seat } = await supabaseAdmin
      .from("poker_seats").select("id,user_id,stack,total_buy_in,status")
      .eq("table_id", data.table_id).eq("seat_index", data.seat_index).maybeSingle();
    if (!seat || seat.status === "left") throw new Error("Seat is empty");
    await debitWalletForRebuy(supabaseAdmin, seat.user_id, data.table_id, data.amount);
    await supabaseAdmin.from("poker_seats").update({
      stack: Number(seat.stack) + data.amount,
      total_buy_in: Number((seat as any).total_buy_in ?? 0) + data.amount,
    }).eq("id", seat.id);
    await supabaseAdmin.from("poker_rebuy_requests").insert({
      table_id: data.table_id, user_id: seat.user_id, amount: data.amount,
      status: "approved", decided_at: new Date().toISOString(), decided_by: context.userId,
    });
    return { ok: true };
  });

/** List rebuy requests for a table (host sees all; players see own). */
export const listRebuyRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TableIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin
      .from("poker_tables").select("host_id").eq("id", data.table_id).maybeSingle();
    if (!table) return [];
    const isHost = table.host_id === context.userId;
    let q = supabaseAdmin.from("poker_rebuy_requests")
      .select("id,table_id,user_id,amount,status,created_at,decided_at")
      .eq("table_id", data.table_id)
      .order("created_at", { ascending: false });
    if (!isHost) q = q.eq("user_id", context.userId);
    const { data: rows } = await q;
    return rows ?? [];
  });

/** Read a table's settlement (returns null if not ended yet). */
export const getTableSettlement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TableIdSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin
      .from("poker_tables").select("settlement,status").eq("id", data.table_id).maybeSingle();
    return { status: table?.status ?? null, settlement: table?.settlement ?? null };
  });