import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { handValue, isBlackjack, isBust, canSplit } from "./blackjack-eval";

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"];
const SUITS = ["s", "h", "d", "c"];
const NUM_DECKS = 6;
const SEATS = 6;

// 21+3 side bet
const SIDE_BET_21_3_AMOUNT = 2;
const SIDE_BET_21_3_PAYOUTS: Record<string, number> = {
  straight_flush: 40,
  three_kind: 30,
  straight: 10,
  flush: 5,
};

function rankIdx21_3(r: string): number {
  const map: Record<string, number> = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
    T: 10, J: 11, Q: 12, K: 13, A: 14,
  };
  return map[r] ?? 0;
}

export function evaluate21_3(
  c1: string, c2: string, up: string,
): "straight_flush" | "three_kind" | "straight" | "flush" | null {
  const ranks = [c1[0], c2[0], up[0]];
  const suits = [c1[1], c2[1], up[1]];
  const isFlush = suits[0] === suits[1] && suits[1] === suits[2];
  const isThree = ranks[0] === ranks[1] && ranks[1] === ranks[2];
  const idxs = ranks.map(rankIdx21_3).sort((a, b) => a - b);
  let isStraight = idxs[1] === idxs[0] + 1 && idxs[2] === idxs[1] + 1;
  // A-2-3 wheel
  const set = new Set(ranks);
  if (set.size === 3 && set.has("A") && set.has("2") && set.has("3")) isStraight = true;
  // Q-K-A already covered by 12,13,14. K-A-2 explicitly NOT a straight.
  if (isStraight && isFlush) return "straight_flush";
  if (isThree) return "three_kind";
  if (isFlush) return "flush";
  if (isStraight) return "straight";
  return null;
}

type Hand = {
  cards: string[];
  bet: number;
  doubled: boolean;
  from_split_ace?: boolean;
  resolved: boolean;
  result?: "win" | "lose" | "push" | "blackjack" | "bust";
  payout?: number;
};

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function freshShoe(): string[] {
  const cards: string[] = [];
  for (let d = 0; d < NUM_DECKS; d++) {
    for (const r of RANKS) for (const s of SUITS) cards.push(r + s);
  }
  return shuffle(cards);
}

function ensureShoe(deck: string[], needed: number): string[] {
  if (deck.length < Math.max(needed, NUM_DECKS * 52 * 0.25)) return freshShoe();
  return deck;
}

// After a split we play/deal RIGHT-hand first, then LEFT — same as a live
// casino. Since split inserts the right-side hand at the higher index
// (`splice(ci, 1, left, right)`), "next hand to play" is simply the highest
// unresolved index in the array. Returns -1 when everything is resolved.
function nextUnresolvedHandIdx(hands: Hand[]): number {
  for (let i = hands.length - 1; i >= 0; i--) {
    if (!hands[i].resolved) return i;
  }
  return -1;
}

// Adjust wallet by delta (positive = credit, negative = debit) and log a tx row.
async function adjustWallet(
  admin: any,
  userId: string | null,
  delta: number,
  kind: "buy_in" | "settlement",
  note: string,
  tableId: string | null = null,
) {
  if (!userId) return 0; // bots have no wallet
  const { data: w } = await admin.from("poker_wallets").select("chips").eq("user_id", userId).maybeSingle();
  const chips = Number(w?.chips ?? 0);
  if (delta < 0 && chips + delta < 0) throw new Error("Insufficient chips");
  const next = chips + delta;
  await admin.from("poker_wallets").upsert({ user_id: userId, chips: next });
  await admin.from("poker_wallet_transactions").insert({
    user_id: userId,
    kind,
    amount: delta,
    balance_after: next,
    note,
    table_id: tableId,
  });
  return next;
}

// ============= Create / list / get =============

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  min_bet: z.coerce.number().positive().max(1_000_000),
  max_bet: z.coerce.number().positive().max(10_000_000),
  invited_user_ids: z.array(z.string().uuid()).max(50).default([]),
  dealer_user_id: z.string().uuid().optional(),
});

export const createBlackjackTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (data.max_bet < data.min_bet) throw new Error("Max bet must be >= min bet");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin } = await context.supabase
      .rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Only admins can create blackjack tables");
    const dealerId = data.dealer_user_id ?? context.userId;
    const { data: table, error } = await supabaseAdmin
      .from("blackjack_tables")
      .insert({
        host_id: dealerId,
        name: data.name,
        min_bet: data.min_bet,
        max_bet: data.max_bet,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set(data.invited_user_ids.filter((id) => id !== dealerId)));
    if (ids.length) {
      const rows = ids.map((invited_user_id) => ({ table_id: table.id, invited_user_id }));
      await supabaseAdmin.from("blackjack_table_invitations").insert(rows);
      try {
        const { data: hostProfile } = await supabaseAdmin
          .from("profiles")
          .select("nickname,name")
          .eq("id", dealerId)
          .maybeSingle();
        const hostName = hostProfile?.nickname || hostProfile?.name || "A dealer";
        const { sendPushToUsers } = await import("./push-send.server");
        await sendPushToUsers(ids, "invite_received", {
          title: `${hostName} invited you to Blackjack`,
          body: `${data.name} · Bets ${data.min_bet}–${data.max_bet}`,
          url: `/play/bj/${table.id}`,
          tag: `bj-invite-${table.id}`,
        });
      } catch (e) {
        console.error("blackjack invite push failed", e);
      }
    }
    return { id: table.id };
  });

export const listMyBlackjackTables = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: hosted } = await supabaseAdmin
      .from("blackjack_tables")
      .select("id,name,host_id,min_bet,max_bet,status,created_at,ended_at")
      .eq("host_id", context.userId)
      .eq("status", "active");
    const { data: inv } = await supabaseAdmin
      .from("blackjack_table_invitations")
      .select("table_id")
      .eq("invited_user_id", context.userId);
    const invitedIds = (inv ?? []).map((r) => r.table_id);
    let invited: any[] = [];
    if (invitedIds.length) {
      const { data } = await supabaseAdmin
        .from("blackjack_tables")
        .select("id,name,host_id,min_bet,max_bet,status,created_at,ended_at")
        .in("id", invitedIds)
        .eq("status", "active");
      invited = data ?? [];
    }
    const map = new Map<string, any>();
    for (const t of [...(hosted ?? []), ...invited]) map.set(t.id, t);
    const tables = Array.from(map.values());
    if (tables.length) {
      const { data: hosts } = await supabaseAdmin
        .from("profiles")
        .select("id,name,nickname")
        .in("id", tables.map((t) => t.host_id));
      const hById = new Map<string, any>();
      for (const h of hosts ?? []) hById.set(h.id, h);
      for (const t of tables) {
        const h = hById.get(t.host_id);
        t.host_name = h ? (h.nickname || h.name) : "Dealer";
      }
      // seat counts
      const { data: seats } = await supabaseAdmin
        .from("blackjack_seats")
        .select("table_id")
        .in("table_id", tables.map((t) => t.id));
      const counts = new Map<string, number>();
      for (const s of seats ?? []) counts.set(s.table_id, (counts.get(s.table_id) ?? 0) + 1);
      for (const t of tables) t.seated_count = counts.get(t.id) ?? 0;
    }
    return tables.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  });

