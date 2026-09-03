import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MessageSchema = z.object({
  table_id: z.string().uuid(),
  body: z.string().trim().min(1).max(500),
});

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  small_blind: z.coerce.number().positive().max(1_000_000),
  big_blind: z.coerce.number().positive().max(2_000_000),
  buy_in: z.coerce.number().positive().max(10_000_000),
  max_seats: z.coerce.number().transform((n) => Math.floor(n)).pipe(z.number().int().min(2).max(9)),
  invited_user_ids: z.array(z.string().uuid()).max(50).default([]),
});

export const createPokerTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CreateSchema.parse(data))
  .handler(async ({ data, context }) => {
    if (data.big_blind < data.small_blind) throw new Error("Big blind must be >= small blind");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin } = await context.supabase
      .rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Only admins can create poker tables");
    const { data: table, error } = await supabaseAdmin
      .from("poker_tables")
      .insert({
        host_id: context.userId,
        name: data.name,
        small_blind: data.small_blind,
        big_blind: data.big_blind,
        buy_in: data.buy_in,
        max_seats: data.max_seats,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    // Host is implicitly invited via host_id; add explicit invitations for others (dedup, exclude host)
    const ids = Array.from(new Set(data.invited_user_ids.filter((id) => id !== context.userId)));
    if (ids.length) {
      const rows = ids.map((invited_user_id) => ({ table_id: table.id, invited_user_id }));
      await supabaseAdmin.from("poker_table_invitations").insert(rows);
      // Fire-and-forget push notification to invitees
      try {
        const { data: hostProfile } = await supabaseAdmin
          .from("profiles")
          .select("nickname,name")
          .eq("id", context.userId)
          .maybeSingle();
        const hostName = hostProfile?.nickname || hostProfile?.name || "A host";
        const { sendPushToUsers } = await import("./push-send.server");
        await sendPushToUsers(ids, "invite_received", {
          title: `${hostName} invited you to a poker table`,
          body: `${data.name} · Blinds ${data.small_blind}/${data.big_blind} · Buy-in ${data.buy_in}`,
          url: `/play/${table.id}`,
          tag: `table-invite-${table.id}`,
        });
      } catch (e) {
        console.error("table invite push failed", e);
      }
    }
    return { id: table.id };
  });

export const listMyPokerTables = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Tables I host
    const { data: hosted } = await supabaseAdmin
      .from("poker_tables")
      .select("id,name,host_id,small_blind,big_blind,buy_in,max_seats,status,created_at")
      .eq("host_id", context.userId)
      .neq("status", "ended")
      .order("created_at", { ascending: false });
    // Tables I'm invited to
    const { data: inv } = await supabaseAdmin
      .from("poker_table_invitations")
      .select("table_id")
      .eq("invited_user_id", context.userId);
    const invitedIds = (inv ?? []).map((r) => r.table_id);
    let invited: any[] = [];
    if (invitedIds.length) {
      const { data } = await supabaseAdmin
        .from("poker_tables")
        .select("id,name,host_id,small_blind,big_blind,buy_in,max_seats,status,created_at")
        .in("id", invitedIds)
        .neq("status", "ended")
        .order("created_at", { ascending: false });
      invited = data ?? [];
    }
    const map = new Map<string, any>();
    for (const t of [...(hosted ?? []), ...invited]) map.set(t.id, t);
    const tables = Array.from(map.values());
    // seat counts + host names
    if (tables.length) {
      const ids = tables.map((t) => t.id);
      const [{ data: seats }, { data: hosts }] = await Promise.all([
        supabaseAdmin.from("poker_seats").select("table_id,user_id,status").in("table_id", ids),
        supabaseAdmin.from("profiles").select("id,name,nickname").in("id", tables.map((t) => t.host_id)),
      ]);
      const seatByTable = new Map<string, number>();
      for (const s of seats ?? []) if (s.status !== "left") seatByTable.set(s.table_id, (seatByTable.get(s.table_id) ?? 0) + 1);
      const hostById = new Map<string, any>();
      for (const h of hosts ?? []) hostById.set(h.id, h);
      for (const t of tables) {
        t.seated_count = seatByTable.get(t.id) ?? 0;
        const h = hostById.get(t.host_id);
        t.host_name = h ? (h.nickname || h.name) : "Host";
      }
    }
    return tables;
  });

