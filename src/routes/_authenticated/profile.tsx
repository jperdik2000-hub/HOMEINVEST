import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile — Poker Club" }] }),
  component: MyProfile,
});

function MyProfile() {
  const navigate = useNavigate();
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setId(data.user.id);
        navigate({ to: "/players/$id", params: { id: data.user.id }, replace: true });
      }
    });
  }, [navigate]);

  return <AppShell><div className="text-muted-foreground">Loading profile…</div></AppShell>;
}