import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Await initial session hydration (magic-link URL hash or storage restore)
// so authenticated users don't bounce through /auth on first load.
async function waitForInitialSession(timeoutMs = 1500): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  return await new Promise<Session | null>((resolve) => {
    const timer = setTimeout(() => {
      sub.data.subscription.unsubscribe();
      resolve(null);
    }, timeoutMs);
    const sub = supabase.auth.onAuthStateChange((event, session) => {
      if (session || event === "INITIAL_SESSION") {
        clearTimeout(timer);
        sub.data.subscription.unsubscribe();
        resolve(session ?? null);
      }
    });
  });
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const session = await waitForInitialSession();
    if (!session?.user) throw redirect({ to: "/auth" });
    return { user: session.user };
  },
  component: () => <Outlet />,
});