import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NightChat } from "@/components/NightChat";
import { ArrowLeft, Calendar, MapPin, Coins } from "lucide-react";
import { formatEUDateTime, formatMoney } from "@/lib/poker";

export const Route = createFileRoute("/_authenticated/nights/$id/chat")({
  head: () => ({ meta: [{ title: "Night chat" }] }),
  component: NightChatPage,
});

function NightChatPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)); }, []);
  const [vv, setVv] = useState<{ h: number; top: number } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.visualViewport;
    if (!v) return;
    const upd = () => setVv({ h: v.height, top: v.offsetTop });
    upd();
    v.addEventListener("resize", upd);
    v.addEventListener("scroll", upd);
    return () => { v.removeEventListener("resize", upd); v.removeEventListener("scroll", upd); };
  }, []);

  const night = useQuery({
    queryKey: ["night-header", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("poker_nights")
        .select("id,title,starts_at,location,buy_in,currency,host_id,rebuy_manager_id,status")
        .eq("id", id).maybeSingle();
      return data;
    },
  });
  const isAdmin = !!night.data && (night.data.host_id === me || night.data.rebuy_manager_id === me);

  return (
    <div
      className="fixed inset-x-0 z-50 flex flex-col bg-background"
      style={{
        top: vv ? `${vv.top}px` : 0,
        height: vv ? `${vv.h}px` : "100dvh",
      }}
    >
      <header className="flex items-start gap-3 border-b border-border/60 px-3 py-2">
        <button
          onClick={() => navigate({ to: "/nights/$id", params: { id } })}
          className="mt-1 rounded p-1 text-muted-foreground hover:bg-muted/40"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/nights/$id" params={{ id }}
          className="flex-1 min-w-0"
        >
          <div className="truncate font-display text-base font-bold">{night.data?.title ?? "Night"}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {night.data?.starts_at && (
              <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{formatEUDateTime(night.data.starts_at)}</span>
            )}
            {night.data?.location && (
              <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{night.data.location}</span>
            )}
            {night.data?.buy_in != null && (
              <span className="inline-flex items-center gap-1"><Coins className="h-3 w-3" />{formatMoney(Number(night.data.buy_in), night.data.currency ?? "EUR")}</span>
            )}
          </div>
        </Link>
      </header>
      <div className="flex-1 overflow-hidden">
        <NightChat nightId={id} meId={me} isAdmin={isAdmin} variant="full" />
      </div>
    </div>
  );
}
