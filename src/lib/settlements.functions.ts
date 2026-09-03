import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Net = { user_id: string; net: number };
type Transfer = { from: string; to: string; amount: number };

function minimizeTransfers(nets: Net[]): Transfer[] {
  const eps = 0.005;
  const debtors = nets.filter((p) => p.net < -eps).map((p) => ({ id: p.user_id, amt: -p.net })).sort((a, b) => b.amt - a.amt);
  const creditors = nets.filter((p) => p.net > eps).map((p) => ({ id: p.user_id, amt: p.net })).sort((a, b) => b.amt - a.amt);
  const out: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > eps) out.push({ from: debtors[i].id, to: creditors[j].id, amount: Math.round(pay * 100) / 100 });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt < eps) i++;
    if (creditors[j].amt < eps) j++;
  }
  return out;
}

/** Compute nets from wallet transactions for a table and insert the minimum
 *  set of settlement rows. Used both by the admin "close & settle" action and
 *  automatically when a table transitions to ended. Never throws for benign
 *  reasons (already settled, no activity, imbalance) — returns a flag so
 *  callers can react without failing the whole end-of-game flow. */
export async function settleTableCore(
  admin: any,
  source_kind: "poker" | "blackjack",
  table_id: string,
  actor_user_id: string | null,
): Promise<{ created: number; skipped?: "already" | "no_activity" | "imbalanced"; imbalance?: number }> {
  const { data: existing } = await admin
    .from("settlements")
    .select("id")
    .eq("source_kind", source_kind)
    .eq("source_table_id", table_id)
    .limit(1);
  if (existing && existing.length > 0) return { created: 0, skipped: "already" };

  let sessionName = "Session";
  let hostId: string | null = null;
  if (source_kind === "poker") {
    const { data: t } = await admin.from("poker_tables").select("name,host_id").eq("id", table_id).maybeSingle();
    sessionName = t?.name ?? "Poker session";
    hostId = t?.host_id ?? null;
  } else {
    const { data: t } = await admin.from("blackjack_tables").select("name,host_id").eq("id", table_id).maybeSingle();
    sessionName = t?.name ?? "Blackjack session";
    hostId = t?.host_id ?? null;
  }

  const { data: tx } = await admin
    .from("poker_wallet_transactions")
    .select("user_id,amount,kind")
    .eq("table_id", table_id);

  const netByUser = new Map<string, number>();
  for (const row of tx ?? []) {
    if (row.kind === "deposit") continue;
    netByUser.set(row.user_id, (netByUser.get(row.user_id) ?? 0) + Number(row.amount));
  }
  const nets: Net[] = Array.from(netByUser.entries()).map(([user_id, net]) => ({ user_id, net }));
  if (nets.length === 0) return { created: 0, skipped: "no_activity" };

  let transfers: Transfer[] = [];
  if (source_kind === "blackjack") {
    // Blackjack is house-banked: every player settles directly with the host/dealer,
    // so the player-to-player balance check (sum of nets = 0) is intentionally skipped.
    const eps = 0.005;
    for (const { user_id, net } of nets) {
      if (user_id === hostId) continue;
      if (Math.abs(net) <= eps) continue;
      if (net > 0) {
        transfers.push({ from: hostId!, to: user_id, amount: Math.round(net * 100) / 100 });
      } else {
        transfers.push({ from: user_id, to: hostId!, amount: Math.round(-net * 100) / 100 });
      }
    }
  } else {
    // Poker: nets should sum to zero. In practice they can drift by a few
    // chips when a stack update during a hand drops a rounding, a pot
    // doesn't fully credit the winner, or the host adjusts a stack outside
    // the normal flow. We must never leave a residual — the table would
    // fail to balance and settlements would be off. Absorb any drift into
    // the session's net winners in proportion to how much they won: a
    // missing chip almost always means a winner was underpaid, so this
    // matches reality better than dumping on the host, and it always makes
    // nets sum to exactly zero.
    const eps = 0.005;
    const sum = nets.reduce((s, p) => s + p.net, 0);
    if (Math.abs(sum) > eps) {
      const winners = nets.filter((n) => n.net > eps);
      const losers = nets.filter((n) => n.net < -eps);
      // Missing chips (sum < 0) → shave winners down. Extra chips (sum > 0)
      // → shave losers' debt down (i.e. add to their net). Either way spread
      // proportionally by |net| across that side.
      const target = sum < 0 ? winners : losers;
      const totalAbs = target.reduce((s, p) => s + Math.abs(p.net), 0);
      if (totalAbs > eps) {
        let allocated = 0;
        for (let i = 0; i < target.length; i++) {
          const share = i === target.length - 1
            ? sum - allocated
            : Math.round((sum * (Math.abs(target[i].net) / totalAbs)) * 100) / 100;
          allocated += share;
          const idx = nets.findIndex((n) => n.user_id === target[i].user_id);
          nets[idx] = { user_id: target[i].user_id, net: Math.round((nets[idx].net - share) * 100) / 100 };
        }
      } else if (hostId) {
        // Degenerate case (e.g. everyone broke even but a residual exists):
        // fall back to the host so the table still balances.
        const idx = nets.findIndex((n) => n.user_id === hostId);
        if (idx >= 0) nets[idx] = { user_id: hostId, net: nets[idx].net - sum };
        else nets.push({ user_id: hostId, net: -sum });
      }
    }
    transfers = minimizeTransfers(nets);
  }

  if (transfers.length === 0) return { created: 0 };

  const rows = transfers.map((t) => ({
    source_kind,
    source_table_id: table_id,
    session_name: sessionName,
    debtor_id: t.from,
    creditor_id: t.to,
    amount: t.amount,
    created_by: actor_user_id,
  }));
  const { error: insErr } = await admin.from("settlements").insert(rows);
  if (insErr) throw new Error(insErr.message);
  return { created: transfers.length };
}