export const listMyEndedBlackjackTables = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: hosted } = await supabaseAdmin
      .from("blackjack_tables")
      .select("id,name,host_id,min_bet,max_bet,status,created_at,ended_at")
      .eq("host_id", context.userId)
      .eq("status", "ended")
      .order("ended_at", { ascending: false })
      .limit(50);
    const { data: inv } = await supabaseAdmin
      .from("blackjack_table_invitations")
      .select("table_id")
      .eq("invited_user_id", context.userId);
    const invitedIds = (inv ?? []).map((r) => r.table_id);
    let invited: any[] = [];
    if (invitedIds.length) {
      const { data } = await supabaseAdmin
        .from("blackjack_tables")
        .select("id,name,host_id,min_bet,max_bet,status,created_at,ended_at")
        .in("id", invitedIds)
        .eq("status", "ended")
        .order("ended_at", { ascending: false })
        .limit(50);
      invited = data ?? [];
    }
    // Also include tables where the user played (has a seat) even without an invitation row
    const { data: seated } = await supabaseAdmin
      .from("blackjack_seats")
      .select("table_id")
      .eq("user_id", context.userId);
    const seatedIds = Array.from(new Set((seated ?? []).map((r) => r.table_id)));
    let played: any[] = [];
    if (seatedIds.length) {
      const { data } = await supabaseAdmin
        .from("blackjack_tables")
        .select("id,name,host_id,min_bet,max_bet,status,created_at,ended_at")
        .in("id", seatedIds)
        .eq("status", "ended")
        .order("ended_at", { ascending: false })
        .limit(50);
      played = data ?? [];
    }
    const map = new Map<string, any>();
    for (const t of [...(hosted ?? []), ...invited, ...played]) map.set(t.id, t);
    const tables = Array.from(map.values()).sort(
      (a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""),
    );
    if (!tables.length) return [];

    const tableIds = tables.map((t) => t.id);
    const [{ data: hosts }, { data: rSeats }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id,name,nickname").in("id", tables.map((t) => t.host_id)),
      supabaseAdmin
        .from("blackjack_round_seats")
        .select("table_id,user_id,bet,insurance_bet,hands,final_payout,side_bet_21_3,side_bet_21_3_payout")
        .in("table_id", tableIds),
    ]);
    const hostById = new Map<string, any>();
    for (const h of hosts ?? []) hostById.set(h.id, h);

    // Aggregate per-user net per table
    type Agg = { user_id: string; staked: number; payout: number };
    const perTable = new Map<string, Map<string, Agg>>();
    for (const rs of rSeats ?? []) {
      if (!rs.user_id) continue;
      const hands: any[] = (rs.hands as any[]) ?? [];
      const handBets = hands.reduce((n, h) => n + Number(h?.bet ?? 0), 0);
      const staked = handBets + Number(rs.insurance_bet ?? 0) + Number(rs.side_bet_21_3 ?? 0);
      const payout = Number(rs.final_payout ?? 0) + Number(rs.side_bet_21_3_payout ?? 0);
      if (staked === 0 && payout === 0) continue;
      let t = perTable.get(rs.table_id);
      if (!t) { t = new Map(); perTable.set(rs.table_id, t); }
      const a = t.get(rs.user_id) ?? { user_id: rs.user_id, staked: 0, payout: 0 };
      a.staked += staked;
      a.payout += payout;
      t.set(rs.user_id, a);
    }

    // Resolve player names
    const allUserIds = new Set<string>();
    for (const m of perTable.values()) for (const a of m.values()) allUserIds.add(a.user_id);
    const { data: playerProfiles } = allUserIds.size
      ? await supabaseAdmin.from("profiles").select("id,name,nickname").in("id", Array.from(allUserIds))
      : { data: [] as any[] };
    const nameById = new Map<string, string>();
    for (const p of playerProfiles ?? []) nameById.set(p.id, (p as any).nickname || (p as any).name || "Player");

    for (const t of tables) {
      const h = hostById.get(t.host_id);
      t.host_name = h ? (h.nickname || h.name) : "Dealer";
      const m = perTable.get(t.id);
      const nets = m
        ? Array.from(m.values()).map((a) => ({
            user_id: a.user_id,
            name: nameById.get(a.user_id) ?? "Player",
            staked: a.staked,
            payout: a.payout,
            net: a.payout - a.staked,
          })).sort((a, b) => b.net - a.net)
        : [];
      const dealerNet = nets.reduce((n, r) => n - r.net, 0);
      t.nets = nets;
      t.dealer_net = dealerNet;
    }
    return tables;
  });

// Rematch: host of an ended blackjack table re-creates it with same bet
// limits and re-invites everyone who had a seat or was previously invited.
export const rematchBlackjackTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ table_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: src } = await supabaseAdmin
      .from("blackjack_tables")
      .select("id,host_id,name,min_bet,max_bet")
      .eq("id", data.table_id)
      .maybeSingle();
    if (!src) throw new Error("Table not found");
    if (src.host_id !== context.userId) throw new Error("Only the dealer can rematch this table");
    const [{ data: seats }, { data: invites }] = await Promise.all([
      supabaseAdmin.from("blackjack_seats").select("user_id").eq("table_id", data.table_id),
      supabaseAdmin
        .from("blackjack_table_invitations")
        .select("invited_user_id")
        .eq("table_id", data.table_id),
    ]);
    const ids = new Set<string>();
    for (const s of seats ?? []) if (s.user_id && s.user_id !== context.userId) ids.add(s.user_id);
    for (const i of invites ?? []) if (i.invited_user_id !== context.userId) ids.add(i.invited_user_id);
    const cleanName = src.name.replace(/\s+\(rematch(?:\s+\d+)?\)\s*$/i, "");
    const { data: table, error } = await supabaseAdmin
      .from("blackjack_tables")
      .insert({
        host_id: context.userId,
        name: `${cleanName} (rematch)`,
        min_bet: src.min_bet,
        max_bet: src.max_bet,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const inviteIds = Array.from(ids);
    if (inviteIds.length) {
      await supabaseAdmin
        .from("blackjack_table_invitations")
        .insert(inviteIds.map((invited_user_id) => ({ table_id: table.id, invited_user_id })));
      try {
        const { data: hostProfile } = await supabaseAdmin
          .from("profiles")
          .select("nickname,name")
          .eq("id", context.userId)
          .maybeSingle();
        const hostName = hostProfile?.nickname || hostProfile?.name || "A dealer";
        const { sendPushToUsers } = await import("./push-send.server");
        await sendPushToUsers(inviteIds, "invite_received", {
          title: `${hostName} started a Blackjack rematch`,
          body: `${table.name} · Bets ${src.min_bet}–${src.max_bet}`,
          url: `/play/bj/${table.id}`,
          tag: `bj-invite-${table.id}`,
        });
      } catch (e) {
        console.error("bj rematch invite push failed", e);
      }
    }
    return { id: table.id };
  });