export const getMyWallet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let { data } = await supabaseAdmin
      .from("poker_wallets")
      .select("chips")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!data) {
      const { data: created } = await supabaseAdmin
        .from("poker_wallets")
        .insert({ user_id: context.userId })
        .select("chips")
        .single();
      data = created;
    }
    const chips = Number(data?.chips ?? 0);

    // Locked = chips backed by open (not-yet-confirmed) settlements owed to me.
    const { data: openIous } = await supabaseAdmin
      .from("settlements")
      .select("amount")
      .eq("creditor_id", context.userId)
      .in("status", ["unpaid", "payment_marked_sent", "disputed"]);
    const lockedRaw = (openIous ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
    const locked = Math.min(chips, Math.round(lockedRaw * 100) / 100);
    const available = Math.max(0, Math.round((chips - locked) * 100) / 100);

    return { chips, locked, available };
  });

export const topUpWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { amount: number }) => {
    const amount = Math.floor(Number(data?.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a positive amount.");
    if (amount > 1_000_000) throw new Error("Max 1,000,000 chips per deposit.");
    return { amount };
  })
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: w } = await supabaseAdmin
      .from("poker_wallets")
      .select("chips")
      .eq("user_id", context.userId)
      .maybeSingle();
    const current = Number(w?.chips ?? 0);
    const next = current + data.amount;
    if (next > 10_000_000) throw new Error("Wallet cap is 10,000,000 chips.");
    const { error } = await supabaseAdmin
      .from("poker_wallets")
      .upsert({ user_id: context.userId, chips: next });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("poker_wallet_transactions").insert({
      user_id: context.userId,
      kind: "deposit",
      amount: data.amount,
      balance_after: next,
      note: "Cashier deposit",
    });
    return { chips: next };
  });

export const listMyWalletTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("poker_wallet_transactions")
      .select("id,kind,amount,balance_after,table_id,note,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(25);
    return data ?? [];
  });

// ---- Casino Account ----

