import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TvDisplay } from "@/components/TvDisplay";

export const Route = createFileRoute("/tv/game/$gameId")({
  ssr: false,
  // TanStack parses a bare numeric query value (?code=860128) as a number.
  // Keep the raw value untouched here — normalising it inside validateSearch
  // makes the router re-serialise the URL (?code="860128") and issue a 307,
  // which some TV browsers fail to follow. Normalisation happens in the
  // component instead.
  validateSearch: (search: Record<string, unknown>) => ({
    code: search.code == null ? undefined : (search.code as string | number),
  }),
  head: () => ({
    meta: [
      { title: "Live Table Display — Poker Club" },
      { name: "description", content: "Full-screen live dashboard for an in-person poker game: buy-ins, re-buys, players and events." },
      { property: "og:title", content: "Live Table Display — Poker Club" },
      { property: "og:description", content: "Full-screen live dashboard for an in-person poker game." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TvGamePage,
});

function TvGamePage() {
  const { gameId } = Route.useParams();
  const { code: rawCode } = Route.useSearch();
  const searchCode =
    rawCode == null ? undefined : String(rawCode).replace(/\D/g, "").padStart(6, "0");
  const navigate = useNavigate();
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem(`tv-code-${gameId}`);
    const c = searchCode || stored;
    if (!c) { navigate({ to: "/tv" }); return; }
    sessionStorage.setItem(`tv-code-${gameId}`, c);
    setCode(c);
  }, [gameId, searchCode, navigate]);

  if (!code) return <div className="grid min-h-screen place-items-center bg-felt text-3xl text-muted-foreground">Loading…</div>;

  return (
    <TvDisplay
      gameId={gameId}
      code={code}
      onUnpaired={() => {
        sessionStorage.removeItem(`tv-code-${gameId}`);
        navigate({ to: "/tv" });
      }}
    />
  );
}