import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — TypeCraft" },
      { name: "description", content: "Choose a new password for your TypeCraft account." },
      { property: "og:title", content: "Set a new password — TypeCraft" },
      { property: "og:description", content: "Choose a new password for your TypeCraft account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<boolean | null>(null);

  useEffect(() => {
    if (window.location.hash.includes("type=recovery")) setRecovery(true);
    const { data } = supabase.auth.onAuthStateChange((event) => event === "PASSWORD_RECOVERY" && setRecovery(true));
    const t = setTimeout(() => setRecovery((r) => r ?? false), 1500);
    return () => { data.subscription.unsubscribe(); clearTimeout(t); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return void toast.error(error.message);
    toast.success("Password updated");
    void navigate({ to: "/grid", replace: true });
  };

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-12">
      <h1 className="text-center font-display text-4xl">Set a new password</h1>
      {recovery === false ? (
        <p className="text-center text-sm text-muted-foreground">This link has expired or was already used. Ask for a new one from the sign-in page.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="h-11" />
          </div>
          <Button type="submit" className="h-11 w-full" disabled={busy || !recovery}>{busy && <Loader2 className="animate-spin" />} Save password</Button>
        </form>
      )}
    </main>
  );
}