export const getCasinoAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: isAdmin } = await context.supabase
      .rpc("has_role", { _user_id: context.userId, _role: "admin" });

    // My deposit history only (cashier buy-ins / top-ups); table bets and cash-outs are not shown here
    const { data: myTx } = await supabaseAdmin
      .from("poker_wallet_transactions")
      .select("id,user_id,kind,amount,balance_after,table_id,note,created_at,settled,settled_at,settled_by")
      .eq("user_id", context.userId)
      .eq("kind", "deposit")
      .order("created_at", { ascending: false })
      .limit(500);

    // Every wallet + profile
    const { data: wallets } = await supabaseAdmin
      .from("poker_wallets")
      .select("user_id,chips,updated_at");
    const userIds = (wallets ?? []).map((w) => w.user_id);
    const { data: profs } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id,name,nickname,avatar_url").in("id", userIds)
      : { data: [] as any[] };
    const profById = new Map<string, any>((profs ?? []).map((p: any) => [p.id, p]));

    // Aggregate deposits (settled vs unsettled) and withdrawals per user
    const { data: allDeposits } = await supabaseAdmin
      .from("poker_wallet_transactions")
      .select("user_id,amount,settled")
      .eq("kind", "deposit");
    const depByUser = new Map<string, { total: number; unsettled: number }>();
    for (const t of allDeposits ?? []) {
      const bucket = depByUser.get(t.user_id) ?? { total: 0, unsettled: 0 };
      const amt = Number(t.amount);
      bucket.total += amt;
      if (!t.settled) bucket.unsettled += amt;
      depByUser.set(t.user_id, bucket);
    }

    const { data: allWithdrawals } = await supabaseAdmin
      .from("poker_wallet_transactions")
      .select("user_id,amount")
      .eq("kind", "withdrawal");
    const wdByUser = new Map<string, number>();
    for (const t of allWithdrawals ?? []) {
      wdByUser.set(t.user_id, (wdByUser.get(t.user_id) ?? 0) + Number(t.amount));
    }

    // All non-cancelled settlements — used for realized P&L (winnings vs losings)
    const { data: allSettlements } = await supabaseAdmin
      .from("settlements")
      .select("debtor_id,creditor_id,amount,status");
    const wonByUser = new Map<string, number>();  // realized winnings (credits)
    const lostByUser = new Map<string, number>(); // realized losings (debits)
    for (const s of allSettlements ?? []) {
      if (s.status === "cancelled") continue;
      const amt = Number(s.amount);
      wonByUser.set(s.creditor_id, (wonByUser.get(s.creditor_id) ?? 0) + amt);
      lostByUser.set(s.debtor_id, (lostByUser.get(s.debtor_id) ?? 0) + amt);
    }

    // Outstanding settlement debts (real IOUs still open between players)
    const { data: openSettlements } = await supabaseAdmin
      .from("settlements")
      .select("id,debtor_id,creditor_id,amount,withdrawn_amount,status,session_name,created_at")
      .not("status", "in", "(cancelled,fully_withdrawn,payment_confirmed)");

    type DebtRow = {
      id: string; debtor_id: string; creditor_id: string;
      amount: number; remaining: number; status: string;
      session_name: string | null; created_at: string;
    };
    const debts: DebtRow[] = (openSettlements ?? []).map((s: any) => ({
      id: s.id,
      debtor_id: s.debtor_id,
      creditor_id: s.creditor_id,
      amount: Number(s.amount),
      remaining: Math.max(0, Number(s.amount) - Number(s.withdrawn_amount ?? 0)),
      status: s.status,
      session_name: s.session_name ?? null,
      created_at: s.created_at,
    }));

    // Per-user aggregates: how much they owe others, how much others owe them
    const owedByUser = new Map<string, number>(); // user -> total they owe
    const owedToUser = new Map<string, number>(); // user -> total owed to them
    for (const d of debts) {
      owedByUser.set(d.debtor_id, (owedByUser.get(d.debtor_id) ?? 0) + d.remaining);
      owedToUser.set(d.creditor_id, (owedToUser.get(d.creditor_id) ?? 0) + d.remaining);
    }

    const players = (wallets ?? []).map((w) => {
      const p = profById.get(w.user_id);
      const dep = depByUser.get(w.user_id) ?? { total: 0, unsettled: 0 };
      const chips = Number(w.chips ?? 0);
      const withdrawals = wdByUser.get(w.user_id) ?? 0;
      const owedBy = owedByUser.get(w.user_id) ?? 0;
      const owedTo = owedToUser.get(w.user_id) ?? 0;
      const won = wonByUser.get(w.user_id) ?? 0;
      const lost = lostByUser.get(w.user_id) ?? 0;
      return {
        user_id: w.user_id,
        name: p?.name ?? null,
        nickname: p?.nickname ?? null,
        avatar_url: p?.avatar_url ?? null,
        chips,
        total_deposits: dep.total,
        unsettled_deposits: dep.unsettled,
        total_withdrawals: withdrawals,
        owed_by: owedBy, // total this player owes others
        owed_to: owedTo, // total others owe this player
        total_pl: won - lost,
      };
    }).sort((a, b) => (b.chips - a.chips));

    const me = players.find((p) => p.user_id === context.userId) ?? null;

    return {
      is_admin: !!isAdmin,
      user_id: context.userId,
      me,
      my_transactions: myTx ?? [],
      players,
      debts,
    };
  });

const MarkSettledSchema = z.object({
  tx_id: z.string().uuid(),
  settled: z.boolean(),
});

