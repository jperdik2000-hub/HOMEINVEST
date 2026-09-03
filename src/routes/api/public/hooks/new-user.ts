import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/new-user")({
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
          const newUserId: string | undefined = payload?.user_id;
          const name: string = payload?.name ?? "Someone";
          const email: string = payload?.email ?? "";

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { sendPushToUserIdsRaw } = await import("@/lib/push-send.server");

          const { data: admins } = await supabaseAdmin
            .from("user_roles")
            .select("user_id")
            .eq("role", "admin");

          const adminIds = (admins ?? [])
            .map((r: any) => r.user_id as string)
            .filter((id) => id && id !== newUserId);

          const res = await sendPushToUserIdsRaw(adminIds, "new_user", {
            title: "🎉 New player joined",
            body: `${name}${email ? ` (${email})` : ""} just created an account`,
            url: "/dashboard",
            tag: `new-user-${newUserId ?? Date.now()}`,
          });

          return new Response(JSON.stringify({ ok: true, ...res }), {
            headers: { "content-type": "application/json" },
          });
        } catch (e: any) {
          console.error("new-user hook failed", e);
          return new Response(
            JSON.stringify({ ok: false, error: e?.message ?? "failed" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});