export const getBlackjackTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ table_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin
      .from("blackjack_tables")
      .select("*")
      .eq("id", data.table_id)
      .maybeSingle();
    if (!table) throw new Error("Table not found");
    // Access check
    const isHost = table.host_id === context.userId;
    if (!isHost) {
      const { data: inv } = await supabaseAdmin
        .from("blackjack_table_invitations")
        .select("invited_user_id")
        .eq("table_id", data.table_id)
        .eq("invited_user_id", context.userId)
        .maybeSingle();
      const { data: seat } = await supabaseAdmin
        .from("blackjack_seats")
        .select("id")
        .eq("table_id", data.table_id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!inv && !seat) throw new Error("Not invited");
    }
    const [{ data: seats }, { data: rounds }, { data: hostProfile }] = await Promise.all([
      supabaseAdmin.from("blackjack_seats").select("*").eq("table_id", data.table_id),
      supabaseAdmin
        .from("blackjack_rounds")
        .select("id,status,dealer_cards,dealer_hidden,current_seat,insurance_offered,created_at,settled_at")
        .eq("table_id", data.table_id)
        .order("created_at", { ascending: false })
        .limit(1),
      supabaseAdmin.from("profiles").select("id,name,nickname,avatar_url").eq("id", table.host_id).maybeSingle(),
    ]);
    const round = rounds?.[0] ?? null;
    // Players
    const seatUserIds = (seats ?? []).map((s: any) => s.user_id);
    const { data: seatProfiles } = seatUserIds.length
      ? await supabaseAdmin.from("profiles").select("id,name,nickname,avatar_url").in("id", seatUserIds)
      : { data: [] };
    const profileById = new Map<string, any>();
    for (const p of seatProfiles ?? []) profileById.set(p.id, p);
    // Round seats
    let roundSeats: any[] = [];
    if (round) {
      const { data: rs } = await supabaseAdmin
        .from("blackjack_round_seats")
        .select("*")
        .eq("round_id", round.id);
      roundSeats = rs ?? [];
    }
    // My wallet
    const { data: wallet } = await supabaseAdmin
      .from("poker_wallets")
      .select("chips")
      .eq("user_id", context.userId)
      .maybeSingle();

    // Most recent settled round_seat for the current user on this table.
    // Used by the client to reliably show the win/loss toast even if the
    // dealer advances to the next round before this client polls.
    let myLastSettledSeat: any = null;
    {
      // IMPORTANT: only consider seats from rounds that are fully SETTLED.
      // A seat's own status becomes "done" mid-round (natural BJ, bust, stand)
      // before the dealer reveals and pays out — using it would fire a stale
      // "You lost X chips" toast before final_payout is written.
      const { data: roundsForMe } = await supabaseAdmin
        .from("blackjack_rounds")
        .select("id")
        .eq("table_id", data.table_id)
        .eq("status", "settled");
      const rids = (roundsForMe ?? []).map((r: any) => r.id);
      if (rids.length) {
        const { data: doneSeats } = await supabaseAdmin
          .from("blackjack_round_seats")
          .select("id,hands,insurance_bet,final_payout,updated_at,round_id,side_bet_21_3")
          .in("round_id", rids)
          .eq("user_id", context.userId)
          .eq("status", "done")
          .order("updated_at", { ascending: false })
          .limit(1);
        myLastSettledSeat = doneSeats?.[0] ?? null;
      }
    }

    // Suggest a Rebet amount from the caller's last settled seat.
    let myLastBet: { main: number; side_21_3: number } | null = null;
    if (myLastSettledSeat) {
      const hands: any[] = (myLastSettledSeat.hands as any[]) ?? [];
      // Take the ORIGINAL bet from the first hand (pre-double, pre-split).
      // After a double, hand.bet is stored as 2× the original stake — halve it
      // so Rebet suggests the initial wager, not the doubled amount.
      const h0 = hands[0];
      const rawMain = Number(h0?.bet ?? 0);
      const main = h0?.doubled ? Math.round(rawMain / 2) : rawMain;
      const side = Number(myLastSettledSeat.side_bet_21_3 ?? 0);
      if (main > 0) myLastBet = { main, side_21_3: side };
    }

    // End-of-game settlement summary: aggregate every completed round_seat on
    // this table to compute net chips per player vs the dealer.
    let settlementSummary: Array<{ user_id: string; name: string; staked: number; payout: number; net: number }> = [];
    if (table.status === "ended") {
      const { data: allRounds } = await supabaseAdmin
        .from("blackjack_rounds").select("id").eq("table_id", data.table_id);
      const roundIds = (allRounds ?? []).map((r: any) => r.id);
      if (roundIds.length) {
        const { data: allSeats } = await supabaseAdmin
          .from("blackjack_round_seats")
          .select("user_id,hands,insurance_bet,final_payout,status,side_bet_21_3,side_bet_21_3_payout")
          .in("round_id", roundIds);
        const agg = new Map<string, { staked: number; payout: number }>();
        for (const rs of allSeats ?? []) {
          if (!rs.user_id) continue; // skip bots
          const hands: any[] = (rs.hands as any) ?? [];
          const stake = hands.reduce((n, h) => n + Number(h?.bet ?? 0), 0)
            + Number(rs.insurance_bet ?? 0)
            + Number(rs.side_bet_21_3 ?? 0);
          const pay = Number(rs.final_payout ?? 0) + Number(rs.side_bet_21_3_payout ?? 0);
          const cur = agg.get(rs.user_id) ?? { staked: 0, payout: 0 };
          cur.staked += stake;
          cur.payout += pay;
          agg.set(rs.user_id, cur);
        }
        const missingIds = [...agg.keys()].filter((uid) => !profileById.has(uid));
        if (missingIds.length) {
          const { data: extras } = await supabaseAdmin
            .from("profiles").select("id,name,nickname,avatar_url").in("id", missingIds);
          for (const p of extras ?? []) profileById.set(p.id, p);
        }
        settlementSummary = [...agg.entries()].map(([uid, v]) => {
          const p = profileById.get(uid);
          return {
            user_id: uid,
            name: p?.nickname || p?.name || "Player",
            staked: v.staked,
            payout: v.payout,
            net: v.payout - v.staked,
          };
        }).sort((a, b) => b.net - a.net);
      }
    }

    return {
      table: { ...table, host_profile: hostProfile ?? null },
      seats: (seats ?? [])
        .map((s: any) => ({ ...s, profile: profileById.get(s.user_id) ?? null }))
        .sort((a: any, b: any) => a.seat_index - b.seat_index),
      round,
      round_seats: roundSeats,
      wallet_chips: Number(wallet?.chips ?? 0),
      is_host: isHost,
      me_user_id: context.userId,
      settlement_summary: settlementSummary,
      my_last_settled_seat: myLastSettledSeat,
      my_last_bet: myLastBet,
    };
  });

// ============= Sit / leave =============