export const markWalletTxSettled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => MarkSettledSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tx } = await supabaseAdmin
      .from("poker_wallet_transactions")
      .select("id,user_id,kind")
      .eq("id", data.tx_id)
      .maybeSingle();
    if (!tx) throw new Error("Transaction not found");
    const { data: isAdmin } = await context.supabase
      .rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (tx.user_id !== context.userId && !isAdmin) throw new Error("Not allowed");
    const { error } = await supabaseAdmin
      .from("poker_wallet_transactions")
      .update({
        settled: data.settled,
        settled_at: data.settled ? new Date().toISOString() : null,
        settled_by: data.settled ? context.userId : null,
      })
      .eq("id", data.tx_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyEndedPokerTables = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: hosted } = await supabaseAdmin
      .from("poker_tables")
      .select("id,host_id,name,ended_at,settlement,small_blind,big_blind,buy_in")
      .eq("host_id", context.userId)
      .eq("status", "ended")
      .order("ended_at", { ascending: false })
      .limit(50);
    const { data: inv } = await supabaseAdmin
      .from("poker_table_invitations")
      .select("table_id")
      .eq("invited_user_id", context.userId);
    const invitedIds = (inv ?? []).map((r) => r.table_id);
    let invited: any[] = [];
    if (invitedIds.length) {
      const { data } = await supabaseAdmin
        .from("poker_tables")
        .select("id,host_id,name,ended_at,settlement,small_blind,big_blind,buy_in")
        .in("id", invitedIds)
        .eq("status", "ended")
        .order("ended_at", { ascending: false })
        .limit(50);
      invited = data ?? [];
    }
    const map = new Map<string, any>();
    for (const t of [...(hosted ?? []), ...invited]) map.set(t.id, t);
    const tables = Array.from(map.values()).sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""));
    if (tables.length) {
      const { data: hosts } = await supabaseAdmin
        .from("profiles")
        .select("id,name,nickname")
        .in(
          "id",
          Array.from(
            new Set(
              tables.flatMap((t) => {
                const s = (t.settlement ?? {}) as any;
                const nets = Array.isArray(s.nets) ? s.nets : [];
                const transfers = Array.isArray(s.transfers) ? s.transfers : [];
                return [
                  t.host_id,
                  ...nets.map((n: any) => n.user_id).filter(Boolean),
                  ...transfers.map((tr: any) => tr.from_user_id).filter(Boolean),
                  ...transfers.map((tr: any) => tr.to_user_id).filter(Boolean),
                ];
              }),
            ),
          ),
        );
      const profById = new Map<string, any>();
      for (const h of hosts ?? []) profById.set(h.id, h);
      const nameOf = (id: string | null | undefined) => {
        if (!id) return "Player";
        const p = profById.get(id);
        return p ? (p.nickname || p.name || "Player") : "Player";
      };
      for (const t of tables) {
        t.host_name = nameOf(t.host_id);
        const s = (t.settlement ?? {}) as any;
        if (Array.isArray(s.nets)) {
          s.nets = s.nets.map((n: any) => ({ ...n, name: n.name ?? nameOf(n.user_id) }));
        }
        if (Array.isArray(s.transfers)) {
          s.transfers = s.transfers.map((tr: any) => ({
            ...tr,
            from_name: tr.from_name ?? nameOf(tr.from_user_id),
            to_name: tr.to_name ?? nameOf(tr.to_user_id),
          }));
        }
        t.settlement = s;
      }
    }
    return tables;
  });

const JoinSchema = z.object({
  table_id: z.string().uuid(),
  seat_index: z.number().int().min(0).max(8),
});

