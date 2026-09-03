import { createFileRoute } from "@tanstack/react-router";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statusLabels = {
  attending: { label: "I'm in", emoji: "✅" },
  maybe: { label: "Maybe", emoji: "🤔" },
  declined: { label: "Can't", emoji: "❌" },
} as const;

export const Route = createFileRoute("/api/public/hooks/rsvp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = request.headers.get("authorization") ?? "";
          const token = auth.replace(/^Bearer\s+/i, "");
          if (!token || token !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
            return new Response("Unauthorized", { status: 401 });
          }

          const payload = await request.json().catch(() => ({}));
          const nightId = typeof payload?.night_id === "string" ? payload.night_id : "";
          const userId = typeof payload?.user_id === "string" ? payload.user_id : "";
          const status = typeof payload?.status === "string" ? payload.status : "";

          if (!uuidPattern.test(nightId) || !uuidPattern.test(userId) || !(status in statusLabels)) {
            return new Response(JSON.stringify({ ok: false, error: "Invalid RSVP payload" }), {
              status: 400,
              headers: { "content-type": "application/json" },
            });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { sendPushToUserIdsRaw } = await import("@/lib/push-send.server");

          const [{ data: night }, { data: profile }, { data: admins }, { data: invites }, { data: rsvps }] = await Promise.all([
            supabaseAdmin.from("poker_nights").select("id, title").eq("id", nightId).maybeSingle(),
            supabaseAdmin.from("profiles").select("name, nickname, email").eq("id", userId).maybeSingle(),
            supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin"),
            supabaseAdmin.from("invitations").select("invited_user_id").eq("night_id", nightId),
            supabaseAdmin.from("rsvps").select("user_id").eq("night_id", nightId),
          ]);

          if (!night) {
            return new Response(JSON.stringify({ ok: true, sent: 0, reason: "night_not_found" }), {
              headers: { "content-type": "application/json" },
            });
          }

          const recipientIds = Array.from(
            new Set(
              [
                ...((admins ?? []).map((r: any) => r.user_id as string)),
                ...((invites ?? []).map((r: any) => r.invited_user_id as string)),
                ...((rsvps ?? []).map((r: any) => r.user_id as string)),
              ].filter((id): id is string => !!id && id !== userId),
            ),
          );
          const who =
            (profile?.nickname && profile.nickname.trim()) ||
            (profile?.name && profile.name.trim()) ||
            profile?.email ||
            "Someone";
          const choice = statusLabels[status as keyof typeof statusLabels];

          const res = await sendPushToUserIdsRaw(recipientIds, "rsvp_received", {
            title: `${choice.emoji} ${who} RSVPed: ${choice.label}`,
            body: night.title,
            url: `/nights/${night.id}`,
            tag: `rsvp-${night.id}-${userId}-${status}-${Date.now()}`,
          });

          return new Response(JSON.stringify({ ok: true, ...res }), {
            headers: { "content-type": "application/json" },
          });
        } catch (e: any) {
          console.error("rsvp hook failed", e);
          return new Response(
            JSON.stringify({ ok: false, error: e?.message ?? "failed" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});