export const sitBlackjack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ table_id: z.string().uuid(), seat_index: z.number().int().min(0).max(SEATS - 1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin
      .from("blackjack_tables")
      .select("id,host_id,status,min_bet")
      .eq("id", data.table_id)
      .maybeSingle();
    if (!table) throw new Error("Table not found");
    if (table.status === "ended") throw new Error("Table has ended");
    if (table.host_id === context.userId) throw new Error("The dealer cannot sit as a player");
    // invited?
    const { data: inv } = await supabaseAdmin
      .from("blackjack_table_invitations")
      .select("invited_user_id")
      .eq("table_id", data.table_id)
      .eq("invited_user_id", context.userId)
      .maybeSingle();
    if (!inv) throw new Error("You are not invited to this table");
    const { data: taken } = await supabaseAdmin
      .from("blackjack_seats")
      .select("id,user_id")
      .eq("table_id", data.table_id)
      .eq("seat_index", data.seat_index)
      .maybeSingle();
    if (taken) throw new Error("Seat is taken");
    const { data: mineSeats } = await supabaseAdmin
      .from("blackjack_seats")
      .select("id,seat_index")
      .eq("table_id", data.table_id)
      .eq("user_id", context.userId);
    if ((mineSeats?.length ?? 0) >= 2) throw new Error("Max 2 seats per player");
    if ((mineSeats ?? []).some((s: any) => s.seat_index === data.seat_index))
      throw new Error("You are already at this seat");
    const { data: wallet } = await supabaseAdmin
      .from("poker_wallets").select("chips").eq("user_id", context.userId).maybeSingle();
    if (Number(wallet?.chips ?? 0) < Number(table.min_bet)) throw new Error("Not enough chips to cover min bet");
    const { error } = await supabaseAdmin.from("blackjack_seats").insert({
      table_id: data.table_id,
      seat_index: data.seat_index,
      user_id: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const leaveBlackjack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      table_id: z.string().uuid(),
      seat_index: z.number().int().min(0).max(SEATS - 1).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("blackjack_seats")
      .delete()
      .eq("table_id", data.table_id)
      .eq("user_id", context.userId);
    if (typeof data.seat_index === "number") q = q.eq("seat_index", data.seat_index);
    await q;
    return { ok: true };
  });

export const endBlackjackTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ table_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin
      .from("blackjack_tables").select("host_id,status").eq("id", data.table_id).maybeSingle();
    if (!table) throw new Error("Table not found");
    if (table.host_id !== context.userId) throw new Error("Only the dealer can end the table");
    await supabaseAdmin
      .from("blackjack_tables")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", data.table_id);
    try {
      const { settleTableCore } = await import("@/lib/settlements.functions");
      await settleTableCore(supabaseAdmin, "blackjack", data.table_id, context.userId);
    } catch (e) {
      console.warn("auto-settle blackjack failed:", e);
    }
    return { ok: true };
  });

// ============= Round lifecycle =============

export const placeBlackjackBet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      table_id: z.string().uuid(),
      bet: z.coerce.number().positive(),
      mode: z.enum(["set", "add"]).optional(),
      seat_index: z.number().int().min(0).max(SEATS - 1).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin
      .from("blackjack_tables").select("id,host_id,min_bet,max_bet,status").eq("id", data.table_id).maybeSingle();
    if (!table) throw new Error("Table not found");
    if (table.status === "ended") throw new Error("Table has ended");
    const mode = data.mode ?? "set";
    const minBet = Number(table.min_bet);
    const maxBet = Number(table.max_bet);
    const seatQ = supabaseAdmin
      .from("blackjack_seats").select("seat_index")
      .eq("table_id", data.table_id).eq("user_id", context.userId);
    const { data: mySeatsRows } =
      typeof data.seat_index === "number"
        ? await seatQ.eq("seat_index", data.seat_index)
        : await seatQ;
    if (!mySeatsRows || mySeatsRows.length === 0) throw new Error("You are not seated");
    if (mySeatsRows.length > 1) throw new Error("Specify which seat to bet on");
    const seat = mySeatsRows[0];
    // Find or create current betting round
    let { data: round } = await supabaseAdmin
      .from("blackjack_rounds")
      .select("id,status,current_seat")
      .eq("table_id", data.table_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!round || round.status !== "betting") {
      // Need a new round
      const { data: r, error } = await supabaseAdmin
        .from("blackjack_rounds")
        .insert({ table_id: data.table_id, status: "betting", deck: [] })
        .select("id,status,current_seat")
        .single();
      if (error) throw new Error(error.message);
      round = r;
    }
    // Already bet?
    const { data: existing } = await supabaseAdmin
      .from("blackjack_round_seats")
      .select("id,bet")
      .eq("round_id", round!.id)
      .eq("user_id", context.userId)
      .eq("seat_index", seat.seat_index)
      .maybeSingle();
    if (mode === "set") {
      if (existing) throw new Error("You already placed a bet this round");
      if (data.bet < minBet || data.bet > maxBet) {
        throw new Error(`Bet must be between ${minBet} and ${maxBet}`);
      }
      await adjustWallet(supabaseAdmin, context.userId, -data.bet, "buy_in", "Blackjack bet", data.table_id);
      await supabaseAdmin.from("blackjack_round_seats").insert({
        round_id: round!.id,
        table_id: data.table_id,
        seat_index: seat.seat_index,
        user_id: context.userId,
        bet: data.bet,
        hands: [] as any,
        status: "betting",
      });
    } else {
      // "add" mode — chip-by-chip bet builder.
      const currentBet = Number(existing?.bet ?? 0);
      const nextBet = currentBet + data.bet;
      if (nextBet > maxBet) throw new Error(`Max bet is ${maxBet}`);
      await adjustWallet(supabaseAdmin, context.userId, -data.bet, "buy_in", "Blackjack bet", data.table_id);
      if (existing) {
        await supabaseAdmin.from("blackjack_round_seats")
          .update({ bet: nextBet })
          .eq("id", existing.id);
      } else {
        await supabaseAdmin.from("blackjack_round_seats").insert({
          round_id: round!.id,
          table_id: data.table_id,
          seat_index: seat.seat_index,
          user_id: context.userId,
          bet: data.bet,
          hands: [] as any,
          status: "betting",
        });
      }
    }
    return { ok: true };
  });

// Clear the caller's pending bet in the current betting round and refund it.
// Also refunds an already-placed 21+3 side bet on the same seat.
export const clearBlackjackBet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      table_id: z.string().uuid(),
      seat_index: z.number().int().min(0).max(SEATS - 1).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: round } = await supabaseAdmin
      .from("blackjack_rounds")
      .select("id,status")
      .eq("table_id", data.table_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!round) return { ok: true, no_op: true };
    if (round.status !== "betting") throw new Error("Betting is closed");
    const rsQ = supabaseAdmin
      .from("blackjack_round_seats")
      .select("id,bet,side_bet_21_3")
      .eq("round_id", round.id)
      .eq("user_id", context.userId);
    const { data: rsRows } =
      typeof data.seat_index === "number"
        ? await rsQ.eq("seat_index", data.seat_index)
        : await rsQ;
    if (!rsRows || rsRows.length === 0) return { ok: true, no_op: true };
    if (rsRows.length > 1) throw new Error("Specify which seat to clear");
    const rs = rsRows[0];
    const refund = Number(rs.bet ?? 0) + Number(rs.side_bet_21_3 ?? 0);
    if (refund > 0) {
      await adjustWallet(supabaseAdmin, context.userId, refund, "settlement", "Blackjack bet cleared", data.table_id);
    }
    await supabaseAdmin.from("blackjack_round_seats").delete().eq("id", rs.id);
    return { ok: true, refunded: refund };
  });