// Rematch: host of an ended table re-creates it with the same config and
// re-invites everyone who was seated or previously invited. Wallets and
// prior history are untouched; a brand-new table row is returned.
export const rematchPokerTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ table_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: src } = await supabaseAdmin
      .from("poker_tables")
      .select("id,host_id,name,small_blind,big_blind,buy_in,max_seats,status")
      .eq("id", data.table_id)
      .maybeSingle();
    if (!src) throw new Error("Table not found");
    if (src.host_id !== context.userId) throw new Error("Only the host can rematch this table");
    const [{ data: seats }, { data: invites }] = await Promise.all([
      supabaseAdmin.from("poker_seats").select("user_id").eq("table_id", data.table_id),
      supabaseAdmin
        .from("poker_table_invitations")
        .select("invited_user_id")
        .eq("table_id", data.table_id),
    ]);
    const ids = new Set<string>();
    for (const s of seats ?? []) if (s.user_id && s.user_id !== context.userId) ids.add(s.user_id);
    for (const i of invites ?? []) if (i.invited_user_id !== context.userId) ids.add(i.invited_user_id);
    const cleanName = src.name.replace(/\s+\(rematch(?:\s+\d+)?\)\s*$/i, "");
    const { data: table, error } = await supabaseAdmin
      .from("poker_tables")
      .insert({
        host_id: context.userId,
        name: `${cleanName} (rematch)`,
        small_blind: src.small_blind,
        big_blind: src.big_blind,
        buy_in: src.buy_in,
        max_seats: src.max_seats,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const inviteIds = Array.from(ids);
    if (inviteIds.length) {
      await supabaseAdmin
        .from("poker_table_invitations")
        .insert(inviteIds.map((invited_user_id) => ({ table_id: table.id, invited_user_id })));
      try {
        const { data: hostProfile } = await supabaseAdmin
          .from("profiles")
          .select("nickname,name")
          .eq("id", context.userId)
          .maybeSingle();
        const hostName = hostProfile?.nickname || hostProfile?.name || "A host";
        const { sendPushToUsers } = await import("./push-send.server");
        await sendPushToUsers(inviteIds, "invite_received", {
          title: `${hostName} started a rematch`,
          body: `${table.name} · Blinds ${src.small_blind}/${src.big_blind} · Buy-in ${src.buy_in}`,
          url: `/play/${table.id}`,
          tag: `table-invite-${table.id}`,
        });
      } catch (e) {
        console.error("rematch invite push failed", e);
      }
    }
    return { id: table.id };
  });

export const joinSeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => JoinSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Check invite/host
    const { data: table } = await supabaseAdmin
      .from("poker_tables")
      .select("id,host_id,buy_in,max_seats,status")
      .eq("id", data.table_id)
      .maybeSingle();
    if (!table) throw new Error("Table not found");
    if (table.status === "ended") throw new Error("Table has ended");
    if (data.seat_index >= table.max_seats) throw new Error("Invalid seat");
    if (table.host_id !== context.userId) {
      const { data: inv } = await supabaseAdmin
        .from("poker_table_invitations")
        .select("id")
        .eq("table_id", data.table_id)
        .eq("invited_user_id", context.userId)
        .maybeSingle();
      if (!inv) throw new Error("You are not invited to this table");
    }
    // Already seated?
    const { data: existing } = await supabaseAdmin
      .from("poker_seats")
      .select("id,seat_index,status")
      .eq("table_id", data.table_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existing && existing.status !== "left") throw new Error("You are already seated");
    // Seat taken?
    const { data: taken } = await supabaseAdmin
      .from("poker_seats")
      .select("id,status")
      .eq("table_id", data.table_id)
      .eq("seat_index", data.seat_index)
      .maybeSingle();
    if (taken && taken.status !== "left") throw new Error("Seat is taken");
    // Wallet
    const { data: wallet } = await supabaseAdmin
      .from("poker_wallets")
      .select("chips")
      .eq("user_id", context.userId)
      .maybeSingle();
    const chips = Number(wallet?.chips ?? 0);
    if (chips < table.buy_in) throw new Error(`You need ${table.buy_in} chips (you have ${chips}). Top up first.`);
    // Debit wallet
    const { error: wErr } = await supabaseAdmin
      .from("poker_wallets")
      .update({ chips: chips - table.buy_in })
      .eq("user_id", context.userId);
    if (wErr) throw new Error(wErr.message);
    // Insert / revive seat
    if (taken) {
      await supabaseAdmin.from("poker_seats").delete().eq("id", taken.id);
    }
    if (existing) {
      await supabaseAdmin.from("poker_seats").delete().eq("id", existing.id);
    }
    const { error: sErr } = await supabaseAdmin.from("poker_seats").insert({
      table_id: data.table_id,
      seat_index: data.seat_index,
      user_id: context.userId,
      stack: table.buy_in,
      status: "active",
      total_buy_in: table.buy_in,
    });
    if (sErr) {
      // Refund
      await supabaseAdmin.from("poker_wallets").update({ chips }).eq("user_id", context.userId);
      throw new Error(sErr.message);
    }
    await supabaseAdmin.from("poker_wallet_transactions").insert({
      user_id: context.userId,
      kind: "buy_in",
      amount: -Number(table.buy_in),
      balance_after: chips - Number(table.buy_in),
      table_id: data.table_id,
      note: "Table buy-in",
    });
    return { ok: true };
  });

