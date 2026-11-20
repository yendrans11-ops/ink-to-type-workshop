import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function AccountSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const update = async (kind: "email" | "password") => {
    if (!user) return;
    setBusy(true);
    try {
      const result = kind === "email"
        ? await supabase.auth.updateUser({ email: email.trim() }, { emailRedirectTo: `${window.location.origin}/auth` })
        : await supabase.auth.updateUser({ password, current_password: current });
      if (result.error) throw result.error;
      toast.success(kind === "email" ? "Check your email to confirm the address change" : "Password updated");
      setCurrent(""); setPassword("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "The account could not be updated"); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={(value) => { if (!value) { setCurrent(""); setPassword(""); } onOpenChange(value); }}>
    <DialogContent className="max-h-[85dvh] max-w-md overflow-y-auto">
      <DialogHeader><DialogTitle>Account settings</DialogTitle><DialogDescription>{user?.email}</DialogDescription></DialogHeader>
      <form className="space-y-3 border-b pb-4" onSubmit={(e) => { e.preventDefault(); void update("email"); }}>
        <Label htmlFor="account-email">New email</Label>
        <Input id="account-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
        <Button className="h-11 w-full" disabled={busy}>Send confirmation</Button>
      </form>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void update("password"); }}>
        <Label htmlFor="account-current-password">Current password</Label>
        <Input id="account-current-password" type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="h-11" />
        <Label htmlFor="account-new-password">New password</Label>
        <Input id="account-new-password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
        <Button className="h-11 w-full" disabled={busy}>Change password</Button>
        <p className="text-xs text-muted-foreground">If you signed in with Google or Apple and have no password, use the password reset link on the sign-in page first.</p>
      </form>
    </DialogContent>
  </Dialog>;
}