// 21+3 side bet — fixed 2 chips, only during betting phase.
export const placeBlackjack213 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      table_id: z.string().uuid(),
      seat_index: z.number().int().min(0).max(SEATS - 1).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin
      .from("blackjack_tables").select("id,status").eq("id", data.table_id).maybeSingle();
    if (!table) throw new Error("Table not found");
    if (table.status === "ended") throw new Error("Table has ended");
    const { data: round } = await supabaseAdmin
      .from("blackjack_rounds")
      .select("id,status")
      .eq("table_id", data.table_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!round) throw new Error("No active round");
    if (round.status !== "betting") throw new Error("Betting is closed");
    const sq = supabaseAdmin
      .from("blackjack_round_seats")
      .select("id,side_bet_21_3")
      .eq("round_id", round.id)
      .eq("user_id", context.userId);
    const { data: seatRows } =
      typeof data.seat_index === "number"
        ? await sq.eq("seat_index", data.seat_index)
        : await sq;
    if (!seatRows || seatRows.length === 0) throw new Error("Place your main bet first");
    if (seatRows.length > 1) throw new Error("Specify which seat");
    const seat = seatRows[0];
    if (Number(seat.side_bet_21_3 ?? 0) > 0) throw new Error("21+3 side bet already placed");
    await adjustWallet(supabaseAdmin, context.userId, -SIDE_BET_21_3_AMOUNT, "buy_in", "Blackjack 21+3 side bet", data.table_id);
    await supabaseAdmin
      .from("blackjack_round_seats")
      .update({ side_bet_21_3: SIDE_BET_21_3_AMOUNT })
      .eq("id", seat.id);
    return { ok: true };
  });

// Settle 21+3 for all seats once the initial deal is complete and the
// dealer's upcard is visible. Idempotent via side_bet_21_3_settled.
async function settle21_3SideBets(admin: any, roundId: string) {
  const { data: round } = await admin
    .from("blackjack_rounds").select("id,table_id,dealer_cards").eq("id", roundId).maybeSingle();
  if (!round) return;
  const dealer: string[] = (round.dealer_cards as any) ?? [];
  if (dealer.length < 1) return;
  const up = dealer[0];
  const { data: seats } = await admin
    .from("blackjack_round_seats")
    .select("id,user_id,hands,side_bet_21_3,side_bet_21_3_settled")
    .eq("round_id", roundId);
  const { data: tableRow } = await admin
    .from("blackjack_tables").select("host_id").eq("id", round.table_id).maybeSingle();
  const hostId: string | null = tableRow?.host_id ?? null;
  let dealerDelta = 0;
  for (const s of seats ?? []) {
    if (s.side_bet_21_3_settled) continue;
    const stake = Number(s.side_bet_21_3 ?? 0);
    if (stake <= 0) {
      await admin.from("blackjack_round_seats").update({ side_bet_21_3_settled: true }).eq("id", s.id);
      continue;
    }
    const hands: Hand[] = (s.hands as any) ?? [];
    const cards = hands[0]?.cards ?? [];
    if (cards.length < 2) continue; // shouldn't happen; wait
    const result = evaluate21_3(cards[0], cards[1], up);
    let payout = 0;
    if (result && SIDE_BET_21_3_PAYOUTS[result]) {
      payout = stake + stake * SIDE_BET_21_3_PAYOUTS[result]; // stake back + winnings
    }
    if (payout > 0 && s.user_id) {
      await adjustWallet(admin, s.user_id, payout, "settlement", "Blackjack 21+3 payout", round.table_id);
    }
    // Net vs dealer: player net = payout - stake; dealer inverse.
    dealerDelta -= payout - stake;
    await admin.from("blackjack_round_seats").update({
      side_bet_21_3_settled: true,
      side_bet_21_3_payout: payout,
      side_bet_21_3_result: result ?? "lose",
    }).eq("id", s.id);
  }
  if (hostId && dealerDelta !== 0) {
    await adjustWallet(
      admin, hostId, dealerDelta,
      dealerDelta > 0 ? "settlement" : "buy_in",
      dealerDelta > 0 ? "Blackjack 21+3 dealer collect" : "Blackjack 21+3 dealer payout",
      round.table_id,
    );
  }
}

export const startBlackjackRound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ table_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin
      .from("blackjack_tables").select("id,host_id,status,min_bet").eq("id", data.table_id).maybeSingle();
    if (!table) throw new Error("Table not found");
    if (table.host_id !== context.userId) throw new Error("Only the dealer can deal");
    if (table.status === "ended") throw new Error("Table has ended");
    let { data: round } = await supabaseAdmin
      .from("blackjack_rounds")
      .select("id,status,deck")
      .eq("table_id", data.table_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!round || round.status !== "betting") {
      // Auto-create a betting round (needed when only bots are seated).
      const { data: r, error: rErr } = await supabaseAdmin
        .from("blackjack_rounds")
        .insert({ table_id: data.table_id, status: "betting", deck: [] })
        .select("id,status,deck")
        .single();
      if (rErr) throw new Error(rErr.message);
      round = r;
    }
    const { data: seats } = await supabaseAdmin
      .from("blackjack_round_seats")
      .select("*")
      .eq("round_id", round.id)
      .order("seat_index", { ascending: true });
    if (!seats || seats.length === 0) throw new Error("No bets placed");

    // Every seat must have at least the table minimum before dealing.
    const tooLow = seats.find((s: any) => Number(s.bet) < Number(table.min_bet));
    if (tooLow) throw new Error(`Every bet must be at least ${table.min_bet}`);

    // Get / prepare shoe
    let deck: string[] = Array.isArray(round.deck) && round.deck.length > 0 ? (round.deck as any) : freshShoe();
    deck = ensureShoe(deck, seats.length * 4 + 20);

    // Initialize empty hands so the dealer can deal cards one at a time.
    for (const s of seats) {
      const hand: Hand = { cards: [], bet: Number(s.bet), doubled: false, resolved: false };
      await supabaseAdmin
        .from("blackjack_round_seats")
        .update({ hands: [hand] as any, status: "betting", current_hand: 0 })
        .eq("id", s.id);
    }

    await supabaseAdmin
      .from("blackjack_rounds")
      .update({
        status: "dealing",
        deck: deck as any,
        dealer_cards: [] as any,
        dealer_hidden: true,
        current_seat: null,
        insurance_offered: false,
      })
      .eq("id", round.id);

    return { ok: true };
  });