export const leaveSeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ table_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: seat } = await supabaseAdmin
      .from("poker_seats")
      .select("id,stack,status")
      .eq("table_id", data.table_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!seat || seat.status === "left") throw new Error("You are not seated");
    const stack = Number(seat.stack);
    // Credit wallet
    const { data: w } = await supabaseAdmin
      .from("poker_wallets")
      .select("chips")
      .eq("user_id", context.userId)
      .maybeSingle();
    const chips = Number(w?.chips ?? 0);
    await supabaseAdmin.from("poker_wallets").upsert({ user_id: context.userId, chips: chips + stack });
    await supabaseAdmin.from("poker_seats").delete().eq("id", seat.id);
    await supabaseAdmin.from("poker_wallet_transactions").insert({
      user_id: context.userId,
      kind: "cashout",
      amount: stack,
      balance_after: chips + stack,
      table_id: data.table_id,
      note: "Left table",
    });
    return { ok: true, returned: stack };
  });

export const endPokerTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ table_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin
      .from("poker_tables")
      .select("id,host_id,status,buy_in")
      .eq("id", data.table_id)
      .maybeSingle();
    if (!table) throw new Error("Table not found");
    if (table.host_id !== context.userId) throw new Error("Only the host can end the table");
    // Cancel any hand still in progress: chips already committed to the pot
    // were deducted from each seat's stack but never awarded to a winner.
    // Refund each player's committed chips back to their seat stack so the
    // end-of-table cash-out reflects reality (no chips lost to a dead pot).
    const { data: activeHand } = await supabaseAdmin
      .from("poker_hands")
      .select("id")
      .eq("table_id", data.table_id)
      .eq("status", "active")
      .maybeSingle();
    if (activeHand) {
      const { data: handSeats } = await supabaseAdmin
        .from("poker_hand_seats")
        .select("user_id,committed_hand")
        .eq("hand_id", activeHand.id);
      for (const hs of handSeats ?? []) {
        const refund = Number((hs as any).committed_hand ?? 0);
        if (!(refund > 0)) continue;
        const { data: seatRow } = await supabaseAdmin
          .from("poker_seats")
          .select("stack")
          .eq("table_id", data.table_id)
          .eq("user_id", hs.user_id)
          .maybeSingle();
        if (!seatRow) continue;
        await supabaseAdmin
          .from("poker_seats")
          .update({ stack: Number(seatRow.stack) + refund })
          .eq("table_id", data.table_id)
          .eq("user_id", hs.user_id);
      }
      await supabaseAdmin
        .from("poker_hands")
        .update({ status: "ended", winners: [{ amount: 0, hand_name: "cancelled", seats: [] }] as any })
        .eq("id", activeHand.id);
    }
    const { data: seats } = await supabaseAdmin
      .from("poker_seats")
      .select("user_id,stack,status,total_buy_in")
      .eq("table_id", data.table_id);
    const nets: { user_id: string; net: number }[] = [];
    for (const s of seats ?? []) {
      if (s.status === "left") continue;
      nets.push({
        user_id: s.user_id,
        net: Number(s.stack) - Number((s as any).total_buy_in ?? 0),
      });
    }
    const eps = 0.005;
    const debtors = nets.filter((p) => p.net < -eps).map((p) => ({ ...p, net: -p.net })).sort((a, b) => b.net - a.net);
    const creditors = nets.filter((p) => p.net > eps).map((p) => ({ ...p })).sort((a, b) => b.net - a.net);
    const transfers: any[] = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].net, creditors[j].net);
      transfers.push({
        from_user_id: debtors[i].user_id,
        to_user_id: creditors[j].user_id,
        amount: Math.round(pay * 100) / 100,
      });
      debtors[i].net -= pay; creditors[j].net -= pay;
      if (debtors[i].net < eps) i++;
      if (creditors[j].net < eps) j++;
    }
    // Return each player's remaining stack to their wallet + ledger entry
    for (const s of seats ?? []) {
      if (s.status === "left") continue;
      const stack = Number(s.stack);
      if (!(stack > 0)) continue;
      const { data: w } = await supabaseAdmin
        .from("poker_wallets")
        .select("chips")
        .eq("user_id", s.user_id)
        .maybeSingle();
      const chips = Number(w?.chips ?? 0);
      const next = chips + stack;
      await supabaseAdmin.from("poker_wallets").upsert({ user_id: s.user_id, chips: next });
      await supabaseAdmin.from("poker_wallet_transactions").insert({
        user_id: s.user_id,
        kind: "cashout",
        amount: stack,
        balance_after: next,
        table_id: data.table_id,
        note: "Table ended",
      });
    }
    await supabaseAdmin.from("poker_seats").delete().eq("table_id", data.table_id);
    await supabaseAdmin
      .from("poker_tables")
      .update({ status: "ended", ended_at: new Date().toISOString(), settlement: { nets, transfers } as any })
      .eq("id", data.table_id);
    // Auto-create settlements from this session's wallet activity. Skipped
    // silently if the table has no chip movement or the results don't balance.
    try {
      const { settleTableCore } = await import("@/lib/settlements.functions");
      await settleTableCore(supabaseAdmin, "poker", data.table_id, context.userId);
    } catch (e) {
      console.warn("auto-settle poker failed:", e);
    }
    return { ok: true };
  });