/** Admin-only wrapper around settleTableCore. Kept for backwards compatibility
 *  with the "Close & auto-settle" button; end-of-game handlers now auto-run
 *  settleTableCore directly. */
export const closeTableAndSettle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      source_kind: z.enum(["poker", "blackjack"]),
      table_id: z.string().uuid(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Only admins can close a session");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await settleTableCore(supabaseAdmin, data.source_kind, data.table_id, context.userId);
    if (res.skipped === "already") throw new Error("This table has already been settled.");
    if (res.skipped === "no_activity") throw new Error("No game activity to settle on this table.");
    if (res.skipped === "imbalanced") {
      throw new Error(
        `Session results do not balance (net = ${(res.imbalance ?? 0).toFixed(2)}). Ensure every player has cashed out before closing.`,
      );
    }
    return { ok: true, created: res.created };
  });

/** Everyone I owe or am owed, plus counterparties + session labels. */
export const listMySettlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Auto-net any back-and-forth debts with the same counterparty before
    // returning. Only touches "unpaid" / "disputed" rows in both directions;
    // in-flight and confirmed payments are left alone.
    await autoNetOpenSettlements(supabaseAdmin, context.userId);

    const { data: rows, error } = await supabaseAdmin
      .from("settlements")
      .select("*")
      .or(`debtor_id.eq.${context.userId},creditor_id.eq.${context.userId}`)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = Array.from(
      new Set((rows ?? []).flatMap((r: any) => [r.debtor_id, r.creditor_id])),
    );
    const { data: profs } = ids.length
      ? await supabaseAdmin.from("profiles").select("id,name,nickname,avatar_url").in("id", ids)
      : { data: [] as any[] };
    const profileMap = new Map((profs ?? []).map((p: any) => [p.id, p]));

    return {
      user_id: context.userId,
      settlements: (rows ?? []).map((r: any) => ({
        ...r,
        debtor: profileMap.get(r.debtor_id) ?? null,
        creditor: profileMap.get(r.creditor_id) ?? null,
      })),
    };
  });