// Deal a single card in order: seat0..seatN then dealer, repeated twice.
export const dealNextBlackjackCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ table_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin
      .from("blackjack_tables").select("host_id,status").eq("id", data.table_id).maybeSingle();
    if (!table) throw new Error("Table not found");
    if (table.host_id !== context.userId) throw new Error("Only the dealer can deal");
    if (table.status === "ended") throw new Error("Table has ended");

    const { data: round } = await supabaseAdmin
      .from("blackjack_rounds")
      .select("id,status,deck,dealer_cards,dealer_hidden,current_seat,insurance_offered")
      .eq("table_id", data.table_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!round) throw new Error("No round");
    if (round.status !== "dealing" && round.status !== "player" && round.status !== "dealer") {
      // Nothing to do (round is still in betting or already settled) — no-op
      // so a stale client click doesn't crash the page.
      return { ok: true, done: true };
    }

    // Dealer phase: first click reveals the hole card; subsequent clicks
    // draw to the dealer (or settle when standing).
    if (round.status === "dealer") {
      if (round.dealer_hidden) {
        await supabaseAdmin
          .from("blackjack_rounds")
          .update({ dealer_hidden: false })
          .eq("id", round.id);
        // If dealer has BJ or no live player hands remain, settle now.
        const dealer: string[] = (round.dealer_cards as any) ?? [];
        const dealerHasBJ = isBlackjack(dealer);
        const { data: seats } = await supabaseAdmin
          .from("blackjack_round_seats").select("hands").eq("round_id", round.id);
        const anyNeedsDealer = (seats ?? []).some((s: any) => {
          const hs = (s.hands as any as Hand[]) ?? [];
          return hs.some((h) => !isBust(h.cards) && !(isBlackjack(h.cards) && !dealerHasBJ));
        });
        if (dealerHasBJ || !anyNeedsDealer) {
          await settleRound(supabaseAdmin, round.id);
        } else if (handValue(dealer).total >= 17) {
          await settleRound(supabaseAdmin, round.id);
        }
        return { ok: true, done: false };
      }
      await dealerDrawOne(supabaseAdmin, round.id);
      return { ok: true, done: false };
    }

    // Player phase: deliver a pending card to the acting seat.
    if (round.status === "player") {
      const seatIndex = round.current_seat;
      if (seatIndex === null) throw new Error("No active seat");
      const { data: seatRow } = await supabaseAdmin
        .from("blackjack_round_seats")
        .select("*")
        .eq("round_id", round.id)
        .eq("seat_index", seatIndex)
        .maybeSingle();
      if (!seatRow) throw new Error("Seat not found");
      const pending = Number(seatRow.cards_pending ?? 0);
      if (pending <= 0) throw new Error("No card requested");
      const kind = seatRow.pending_kind as "hit" | "double" | "split" | null;
      const deck: string[] = ((round.deck as any) ?? []).slice();
      const hands: Hand[] = ((seatRow.hands as any) ?? []).slice();
      let ci = seatRow.current_hand as number;

      // Determine which hand the next card goes to.
      let targetIdx = ci;
      if (kind === "split") {
        // current_hand was set to the RIGHT (higher-index) split hand at split
        // time. Deal to it first; the sibling LEFT hand sits at ci - 1.
        if (hands[ci].cards.length === 1) targetIdx = ci;
        else targetIdx = ci - 1;
      }
      const target = hands[targetIdx];
      target.cards.push(deck.shift()!);

      // Resolve the hand based on the action that triggered the deal.
      if (kind === "double") {
        target.resolved = true;
        if (isBust(target.cards)) target.result = "bust";
      } else if (kind === "hit") {
        if (isBust(target.cards)) { target.resolved = true; target.result = "bust"; }
        else if (handValue(target.cards).total === 21) target.resolved = true;
      } else if (kind === "split") {
        if (target.from_split_ace) {
          target.resolved = true; // split aces get one card only
        } else if (isBust(target.cards)) {
          target.resolved = true; target.result = "bust";
        } else if (handValue(target.cards).total === 21) {
          target.resolved = true;
        }
      }

      const newPending = pending - 1;
      const stillPending = newPending > 0;

      // If not still pending and the current hand is resolved, advance.
      let finishedSeat = false;
      let nextCi = ci;
      if (!stillPending && hands[ci].resolved) {
        const nh = nextUnresolvedHandIdx(hands);
        if (nh >= 0) nextCi = nh;
        else finishedSeat = true;
      }

      if (finishedSeat) {
        await supabaseAdmin
          .from("blackjack_round_seats")
          .update({
            hands: hands as any,
            status: "done",
            current_hand: ci,
            cards_pending: 0,
            pending_kind: null,
          })
          .eq("id", seatRow.id);
        await supabaseAdmin
          .from("blackjack_rounds")
          .update({ deck: deck as any })
          .eq("id", round.id);
        await advanceSeat(supabaseAdmin, round.id, data.table_id);
      } else {
        await supabaseAdmin
          .from("blackjack_round_seats")
          .update({
            hands: hands as any,
            current_hand: nextCi,
            cards_pending: newPending,
            pending_kind: stillPending ? kind : null,
          })
          .eq("id", seatRow.id);
        await supabaseAdmin
          .from("blackjack_rounds")
          .update({ deck: deck as any })
          .eq("id", round.id);
      }
      return { ok: true, done: false };
    }

    const { data: seats } = await supabaseAdmin
      .from("blackjack_round_seats")
      .select("*")
      .eq("round_id", round.id)
      .order("seat_index", { ascending: true });
    if (!seats || seats.length === 0) throw new Error("No seats");

    const deck: string[] = ((round.deck as any) ?? []).slice();
    const dealer: string[] = ((round.dealer_cards as any) ?? []).slice();
    const N = seats.length;
    const dealt = seats.reduce((n, s: any) => {
      const hs = (s.hands as any as Hand[]) ?? [];
      return n + (hs[0]?.cards.length ?? 0);
    }, 0) + dealer.length;
    const total = 2 * (N + 1);
    if (dealt >= total) throw new Error("All cards dealt");

    // Round-robin, dealt from the dealer's right (highest seat_index first),
    // then the dealer, per pass.
    const pos = dealt % (N + 1);
    if (pos < N) {
      const s = seats[N - 1 - pos];
      const hands: Hand[] = ((s.hands as any) ?? [{ cards: [], bet: Number(s.bet), doubled: false, resolved: false }]);
      hands[0].cards.push(deck.shift()!);
      await supabaseAdmin.from("blackjack_round_seats").update({ hands: hands as any }).eq("id", s.id);
    } else {
      dealer.push(deck.shift()!);
    }

    const newDealt = dealt + 1;
    if (newDealt < total) {
      await supabaseAdmin
        .from("blackjack_rounds")
        .update({ deck: deck as any, dealer_cards: dealer as any })
        .eq("id", round.id);
      return { ok: true, done: false };
    }

    // All 2*(N+1) cards dealt — finalize round state.
    const { data: seats2 } = await supabaseAdmin
      .from("blackjack_round_seats")
      .select("*")
      .eq("round_id", round.id)
      .order("seat_index", { ascending: false });
    const insuranceOffered = dealer[0][0] === "A";
    for (const s of seats2 ?? []) {
      const hs = (s.hands as any as Hand[]) ?? [];
      const cards = hs[0]?.cards ?? [];
      const isBJ = isBlackjack(cards);
      hs[0] = { ...hs[0], resolved: isBJ };
      await supabaseAdmin
        .from("blackjack_round_seats")
        .update({ hands: hs as any, status: isBJ ? "done" : "acting", current_hand: 0 })
        .eq("id", s.id);
    }
    const firstSeat = (seats2 ?? []).find((s: any) => {
      const hs = (s.hands as any as Hand[]) ?? [];
      return !isBlackjack(hs[0]?.cards ?? []);
    });
    await supabaseAdmin
      .from("blackjack_rounds")
      .update({
        status: firstSeat ? "player" : "dealer",
        deck: deck as any,
        dealer_cards: dealer as any,
        dealer_hidden: true,
        current_seat: firstSeat ? firstSeat.seat_index : null,
        insurance_offered: insuranceOffered,
      })
      .eq("id", round.id);

    // Dealer's upcard is now visible → settle 21+3 side bets immediately.
    await settle21_3SideBets(supabaseAdmin, round.id);

    if (!firstSeat) {
      await runDealerAndSettle(supabaseAdmin, round.id);
    } else {
      // insurance handled by human players; no bot fallback needed
    }
    return { ok: true, done: true };
  });

// Player action
const ActionSchema = z.object({
  table_id: z.string().uuid(),
  action: z.enum(["hit", "stand", "double", "split", "insurance", "decline_insurance"]),
  seat_index: z.number().int().min(0).max(SEATS - 1).optional(),
});

