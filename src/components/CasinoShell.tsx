import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Spade, Heart, Wallet, Scale, Coins, ChevronDown } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { NotificationBell } from "@/components/NotificationBell";
import { Input } from "@/components/ui/input";

const CASINO_PW = "5555";
const CASINO_UNLOCK_KEY = "casino_unlocked_v1";

function CasinoPasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[radial-gradient(ellipse_at_top,hsl(var(--felt)/0.35),transparent_60%),radial-gradient(ellipse_at_bottom,hsl(var(--gold)/0.08),transparent_60%)]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pw.trim() === CASINO_PW) {
            try {
              localStorage.setItem(CASINO_UNLOCK_KEY, "1");
            } catch {}
            onUnlock();
          } else {
            setErr(true);
          }
        }}
        className="animate-in fade-in zoom-in-95 duration-500 card-felt shadow-card rounded-2xl p-7 w-full max-w-sm space-y-4"
      >
        <div className="flex items-center justify-center gap-1 text-gold">
          <Spade className="h-7 w-7 drop-shadow-[0_0_10px_oklch(0.80_0.14_85_/_0.5)]" />
          <Heart className="h-7 w-7 -ml-1 drop-shadow-[0_0_10px_oklch(0.80_0.14_85_/_0.5)]" />
        </div>
        <div className="text-center">
          <h1 className="font-display text-2xl font-bold text-gold">Casino Entry</h1>
          <p className="text-xs text-muted-foreground mt-1">Enter the password to continue</p>
        </div>
        <Input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pw}
          onChange={(e) => {
            setPw(e.target.value);
            setErr(false);
          }}
          placeholder="Password"
        />
        {err && <p className="text-xs text-red-500 text-center">Incorrect password</p>}
        <Button type="submit" className="w-full bg-gold shadow-gold">
          Enter
        </Button>
        <Link
          to="/dashboard"
          className="block text-center text-xs text-muted-foreground hover:text-gold"
        >
          Back to Home
        </Link>
      </form>
    </div>
  );
}

function UserMenu() {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const u = data.user;
      if (!u) return;
      setName(
        (u.user_metadata?.nickname as string) || (u.user_metadata?.name as string) || u.email || "",
      );
      const { data: prof } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", u.id)
        .maybeSingle();
      const raw = prof?.avatar_url ?? "";
      if (!raw) return;
      if (/^https?:\/\//i.test(raw)) {
        setAvatar(raw);
        return;
      }
      const { data: signed } = await supabase.storage
        .from("avatars")
        .createSignedUrl(raw, 60 * 60 * 24 * 7);
      setAvatar(signed?.signedUrl ?? "");
    });
  }, []);
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full border border-gold/40 bg-background/60 py-1 pl-1 pr-2 text-sm text-gold hover:bg-gold/10"
        >
          <Avatar className="h-7 w-7 ring-1 ring-gold/40">
            {avatar && <AvatarImage src={avatar} alt={name} />}
            <AvatarFallback className="bg-background text-gold text-xs">{initial}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-[140px] truncate sm:inline">{name}</span>
          <ChevronDown className="h-4 w-4 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <Link to="/play/account">
            <Wallet className="mr-2 h-4 w-4" /> Casino Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/play/settlements">
            <Scale className="mr-2 h-4 w-4" /> Settlements
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/play" hash="cashier">
            <Coins className="mr-2 h-4 w-4" /> Cashier
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CasinoShell({ children, compact }: { children: ReactNode; compact?: boolean }) {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setUnlocked(localStorage.getItem(CASINO_UNLOCK_KEY) === "1");
    } catch {
      setUnlocked(false);
    }
  }, []);
  if (unlocked === null) return null;
  if (!unlocked) return <CasinoPasswordGate onUnlock={() => setUnlocked(true)} />;
  return (
    <div
      className={
        compact
          ? "h-[100dvh] flex flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,hsl(var(--felt)/0.35),transparent_60%),radial-gradient(ellipse_at_bottom,hsl(var(--gold)/0.08),transparent_60%)]"
          : "min-h-screen bg-[radial-gradient(ellipse_at_top,hsl(var(--felt)/0.35),transparent_60%),radial-gradient(ellipse_at_bottom,hsl(var(--gold)/0.08),transparent_60%)]"
      }
    >
      {!compact && (
        <header className="sticky top-0 z-30 border-b border-gold/20 bg-background/80 backdrop-blur shadow-[0_1px_0_0_oklch(0.80_0.14_85_/_0.08)]">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link to="/play" className="group flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center text-gold transition-transform duration-300 group-hover:scale-110">
                <Spade className="h-5 w-5 drop-shadow-[0_0_8px_oklch(0.80_0.14_85_/_0.45)]" />
                <Heart className="h-5 w-5 -ml-1 drop-shadow-[0_0_8px_oklch(0.80_0.14_85_/_0.45)]" />
              </div>
              <div className="leading-tight">
                <div className="font-display text-lg font-bold tracking-wide text-gold">Casino</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  High-Stakes Room
                </div>
              </div>
            </Link>
            <div className="flex items-center gap-1">
              <Link
                to="/dashboard"
                className="flex items-center gap-2 rounded-full border border-gold/40 bg-background/60 px-3 py-1 text-sm text-gold transition-colors duration-200 hover:bg-gold/10"
              >
                <ArrowLeft className="h-4 w-4" /> Return to Poker Club
              </Link>
              <NotificationBell />
              <UserMenu />
            </div>
          </div>
        </header>
      )}
      <main className={compact ? "flex-1 min-h-0 flex flex-col" : "mx-auto max-w-6xl px-4 py-6"}>
        {children}
      </main>
    </div>
  );
}