// =====================================================================
// Table chat
// =====================================================================

export const listTableMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ table_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: messages, error } = await context.supabase
      .from("table_messages")
      .select("id,table_id,user_id,body,created_at,is_bot,bot_name")
      .eq("table_id", data.table_id)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return messages ?? [];
  });

export const sendTableMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => MessageSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("table_messages")
      .insert({ table_id: data.table_id, user_id: context.userId, body: data.body });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// =====================================================================
// Pause / resume (host only)
// =====================================================================

export const setTablePaused = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ table_id: z.string().uuid(), paused: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin
      .from("poker_tables")
      .select("host_id,status")
      .eq("id", data.table_id)
      .maybeSingle();
    if (!table) throw new Error("Table not found");
    if (table.host_id !== context.userId) throw new Error("Only the host can pause the table");
    if (table.status === "ended") throw new Error("Table has ended");
    const { error } = await supabaseAdmin
      .from("poker_tables")
      .update({ paused: data.paused } as any)
      .eq("id", data.table_id);
    if (error) throw new Error(error.message);
    // Adjust the active hand's turn deadline so timers don't expire while paused
    // and get a fresh 60s when resumed.
    const { data: hand } = await supabaseAdmin
      .from("poker_hands")
      .select("id")
      .eq("table_id", data.table_id)
      .eq("status", "active")
      .maybeSingle();
    if (hand) {
      const deadline = data.paused
        ? new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000).toISOString()
        : new Date(Date.now() + 60 * 1000).toISOString();
      await supabaseAdmin.from("poker_hands").update({ turn_deadline: deadline }).eq("id", hand.id);
    }
    return { ok: true, paused: data.paused };
  });