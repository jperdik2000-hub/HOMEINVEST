import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/push-reminders")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { sendPushToUsers } = await import("@/lib/push-send.server");

          const now = new Date();

          type Window = {
            kind: "24h" | "1h";
            fromMs: number;
            toMs: number;
            title: (when: string) => string;
          };
          const windows: Window[] = [
            {
              kind: "24h",
              fromMs: 23 * 60 * 60 * 1000,
              toMs: 25 * 60 * 60 * 1000,
              title: (when) => `⏰ Poker tomorrow at ${when}`,
            },
            {
              kind: "1h",
              // 1-minute window centered on 60 minutes. The cron runs every minute,
              // so this fires once, almost exactly one hour before the game.
              fromMs: 60 * 60 * 1000 - 30 * 1000,
              toMs: 60 * 60 * 1000 + 30 * 1000,
              title: () => `🃏 Poker starts in an hour`,
            },
          ];

          let totalSent = 0;
          let totalChecked = 0;

          for (const w of windows) {
            const from = new Date(now.getTime() + w.fromMs).toISOString();
            const to = new Date(now.getTime() + w.toMs).toISOString();

            const { data: nights } = await supabaseAdmin
              .from("poker_nights")
              .select("id, title, starts_at, location, host_id")
              .gte("starts_at", from)
              .lte("starts_at", to);

            totalChecked += nights?.length ?? 0;

            for (const night of nights ?? []) {
              const { data: existing } = await supabaseAdmin
                .from("reminder_log")
                .select("id")
                .eq("night_id", night.id)
                .eq("kind", w.kind)
                .maybeSingle();
              if (existing) continue;

            // Recipients: invited users + host + rsvpers, minus those already "in".
              const [invRes, rsvpRes] = await Promise.all([
              supabaseAdmin
                .from("invitations")
                .select("invited_user_id")
                .eq("night_id", night.id),
              supabaseAdmin
                .from("rsvps")
                .select("user_id, status")
                .eq("night_id", night.id),
            ]);
              const invitedIds = new Set(
                (invRes.data ?? [])
                  .map((r: any) => r.invited_user_id)
                  .filter(Boolean),
              );
              invitedIds.add(night.host_id);
              const committed = new Set(
                (rsvpRes.data ?? [])
                  .filter((r: any) => r.status === "in")
                  .map((r: any) => r.user_id),
              );

              // 24h nudges people who haven't committed; 1h pings everyone
              // still on the invite list (including the ones who said yes).
              const targets =
                w.kind === "24h"
                  ? Array.from(invitedIds).filter((u) => !committed.has(u))
                  : Array.from(new Set([...invitedIds, ...committed]));

              const when = new Date(night.starts_at).toLocaleString("en-GB", {
                timeZone: "Europe/Athens",
                hour: "2-digit",
                minute: "2-digit",
              });
              const res = await sendPushToUsers(
                targets as string[],
                w.kind === "1h" ? "reminder_1h" : "reminder_24h",
                {
                title: w.title(when),
                body: `${night.title}${night.location ? " · " + night.location : ""}${w.kind === "24h" ? " — are you in?" : ""}`,
                url: `/nights/${night.id}`,
                tag: `night-reminder-${w.kind}-${night.id}`,
                },
              );
              totalSent += res.sent;

              await supabaseAdmin
                .from("reminder_log")
                .insert({ night_id: night.id, kind: w.kind });
            }
          }

          return new Response(
            JSON.stringify({ ok: true, sent: totalSent, checked: totalChecked }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (e: any) {
          console.error("push-reminders failed", e);
          return new Response(
            JSON.stringify({ ok: false, error: e?.message ?? "failed" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});