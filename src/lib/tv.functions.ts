import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SnapshotInput = z.object({
  gameId: z.string().uuid(),
  code: z.string().trim().length(6),
});

const CodeInput = z.object({ code: z.string().trim().length(6) });

/**
 * Resolve a 6-digit pairing code to its game id. Public (a TV is not signed in).
 */
export const resolveTvCode = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => CodeInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: session } = await supabaseAdmin
      .from("night_tv_sessions")
      .select("night_id")
      .eq("code", data.code)
      .eq("active", true)
      .maybeSingle();
    if (!session) throw new Error("Invalid or expired display code");
    return { gameId: session.night_id as string };
  });

/**
 * Read-only, sanitised snapshot of a live game for the TV display.
 * Never returns emails, wallets, debts, messages or admin data.
 */
export const getTvSnapshot = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => SnapshotInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: session } = await supabaseAdmin
      .from("night_tv_sessions")
      .select("night_id, code, active, settings, announcement, active_photo")
      .eq("night_id", data.gameId)
      .maybeSingle();
    if (!session || !session.active || session.code !== data.code) {
      throw new Error("This display is no longer paired");
    }

    // Auto-expire a photo whose time is up so the TV returns to normal.
    let activePhoto = session.active_photo as { path: string; until: string; duration: number } | null;
    if (activePhoto && new Date(activePhoto.until).getTime() <= Date.now()) {
      await supabaseAdmin
        .from("night_tv_sessions")
        .update({ active_photo: null })
        .eq("night_id", data.gameId);
      activePhoto = null;
    }

    let photoUrl: string | null = null;
    if (activePhoto) {
      const { data: signed } = await supabaseAdmin.storage
        .from("night-photos")
        .createSignedUrl(activePhoto.path, 60 * 60);
      photoUrl = signed?.signedUrl ?? null;
    }

    const { data: night } = await supabaseAdmin
      .from("poker_nights")
      .select(
        "id, title, starts_at, started_at, status, buy_in, currency, location, updated_at, format, starting_stack, rebuy_amount, rebuy_chips, addon_amount, addon_chips, level_minutes, blind_levels, payout_split, current_level, level_started_at, clock_paused_at, tournament_status",
      )
      .eq("id", data.gameId)
      .maybeSingle();
    if (!night) throw new Error("Game not found");

    const { data: rows } = await supabaseAdmin
      .from("player_results")
      .select("id, user_id, player_name, buy_in, rebuys, cash_out, final_rank, award")
      .eq("night_id", data.gameId);

    const userIds = (rows ?? []).map((r) => r.user_id).filter((x): x is string => !!x);
    const { data: profiles } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, name, nickname, avatar_url").in("id", userIds)
      : { data: [] as any[] };
    const profMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    const { data: events } = await supabaseAdmin
      .from("game_events")
      .select("id, event_type, amount, chip_amount, metadata, created_at, player_id")
      .eq("night_id", data.gameId)
      .order("created_at", { ascending: false })
      .limit(40);

    const isTournament = ((night as any).format ?? "cash") === "tournament";
    const { data: tEntries } = isTournament
      ? await supabaseAdmin
          .from("tournament_entries")
          .select("id, user_id, player_name, chips, buy_ins, rebuys, addons, place")
          .eq("night_id", data.gameId)
      : { data: [] as any[] };

    const tUserIds = (tEntries ?? []).map((e: any) => e.user_id).filter((x: any): x is string => !!x);
    const { data: tProfiles } = tUserIds.length
      ? await supabaseAdmin.from("profiles").select("id, name, nickname, avatar_url").in("id", tUserIds)
      : { data: [] as any[] };
    const tProfMap = new Map((tProfiles ?? []).map((p: any) => [p.id, p]));

    const players = (rows ?? []).map((r: any) => {
      const p = r.user_id ? profMap.get(r.user_id) : null;
      const buyIn = Number(r.buy_in || 0);
      const rebuys = Number(r.rebuys || 0);
      const cashOut = Number(r.cash_out || 0);
      return {
        id: r.id as string,
        userId: (r.user_id as string | null) ?? null,
        name: (p?.nickname || p?.name || r.player_name || "Player") as string,
        avatarUrl: (p?.avatar_url as string | null) ?? null,
        buyIn,
        rebuys,
        invested: buyIn + rebuys,
        chips: cashOut,
        cashedOut: cashOut > 0,
        rank: (r.final_rank as number | null) ?? null,
        award: (r.award as string | null) ?? null,
        eliminated: r.final_rank != null && Number(r.final_rank) > 1,
      };
    });

    const rebuyCount = (events ?? []).filter((e: any) => e.event_type === "rebuy").length;

    // Tournaments show live chip counts and finishing places instead of cash
    // buy-in/cash-out rows, so the TV table is fed from tournament_entries.
    const tPlayers = (tEntries ?? []).map((e: any) => {
      const p = e.user_id ? tProfMap.get(e.user_id) : null;
      const buyIn = Number(e.buy_ins || 0) * Number((night as any).buy_in || 0);
      const extra =
        Number(e.rebuys || 0) * Number((night as any).rebuy_amount || 0) +
        Number(e.addons || 0) * Number((night as any).addon_amount || 0);
      return {
        id: e.id as string,
        userId: (e.user_id as string | null) ?? null,
        name: (p?.nickname || p?.name || e.player_name || "Player") as string,
        avatarUrl: (p?.avatar_url as string | null) ?? null,
        buyIn,
        rebuys: extra,
        invested: buyIn + extra,
        chips: Number(e.chips || 0),
        cashedOut: false,
        rank: (e.place as number | null) ?? null,
        award: null as string | null,
        eliminated: e.place != null,
      };
    });

    const usingTournament = isTournament && tPlayers.length > 0 && players.length === 0;
    const shownPlayers = usingTournament ? tPlayers : players;
    const tPool = tPlayers.reduce((s, p) => s + p.invested, 0);

    return {
      night: {
        id: night.id as string,
        title: night.title as string,
        startsAt: night.starts_at as string,
        startedAt: (night.started_at as string | null) ?? null,
        status: night.status as string,
        endedAt:
          night.status === "completed" || night.status === "cancelled"
            ? ((night.updated_at as string | null) ?? null)
            : null,
        buyIn: Number(night.buy_in || 0),
        currency: (night.currency as string) || "EUR",
        location: (night.location as string | null) ?? null,
      },
      settings: session.settings as Record<string, any>,
      announcement: (session.announcement as string | null) ?? null,
      activePhoto,
      photoUrl,
      players: shownPlayers,
      tournament: isTournament
        ? {
            status: ((night as any).tournament_status as string) ?? "not_started",
            levelMinutes: Number((night as any).level_minutes || 20),
            blindLevels: ((night as any).blind_levels ?? []) as any[],
            payoutSplit: ((night as any).payout_split ?? []) as any[],
            currentLevel: Number((night as any).current_level || 0),
            levelStartedAt: ((night as any).level_started_at as string | null) ?? null,
            clockPausedAt: ((night as any).clock_paused_at as string | null) ?? null,
            startingStack: Number((night as any).starting_stack || 0),
            prizePool: tPool,
            entries: tPlayers.length,
            alive: tPlayers.filter((p) => p.rank == null).length,
            averageStack: (() => {
              const a = tPlayers.filter((p) => p.rank == null);
              return a.length ? Math.round(a.reduce((s, p) => s + p.chips, 0) / a.length) : 0;
            })(),
          }
        : null,
      totals: {
        players: shownPlayers.length,
        active: shownPlayers.filter((p) => !p.eliminated && !p.cashedOut).length,
        buyInAmount: shownPlayers.reduce((s, p) => s + p.buyIn, 0),
        rebuyAmount: shownPlayers.reduce((s, p) => s + p.rebuys, 0),
        rebuyCount,
        total: shownPlayers.reduce((s, p) => s + p.invested, 0),
      },
      events: (events ?? []).map((e: any) => ({
        id: e.id as string,
        type: e.event_type as string,
        amount: Number(e.amount || 0),
        chipAmount: e.chip_amount == null ? null : Number(e.chip_amount),
        metadata: (e.metadata ?? {}) as Record<string, any>,
        createdAt: e.created_at as string,
        playerId: (e.player_id as string | null) ?? null,
      })),
      serverTime: new Date().toISOString(),
    };
  });