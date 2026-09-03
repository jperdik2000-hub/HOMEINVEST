import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { resolveTvCode } from "@/lib/tv.functions";
import { Spade } from "lucide-react";

export const Route = createFileRoute("/tv/")({
  head: () => ({
    meta: [
      { title: "TV Display Pairing — Poker Club" },
      { name: "description", content: "Enter your six-digit game code to turn this screen into a live poker table display." },
      { property: "og:title", content: "TV Display Pairing — Poker Club" },
      { property: "og:description", content: "Enter your six-digit game code to turn this screen into a live poker table display." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TvPairing,
});

function TvPairing() {
  const navigate = useNavigate();
  const resolve = useServerFn(resolveTvCode);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await resolve({ data: { code } });
      sessionStorage.setItem(`tv-code-${res.gameId}`, code);
      navigate({ to: "/tv/game/$gameId", params: { gameId: res.gameId }, search: { code } });
    } catch (e: any) {
      setErr(e?.message ?? "Could not connect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-felt px-6 text-foreground">
      <form onSubmit={connect} className="card-felt w-full max-w-2xl rounded-[3vh] p-[6vh] text-center shadow-card">
        <div className="mx-auto mb-8 grid h-24 w-24 place-items-center rounded-3xl bg-gold shadow-gold">
          <Spade className="h-12 w-12" />
        </div>
        <h1 className="font-display text-5xl font-black">Connect this TV</h1>
        <p className="mt-3 text-xl opacity-70">Enter the six-digit display code shown on the host's device.</p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoFocus
          placeholder="000000"
          className="mt-10 w-full rounded-2xl bg-input px-6 py-6 text-center font-display text-7xl tracking-[0.35em] tabular-nums outline-none focus:ring-4 focus:ring-ring"
        />
        {err && <div className="mt-5 text-2xl text-red">{err}</div>}
        <button
          type="submit"
          disabled={code.length !== 6 || busy}
          className="mt-8 w-full rounded-2xl bg-gold px-8 py-6 text-3xl font-bold disabled:opacity-40"
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      </form>
    </div>
  );
}