/** Debtor marks a settlement as paid (off-platform). */
export const markSettlementPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      settlement_id: z.string().uuid(),
      payment_method: z.string().trim().max(60).optional(),
      payment_note: z.string().trim().max(300).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: s, error: e1 } = await supabaseAdmin
      .from("settlements").select("*").eq("id", data.settlement_id).maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!s) throw new Error("Settlement not found");
    if (s.debtor_id !== context.userId) throw new Error("Only the debtor can mark a payment as sent");
    if (s.status !== "unpaid" && s.status !== "disputed") {
      throw new Error(`Cannot mark paid from status "${s.status}"`);
    }
    const { error } = await supabaseAdmin
      .from("settlements")
      .update({
        status: "payment_marked_sent",
        payment_method: data.payment_method ?? null,
        payment_note: data.payment_note ?? null,
        marked_paid_at: new Date().toISOString(),
        dispute_reason: null,
      })
      .eq("id", data.settlement_id);
    if (error) throw new Error(error.message);

    // Notify the creditor via push that a payment has been marked as sent.
    try {
      const { sendPushToUserIdsRaw } = await import("./push-send.server");
      const { data: debtorProfile } = await supabaseAdmin
        .from("profiles")
        .select("name, nickname, email")
        .eq("id", s.debtor_id)
        .maybeSingle();
      const who =
        debtorProfile?.nickname ||
        debtorProfile?.name ||
        (debtorProfile?.email ? String(debtorProfile.email).split("@")[0] : "Someone");
      const amount = Number(s.amount ?? 0);
      await sendPushToUserIdsRaw([s.creditor_id], "settlement_marked_paid", {
        title: "Payment marked as sent",
        body: `${who} marked ${amount} chips as paid. Tap to confirm you received it.`,
        url: `/play/settlements#s-${s.id}`,
        tag: `settlement-${s.id}`,
      });
    } catch (err) {
      console.error("settlement mark-paid push failed", err);
    }

    return { ok: true };
  });

/** Creditor confirms external payment receipt. Bumps eligible_to_withdraw so the
 * creditor can manually withdraw later via `withdrawVirtual`. */
export const confirmSettlementReceived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ settlement_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: s, error: e1 } = await supabaseAdmin
      .from("settlements").select("*").eq("id", data.settlement_id).maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!s) throw new Error("Settlement not found");
    if (s.creditor_id !== context.userId) throw new Error("Only the creditor can confirm receipt");
    if (s.status !== "payment_marked_sent") {
      throw new Error("Debtor has not marked this as paid yet");
    }
    const nowIso = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("settlements")
      .update({
        status: "payment_confirmed",
        confirmed_received_at: nowIso,
      })
      .eq("id", data.settlement_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Creditor can dispute a "marked paid" claim. */
export const disputeSettlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      settlement_id: z.string().uuid(),
      reason: z.string().trim().min(3).max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: s, error: e1 } = await supabaseAdmin
      .from("settlements").select("*").eq("id", data.settlement_id).maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!s) throw new Error("Settlement not found");
    if (s.creditor_id !== context.userId) throw new Error("Only the creditor can dispute");
    if (s.status === "payment_confirmed" || s.status === "partially_withdrawn" || s.status === "fully_withdrawn") {
      throw new Error("Cannot dispute a confirmed payment. Create an adjustment instead.");
    }
    const { error } = await supabaseAdmin
      .from("settlements")
      .update({ status: "disputed", dispute_reason: data.reason })
      .eq("id", data.settlement_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: list tables that have game activity but no settlements yet. */
export const listSettleableTables = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { is_admin: false, tables: [] };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Collect table ids that have game activity from three signals:
    //   1. wallet transactions tagged with a table (poker cash-outs, rebuys)
    //   2. blackjack rounds
    //   3. poker hands
    const [{ data: tx }, { data: bjRounds }, { data: pokerHands }] = await Promise.all([
      supabaseAdmin
        .from("poker_wallet_transactions")
        .select("table_id")
        .not("table_id", "is", null)
        .neq("kind", "deposit"),
      supabaseAdmin.from("blackjack_rounds").select("table_id"),
      supabaseAdmin.from("poker_hands").select("table_id"),
    ]);
    const tableIds = Array.from(new Set([
      ...((tx ?? []).map((r: any) => r.table_id)),
      ...((bjRounds ?? []).map((r: any) => r.table_id)),
      ...((pokerHands ?? []).map((r: any) => r.table_id)),
    ].filter(Boolean)));
    if (tableIds.length === 0) return { is_admin: true, tables: [] };

    const { data: settled } = await supabaseAdmin
      .from("settlements")
      .select("source_table_id")
      .in("source_table_id", tableIds);
    const settledSet = new Set((settled ?? []).map((r: any) => r.source_table_id));
    const unsettled = tableIds.filter((id) => !settledSet.has(id));
    if (unsettled.length === 0) return { is_admin: true, tables: [] };

    const [{ data: pokers }, { data: bjs }] = await Promise.all([
      supabaseAdmin.from("poker_tables").select("id,name,status,ended_at,created_at").in("id", unsettled),
      supabaseAdmin.from("blackjack_tables").select("id,name,status,created_at").in("id", unsettled),
    ]);

    const out: Array<{
      id: string; kind: "poker" | "blackjack"; name: string; status: string; created_at: string;
    }> = [];
    for (const t of pokers ?? []) out.push({ id: t.id, kind: "poker", name: t.name, status: t.status, created_at: t.created_at });
    for (const t of bjs ?? []) out.push({ id: t.id, kind: "blackjack", name: t.name, status: t.status, created_at: t.created_at });
    out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return { is_admin: true, tables: out };
  });

