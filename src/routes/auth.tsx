import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { safeNext, useAuth } from "@/lib/auth/auth-context";

const NEXT_KEY = "typecraft-auth-next";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { next?: string } => (typeof s["next"] === "string" ? { next: s["next"] } : {}),
  head: () => ({
    meta: [
      { title: "Sign in — TypeCraft" },
      { name: "description", content: "Sign in to save your handwriting fonts to your account and open them on any device." },
      { property: "og:title", content: "Sign in — TypeCraft" },
      { property: "og:description", content: "Save your handwriting fonts to your account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

const GoogleG = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>
);

function AuthPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { user, ready } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  // Signed in (form, Google/Apple popup, or returning from a redirect): go where the user was headed.
  useEffect(() => {
    if (!ready || !user) return;
    const stored = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
    void navigate({ to: safeNext(search.next ?? stored), replace: true });
  }, [ready, user, search.next, navigate]);

  const social = async (provider: "google" | "apple") => {
    setBusy(true);
    try {
      sessionStorage.setItem(NEXT_KEY, safeNext(search.next));
      const r = await lovable.auth.signInWithOAuth(provider, { redirect_uri: `${window.location.origin}/auth` });
      if (r.error) throw new Error(r.error.message || "Sign-in didn't finish");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Sign-in didn't finish"); }
    finally { setBusy(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        sessionStorage.setItem(NEXT_KEY, safeNext(search.next));
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth`, data: { display_name: name.trim() || undefined } },
        });
        if (error) throw error;
        if (!data.session) setSent(`We sent a confirmation link to ${email}. Open it to finish creating your account.`);
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        setSent(`If ${email} has an account, a link to set a new password is on its way.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-12">
      <div className="text-center">
        <h1 className="font-display text-4xl">{mode === "signup" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Welcome back"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Save your fonts to your account and open them on your iPad or computer.</p>
      </div>

      {sent ? (
        <div className="space-y-4 rounded-lg border bg-card p-5 text-center">
          <p className="text-sm">{sent}</p>
          <Button variant="outline" className="h-11 w-full" onClick={() => { setSent(null); setMode("signin"); }}>Back to sign in</Button>
        </div>
      ) : (
        <>
          {mode !== "forgot" && (
            <div className="flex flex-col gap-2">
              <Button disabled={busy} type="button" variant="outline" className="h-11 w-full" onClick={() => void social("google")}>
                <GoogleG /> Continue with Google
              </Button>
              <Button disabled={busy} type="button" className="h-11 w-full" onClick={() => void social("apple")}>
                Continue with Apple
              </Button>
              <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or with email<span className="h-px flex-1 bg-border" /></div>
            </div>
          )}

          {mode !== "forgot" && (
            <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
              <TabsList className="grid h-11 w-full grid-cols-2">
                <TabsTrigger value="signin" className="h-9">Sign in</TabsTrigger>
                <TabsTrigger value="signup" className="h-9">Create account</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="h-11" maxLength={60} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="h-11" />
            </div>
            {mode !== "forgot" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {mode === "signin" && <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={() => setMode("forgot")}>Forgot password?</button>}
                </div>
                <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} className="h-11" />
              </div>
            )}
            <Button type="submit" className="h-11 w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
            </Button>
            {mode === "forgot" && <Button type="button" variant="ghost" className="h-11 w-full" onClick={() => setMode("signin")}>Back to sign in</Button>}
          </form>
        </>
      )}
    </main>
  );
}