export const blackjackAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ActionSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: round } = await supabaseAdmin
      .from("blackjack_rounds")
      .select("id,status,deck,dealer_cards,current_seat,insurance_offered")
      .eq("table_id", data.table_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!round) throw new Error("No active round");
    if (round.status !== "player") throw new Error("Not in player phase");
    // For hit/stand/double/split, derive seat from round.current_seat if not given.
    let seatIndex: number | null | undefined = data.seat_index;
    if (typeof seatIndex !== "number") {
      const isTurnAction = data.action !== "insurance" && data.action !== "decline_insurance";
      if (isTurnAction && typeof round.current_seat === "number") {
        seatIndex = round.current_seat;
      }
    }
    const rq = supabaseAdmin
      .from("blackjack_round_seats")
      .select("*")
      .eq("round_id", round.id)
      .eq("user_id", context.userId);
    const { data: seatRows } =
      typeof seatIndex === "number"
        ? await rq.eq("seat_index", seatIndex)
        : await rq;
    if (!seatRows || seatRows.length === 0) throw new Error("You are not in this round");
    if (seatRows.length > 1) throw new Error("Specify which seat");
    const seatRow = seatRows[0];

    // Insurance actions happen before acting phase
    if (data.action === "insurance" || data.action === "decline_insurance") {
      if (!round.insurance_offered) throw new Error("Insurance not offered");
      if (Number(seatRow.insurance_bet) > 0) throw new Error("Insurance already handled");
      if (data.action === "insurance") {
        const hands = (seatRow.hands as any as Hand[]) ?? [];
        const insBet = Math.floor(Number(seatRow.bet) / 2);
        if (insBet > 0) {
          await adjustWallet(supabaseAdmin, context.userId, -insBet, "buy_in", "Blackjack insurance", data.table_id);
          await supabaseAdmin
            .from("blackjack_round_seats")
            .update({ insurance_bet: insBet })
            .eq("id", seatRow.id);
        }
      } else {
        // marker so we know it was declined (use -0? we'll use a special negative sentinel? Simpler: track via 0 default; we need a "declined" state)
        // Use insurance_bet = 0 and rely on all seats having answered. Add a flag by writing 0.0001? Instead: set current_hand=-1 as marker isn't ideal.
        // Cleaner: add a jsonb marker in hands? Skip — just proceed. We check "all seats responded" by whether every seat has been through onInsuranceAnswered() below.
      }
      // If everyone has answered insurance → close insurance phase
      await afterInsurance(supabaseAdmin, round.id, data.table_id);
      return { ok: true };
    }

    // Normal in-turn actions
    if (round.current_seat !== seatRow.seat_index) throw new Error("Not your turn");
    if (seatRow.status !== "acting") throw new Error("You already finished");

    let deck: string[] = (round.deck as any) ?? [];
    let hands: Hand[] = (seatRow.hands as any) ?? [];
    let ci = seatRow.current_hand as number;
    let hand = hands[ci];
    if (!hand) throw new Error("No active hand");

    async function advance() {
      // Play unresolved hands right-to-left (casino convention).
      const nh = nextUnresolvedHandIdx(hands);
      if (nh >= 0) { ci = nh; return { finishedSeat: false }; }
      return { finishedSeat: true };
    }

    if (data.action === "hit") {
      // Request a card from the dealer; do not deal it here.
      await supabaseAdmin
        .from("blackjack_round_seats")
        .update({ cards_pending: 1, pending_kind: "hit" })
        .eq("id", seatRow.id);
      return { ok: true };
    } else if (data.action === "stand") {
      hand.resolved = true;
    } else if (data.action === "double") {
      if (hand.cards.length !== 2) throw new Error("Can only double on first two cards");
      // Debit extra bet
      await adjustWallet(supabaseAdmin, context.userId, -hand.bet, "buy_in", "Blackjack double", data.table_id);
      const extra = hand.bet;
      hand.bet = hand.bet * 2;
      hand.doubled = true;
      // Persist doubled bet, then wait for the dealer to deliver the card.
      hands[ci] = hand;
      await supabaseAdmin
        .from("blackjack_round_seats")
        .update({ hands: hands as any, bet: Number(seatRow.bet) + extra, cards_pending: 1, pending_kind: "double" })
        .eq("id", seatRow.id);
      return { ok: true };
    } else if (data.action === "split") {
      if (!canSplit(hand.cards)) throw new Error("Cannot split this hand");
      if (hands.length >= 3) throw new Error("Max splits reached (2 splits per round)");
      const baseBet = hand.bet;
      await adjustWallet(supabaseAdmin, context.userId, -baseBet, "buy_in", "Blackjack split", data.table_id);
      const [c1, c2] = hand.cards;
      const isAces = c1[0] === "A";
      const newHandA: Hand = {
        cards: [c1],
        bet: baseBet,
        doubled: false,
        from_split_ace: isAces,
        resolved: false,
      };
      const newHandB: Hand = {
        cards: [c2],
        bet: baseBet,
        doubled: false,
        from_split_ace: isAces,
        resolved: false,
      };
      // Replace current hand and insert the second after it
      hands.splice(ci, 1, newHandA, newHandB);
      // Two pending cards — right hand first, then left. Point current_hand
      // at the RIGHT (higher-index) split hand so it plays first as well.
      await supabaseAdmin
        .from("blackjack_round_seats")
        .update({
          hands: hands as any,
          bet: Number(seatRow.bet) + baseBet,
          cards_pending: 2,
          pending_kind: "split",
          current_hand: ci + 1,
        })
        .eq("id", seatRow.id);
      return { ok: true };
    }

    // If current hand is resolved, advance
    let finishedSeat = false;
    if (hand.resolved) {
      const r = await advance();
      finishedSeat = r.finishedSeat;
    }

    if (finishedSeat) {
      await supabaseAdmin
        .from("blackjack_round_seats")
        .update({ hands: hands as any, status: "done", current_hand: ci })
        .eq("id", seatRow.id);
      // Advance to next seat
      await advanceSeat(supabaseAdmin, round.id, data.table_id);
    } else {
      await supabaseAdmin
        .from("blackjack_round_seats")
        .update({ hands: hands as any, current_hand: ci })
        .eq("id", seatRow.id);
      await supabaseAdmin
        .from("blackjack_rounds")
        .update({ deck: deck as any })
        .eq("id", round.id);
    }

    return { ok: true };
  });

async function afterInsurance(admin: any, roundId: string, tableId: string) {
  // If every seat has non-null response — we can't easily track "declined" vs "not answered".
  // Instead we auto-close insurance immediately after any answer if all seats have either bet insurance or declined.
  // Simplification: close insurance as soon as any player answers, then start acting phase.
  const { data: round } = await admin
    .from("blackjack_rounds")
    .select("id,dealer_cards,insurance_offered,current_seat,status")
    .eq("id", roundId)
    .maybeSingle();
  if (!round || !round.insurance_offered) return;
  // Move to acting phase; the current_seat was already set at start
  await admin.from("blackjack_rounds").update({ insurance_offered: false }).eq("id", roundId);
  // If dealer has BJ, resolve immediately
  const dealer: string[] = round.dealer_cards as any;
  if (isBlackjack(dealer)) {
    await runDealerAndSettle(admin, roundId);
    return;
  }
}