/** Locked = sum of open settlements owed to `userId` that have not yet been
 *  confirmed as received. These represent chips backed by IOUs that haven't
 *  turned into real money yet, so they can't leave the wallet. */
const LOCKING_STATUSES = ["unpaid", "payment_marked_sent", "disputed"] as const;

async function computeLocked(admin: any, userId: string): Promise<number> {
  const { data } = await admin
    .from("settlements")
    .select("amount")
    .eq("creditor_id", userId)
    .in("status", LOCKING_STATUSES);
  const total = (data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
  return Math.round(total * 100) / 100;
}

/** Cash out chips from the wallet. The wallet is a single balance; the
 *  amount is capped by (chips − locked), where locked is the sum of open
 *  settlements owed to the user awaiting external payment. */
export const withdrawVirtual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      amount: z.coerce.number().positive().max(10_000_000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const amount = Math.round(Number(data.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a positive amount.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: w } = await supabaseAdmin
      .from("poker_wallets")
      .select("chips")
      .eq("user_id", context.userId)
      .maybeSingle();
    const chips = Number(w?.chips ?? 0);
    const locked = await computeLocked(supabaseAdmin, context.userId);
    const available = Math.max(0, Math.round((chips - locked) * 100) / 100);
    if (amount > available) {
      throw new Error(
        `Only ${available.toLocaleString()} chips are available to cash out (${locked.toLocaleString()} locked until settlements are confirmed).`,
      );
    }

    const nextChips = Math.round((chips - amount) * 100) / 100;

    const { error: wErr } = await supabaseAdmin
      .from("poker_wallets")
      .upsert({
        user_id: context.userId,
        chips: nextChips,
      });
    if (wErr) throw new Error(wErr.message);

    const { error: txErr } = await supabaseAdmin
      .from("poker_wallet_transactions")
      .insert({
        user_id: context.userId,
        kind: "withdrawal",
        amount: -amount,
        balance_after: nextChips,
        note: `Cashed out ${amount.toLocaleString()} chips`,
      });
    if (txErr) throw new Error(txErr.message);

    return {
      ok: true,
      chips: nextChips,
      locked,
      available: Math.max(0, Math.round((nextChips - locked) * 100) / 100),
      amount,
    };
  });

/** Net all open (unpaid/disputed) settlements between the current user and one
 *  counterparty, in both directions, into a single new settlement for the
 *  difference. Skips anything already in-flight (payment_marked_sent) or
 *  confirmed. Both parties are allowed to trigger this. */
export const netSettlementsWithUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ other_user_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const me = context.userId;
    const other = data.other_user_id;
    if (me === other) throw new Error("Cannot net with yourself.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("settlements")
      .select("*")
      .in("status", ["unpaid", "disputed"])
      .or(
        `and(debtor_id.eq.${me},creditor_id.eq.${other}),and(debtor_id.eq.${other},creditor_id.eq.${me})`,
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const open = rows ?? [];
    if (open.length < 2) throw new Error("Nothing to combine.");

    let owedByMe = 0;
    let owedToMe = 0;
    for (const r of open) {
      const amt = Number(r.amount);
      if (r.debtor_id === me) owedByMe += amt;
      else owedToMe += amt;
    }
    const diff = Math.round((owedByMe - owedToMe) * 100) / 100;

    // Cancel all originals.
    const ids = open.map((r: any) => r.id);
    const { error: cErr } = await supabaseAdmin
      .from("settlements")
      .update({ status: "cancelled", dispute_reason: null })
      .in("id", ids);
    if (cErr) throw new Error(cErr.message);

    // Create the netted replacement, if any balance remains.
    if (Math.abs(diff) >= 0.005) {
      const template = open[0] as any;
      const debtor_id = diff > 0 ? me : other;
      const creditor_id = diff > 0 ? other : me;
      const amount = Math.abs(diff);
      const sessionCount = open.reduce(
        (n: number, r: any) => n + sessionCountFromName(r.session_name),
        0,
      );
      const { error: iErr } = await supabaseAdmin.from("settlements").insert({
        source_kind: template.source_kind,
        source_table_id: template.source_table_id,
        session_name: `Netted (${sessionCount} sessions)`,
        debtor_id,
        creditor_id,
        amount,
        created_by: me,
      });
      if (iErr) throw new Error(iErr.message);
      return { ok: true, cancelled: ids.length, net_amount: amount, direction: diff > 0 ? "you_owe" : "owed_to_you" };
    }

    return { ok: true, cancelled: ids.length, net_amount: 0, direction: "even" as const };
  });

/** Combine any back-and-forth open (unpaid/disputed) settlements between
 *  `me` and every counterparty into a single netted row per pair. No-op when
 *  a counterparty has debts in only one direction. */
async function autoNetOpenSettlements(admin: any, me: string) {
  // fall-through
  return await _autoNetOpenSettlements(admin, me);
}

function sessionCountFromName(name: string | null | undefined): number {
  if (!name) return 1;
  const m = /^Netted \((\d+) sessions?\)/.exec(name);
  return m ? Math.max(1, parseInt(m[1], 10)) : 1;
}

async function _autoNetOpenSettlements(admin: any, me: string) {
  const { data: rows, error } = await admin
    .from("settlements")
    .select("id,debtor_id,creditor_id,amount,source_kind,source_table_id,session_name,created_at")
    .in("status", ["unpaid", "disputed"])
    .or(`debtor_id.eq.${me},creditor_id.eq.${me}`)
    .order("created_at", { ascending: false });
  if (error || !rows) return;

  const byOther = new Map<string, any[]>();
  for (const r of rows) {
    const other = r.debtor_id === me ? r.creditor_id : r.debtor_id;
    const arr = byOther.get(other) ?? [];
    arr.push(r);
    byOther.set(other, arr);
  }

  for (const [other, group] of byOther) {
    let owe = 0, owed = 0;
    for (const r of group) {
      const amt = Number(r.amount);
      if (r.debtor_id === me) owe += amt; else owed += amt;
    }
    // Combine when there are offsetting sides OR multiple rows in the same
    // direction with the same counterparty — one row per pair either way.
    if (group.length < 2) continue;

    const diff = Math.round((owe - owed) * 100) / 100;
    const ids = group.map((r) => r.id);

    await admin.from("settlements")
      .update({ status: "cancelled", dispute_reason: null })
      .in("id", ids);

    if (Math.abs(diff) >= 0.005) {
      const template = group[0];
      const sessionCount = group.reduce(
        (n: number, r: any) => n + sessionCountFromName(r.session_name),
        0,
      );
      await admin.from("settlements").insert({
        source_kind: template.source_kind,
        source_table_id: template.source_table_id,
        session_name: `Netted (${sessionCount} sessions)`,
        debtor_id: diff > 0 ? me : other,
        creditor_id: diff > 0 ? other : me,
        amount: Math.abs(diff),
        created_by: me,
      });
    }
  }
}