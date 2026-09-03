import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spade, Heart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { getRememberMe, setRememberMe } from "@/lib/auth-storage";

function safeNext(v: unknown): string {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/hub";
}

type AuthSearch = { next?: string; mode?: string };

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): AuthSearch => ({
    ...(typeof s.next === "string" ? { next: safeNext(s.next) } : {}),
    ...(typeof s.mode === "string" ? { mode: s.mode } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Poker Club" },
      { name: "description", content: "Sign in to your Poker Club account." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const next = safeNext(search.next);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [code, setCode] = useState("");
  const [codeMode, setCodeMode] = useState(false);
  const [rememberMe, setRememberMeState] = useState(() => getRememberMe());
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Installed (Home Screen) app: magic links open in Safari, so the 6-digit
    // code is the only path that signs the user in inside the app.
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    setIsStandalone(standalone);
    if (standalone) {
      setRememberMeState(true);
      setRememberMe(true);
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ href: next, replace: true });
    });
  }, [navigate, next]);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const v = z.string().trim().email().max(255).parse(email);
      const { error } = await supabase.auth.signInWithOtp({
        email: v,
        options: { emailRedirectTo: window.location.origin + next },
      });
      if (error) throw error;
      setMagicSent(true);
      toast.success("Check your email for the magic link.");
    } catch (err: any) {
      toast.error(err?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider: "google" | "apple") {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: window.location.origin + next,
    });
    if (result.error) {
      toast.error(result.error.message);
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    navigate({ href: next });
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const mail = z.string().trim().email().max(255).parse(email);
      const token = z
        .string()
        .trim()
        .regex(/^\d{6}$/, "Enter the 6-digit code")
        .parse(code);
      const { error } = await supabase.auth.verifyOtp({ email: mail, token, type: "email" });
      if (error) throw error;
      // Persist the session so the installed app stays signed in.
      setRememberMe(true);
      navigate({ href: next, replace: true });
    } catch (err: any) {
      toast.error(err?.message ?? "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(ellipse_at_top,hsl(var(--felt)/0.35),transparent_60%),radial-gradient(ellipse_at_bottom,hsl(var(--gold)/0.08),transparent_60%)]">
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-8">
        <Link
          to="/"
          className="animate-in fade-in duration-500 mb-8 flex items-center justify-center gap-2"
        >
          <div className="flex items-center">
            <Spade className="h-5 w-5 text-gold drop-shadow-[0_0_8px_oklch(0.80_0.14_85_/_0.45)]" />
            <Heart className="h-5 w-5 -ml-1 text-gold drop-shadow-[0_0_8px_oklch(0.80_0.14_85_/_0.45)]" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">Poker Club</span>
        </Link>
        <div className="card-felt shadow-card animate-in fade-in zoom-in-95 duration-500 rounded-2xl p-6">
          <div className="mb-5 text-center">
            <h1 className="font-display text-2xl font-bold">Welcome to the table</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to your Poker Club account</p>
          </div>

          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => handleOAuth("google")}
              disabled={loading}
            >
              Continue with Google
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => handleOAuth("apple")}
              disabled={loading}
            >
              Continue with Apple
            </Button>
          </div>

          <div className="my-3 flex items-center justify-center gap-2">
            <Checkbox
              id="remember"
              checked={rememberMe}
              onCheckedChange={(checked) => {
                const value = checked === true;
                setRememberMeState(value);
                setRememberMe(value);
              }}
            />
            <label htmlFor="remember" className="text-sm text-muted-foreground cursor-pointer">
              Keep me signed in
            </label>
          </div>

          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
          </div>

          {magicSent ? (
            <div className="rounded-lg border border-border bg-background/40 p-4 text-center text-sm">
              <p className="font-medium">Magic link sent</p>
              <p className="mt-1 text-muted-foreground">
                {isStandalone
                  ? `Check ${email} — in the installed app, tapping the link opens Safari, so enter the 6-digit code from the email here instead.`
                  : `Check ${email} — tap the link, or enter the 6-digit code from the email below.`}
              </p>
              <form onSubmit={handleVerifyCode} className="mt-3 space-y-2">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center text-lg tracking-[0.4em]"
                />
                <Button type="submit" className="w-full bg-gold shadow-gold" disabled={loading}>
                  {loading ? "…" : "Verify code"}
                </Button>
              </form>
              <button
                className="mt-3 text-gold hover:underline"
                onClick={() => setMagicSent(false)}
              >
                Use a different email
              </button>
            </div>
          ) : codeMode ? (
            <form onSubmit={handleVerifyCode} className="space-y-3">
              <div>
                <Label htmlFor="email-code">Email</Label>
                <Input
                  id="email-code"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={255}
                />
              </div>
              <div>
                <Label htmlFor="otp">6-digit code from the email</Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center text-lg tracking-[0.4em]"
                />
              </div>
              <Button type="submit" className="w-full bg-gold shadow-gold" disabled={loading}>
                {loading ? "…" : "Verify code"}
              </Button>
              <button
                type="button"
                className="w-full text-xs text-muted-foreground hover:underline"
                onClick={() => setCodeMode(false)}
              >
                Back to magic link
              </button>
            </form>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-3">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={255}
                />
              </div>
              <Button type="submit" className="w-full bg-gold shadow-gold" disabled={loading}>
                {loading ? "…" : "Send magic link"}
              </Button>
              <button
                type="button"
                className="w-full text-xs text-muted-foreground hover:underline"
                onClick={() => setCodeMode(true)}
              >
                Use a 6-digit code instead
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