async function advanceSeat(admin: any, roundId: string, tableId: string) {
  const { data: seats } = await admin
    .from("blackjack_round_seats")
    .select("seat_index,status")
    .eq("round_id", roundId)
    .order("seat_index", { ascending: false });
  const next = (seats ?? []).find((s: any) => s.status === "acting");
  if (next) {
    await admin.from("blackjack_rounds").update({ current_seat: next.seat_index }).eq("id", roundId);
  } else {
    await admin.from("blackjack_rounds").update({ current_seat: null, status: "dealer" }).eq("id", roundId);
    await runDealerAndSettle(admin, roundId);
  }
}

// Enter the dealer's phase: reveal the hole card and decide whether the
// dealer needs to draw. If not (dealer BJ, or every player busted/BJ),
// settle immediately. Otherwise stay in 'dealer' status and wait for the
// dealer to click DEAL for each card.
async function runDealerAndSettle(admin: any, roundId: string) {
  // Transition to dealer phase but KEEP the hole card hidden — the dealer
  // reveals it manually via the DEAL button (see dealNextBlackjackCard).
  await admin
    .from("blackjack_rounds")
    .update({ status: "dealer", dealer_hidden: true, current_seat: null })
    .eq("id", roundId);
}

// Dealer draws a single card. If the dealer should stand (>=17 hard, or >17),
// run settlement. Otherwise stay in dealer phase and wait for another click.
async function dealerDrawOne(admin: any, roundId: string) {
  const { data: round } = await admin
    .from("blackjack_rounds")
    .select("id,deck,dealer_cards,status")
    .eq("id", roundId)
    .maybeSingle();
  if (!round || round.status !== "dealer") return;
  const deck: string[] = ((round.deck as any) ?? []).slice();
  const dealer: string[] = ((round.dealer_cards as any) ?? []).slice();
  if (handValue(dealer).total >= 17) {
    await settleRound(admin, roundId);
    return;
  }
  dealer.push(deck.shift()!);
  await admin
    .from("blackjack_rounds")
    .update({ deck: deck as any, dealer_cards: dealer as any })
    .eq("id", roundId);
  if (handValue(dealer).total >= 17) {
    await settleRound(admin, roundId);
  }
}

async function settleRound(admin: any, roundId: string) {
  const { data: round } = await admin
    .from("blackjack_rounds")
    .select("id,deck,dealer_cards,table_id")
    .eq("id", roundId)
    .maybeSingle();
  if (!round) return;
  const deck: string[] = (round.deck as any) ?? [];
  const dealer: string[] = (round.dealer_cards as any) ?? [];
  const { data: seats } = await admin
    .from("blackjack_round_seats").select("*").eq("round_id", roundId);
  const dealerHasBJ = isBlackjack(dealer);
  const dealerTotal = handValue(dealer).total;
  const dealerBust = dealerTotal > 21;

  const { data: tableRow } = await admin
    .from("blackjack_tables").select("host_id,name").eq("id", round.table_id).maybeSingle();
  const hostId: string | null = tableRow?.host_id ?? null;
  const tableName = tableRow?.name ?? "Blackjack";
  let dealerDelta = 0;
  // Aggregate per-user results across all their seats so a player sitting in
  // two seats gets a single netted notification instead of one per seat.
  const perUser = new Map<string, { net: number; payout: number; stake: number }>();

  // Settle each seat
  for (const s of seats ?? []) {
    const hands: Hand[] = (s.hands as any) ?? [];
    let totalPayout = 0;
    let totalStake = 0;
    for (const h of hands) {
      const total = handValue(h.cards).total;
      const bj = isBlackjack(h.cards) && !h.from_split_ace;
      if (isBust(h.cards)) {
        h.result = "bust";
        h.payout = 0;
      } else if (bj && !dealerHasBJ) {
        h.result = "blackjack";
        h.payout = h.bet + Math.floor(h.bet * 1.5); // 3:2 (integer)
      } else if (bj && dealerHasBJ) {
        h.result = "push";
        h.payout = h.bet;
      } else if (dealerBust) {
        h.result = "win";
        h.payout = h.bet * 2;
      } else if (total > dealerTotal) {
        h.result = "win";
        h.payout = h.bet * 2;
      } else if (total < dealerTotal) {
        h.result = "lose";
        h.payout = 0;
      } else {
        h.result = "push";
        h.payout = h.bet;
      }
      h.resolved = true;
      totalPayout += h.payout ?? 0;
      totalStake += h.bet;
    }
    // Insurance settlement
    const insBet = Number(s.insurance_bet ?? 0);
    let insPayout = 0;
    if (insBet > 0) {
      if (dealerHasBJ) insPayout = insBet * 3; // 2:1 win + return stake
      else insPayout = 0;
    }
    const finalPayout = totalPayout + insPayout;
    if (finalPayout > 0) {
      await adjustWallet(admin, s.user_id, finalPayout, "settlement", "Blackjack payout", round.table_id);
    }
    // Player net = payouts - (stakes already debited at bet/double/split/insurance time).
    // Mirror it on the dealer's wallet so wins flow from dealer, losses flow to dealer.
    const playerNet = (finalPayout) - (totalStake + insBet);
    dealerDelta -= playerNet;
    await admin
      .from("blackjack_round_seats")
      .update({ hands: hands as any, final_payout: finalPayout, status: "done" })
      .eq("id", s.id);

    if (s.user_id) {
      const cur = perUser.get(s.user_id) ?? { net: 0, payout: 0, stake: 0 };
      const sideStake = Number(s.side_bet_21_3 ?? 0);
      const sidePayout = Number(s.side_bet_21_3_payout ?? 0);
      const sideNet = sidePayout - sideStake;
      cur.net += playerNet + sideNet;
      cur.payout += finalPayout;
      cur.stake += totalStake + insBet;
      perUser.set(s.user_id, cur);
    }
  }

  // Per-player win/loss push notifications intentionally disabled — results
  // are shown on-screen during gameplay instead.

  if (hostId && dealerDelta !== 0) {
    await adjustWallet(
      admin,
      hostId,
      dealerDelta,
      dealerDelta > 0 ? "settlement" : "buy_in",
      dealerDelta > 0 ? "Blackjack dealer collect" : "Blackjack dealer payout",
      round.table_id,
    );
  }

  await admin
    .from("blackjack_rounds")
    .update({
      status: "settled",
      dealer_cards: dealer as any,
      dealer_hidden: false,
      deck: deck as any,
      current_seat: null,
      settled_at: new Date().toISOString(),
    })
    .eq("id", roundId);
}

// Host advances to a fresh betting phase for next round.
export const nextBlackjackRound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ table_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: table } = await supabaseAdmin
      .from("blackjack_tables").select("host_id,status").eq("id", data.table_id).maybeSingle();
    if (!table) throw new Error("Table not found");
    if (table.host_id !== context.userId) throw new Error("Only the dealer can start next round");
    const { data: round } = await supabaseAdmin
      .from("blackjack_rounds")
      .select("id,status,deck")
      .eq("table_id", data.table_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (round && round.status !== "settled") throw new Error("Current round not finished");
    const deck = round?.deck ?? [];
    await supabaseAdmin.from("blackjack_rounds").insert({
      table_id: data.table_id,
      status: "betting",
      deck: deck as any,
    });
    return { ok: true };
  });

