import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type InviteProfile = {
  id: string;
  name: string;
  nickname: string | null;
  email: string;
  avatar_url: string | null;
};

export const listInviteProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id,name,nickname,email,avatar_url")
      .order("name", { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []) as InviteProfile[];
  });