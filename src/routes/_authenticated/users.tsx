import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { fetchProfiles, formatDisplayName } from "@/lib/poker";
import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { inviteUserByEmail } from "@/lib/invite-user.functions";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Users — Poker Club" }] }),
  component: UsersPage,
});

function UsersPage() {
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });
  const list = (profiles.data ?? [])
    .slice()
    .sort((a, b) =>
      (a.nickname || a.name || "").localeCompare(b.nickname || b.name || ""),
    );

  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;
      const { data: ok } = await supabase.rpc("has_role", { _user_id: uid, _role: "admin" });
      if (!cancelled) setIsAdmin(!!ok);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [email, setEmail] = useState("");
  const invite = useServerFn(inviteUserByEmail);
  const mutation = useMutation({
    mutationFn: async (addr: string) =>
      invite({
        data: {
          email: addr,
        },
      }),
    onSuccess: (res) => {
      toast.success(`Invite sent to ${res.email}`);
      setEmail("");
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to send invite"),
  });

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold md:text-4xl">Users</h1>
        <p className="text-sm text-muted-foreground">
          {list.length} member{list.length === 1 ? "" : "s"} with an account.
        </p>
      </div>

      {isAdmin && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) return;
            mutation.mutate(email.trim());
          }}
          className="card-felt shadow-card mb-6 rounded-2xl p-4"
        >
          <div className="mb-2 text-sm font-medium">Invite a new player</div>
          <p className="mb-3 text-xs text-muted-foreground">
            Sign-ups are closed. New accounts can only be created from an invite email you send here.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              placeholder="player@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={255}
              className="flex-1"
            />
            <Button type="submit" className="bg-gold shadow-gold" disabled={mutation.isPending}>
              {mutation.isPending ? "Sending…" : "Send invite"}
            </Button>
          </div>
        </form>
      )}

      {list.length === 0 ? (
        <div className="card-felt rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          No users yet.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => (
            <Link
              key={p.id}
              to="/players/$id"
              params={{ id: p.id }}
              className="card-felt shadow-card rounded-2xl p-4 transition hover:border-gold/60"
            >
              <div className="flex items-center gap-3">
                <Avatar url={p.avatar_url} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-base font-semibold">
                    {formatDisplayName(p.name, p.nickname)}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{p.name}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function Avatar({ url }: { url: string | null | undefined }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      if (!url) {
        setSrc("");
        return;
      }
      if (/^https?:\/\//i.test(url)) {
        setSrc(url);
        return;
      }
      const { data } = await supabase.storage
        .from("avatars")
        .createSignedUrl(url, 60 * 60 * 24 * 7);
      if (!cancelled) setSrc(data?.signedUrl ?? "");
    }
    resolve();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div
      className="chip-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow-gold"
      style={
        src
          ? { backgroundImage: `url(${src})`, backgroundSize: "cover", backgroundPosition: "center" }
          : undefined
      }
    >
      {!src && <User className="h-5 w-5 text-muted-foreground" />}
    </div>
  );
}