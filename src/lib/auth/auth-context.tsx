// One auth listener for the whole app: exposes the signed-in user and refreshes routes on sign-in/out.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthState = { user: User | null; ready: boolean; recovery: boolean };
const AuthContext = createContext<AuthState>({ user: null, ready: false, recovery: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ user: null, ready: false, recovery: false });

  useEffect(() => {
    let lastUserId: string | null = null;
    let initialized = false;
    const recoveryHint = window.location.hash.includes("type=recovery");
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user.id ?? null;
      if (initialized && lastUserId !== userId) {
        void queryClient.cancelQueries({ queryKey: ["cloud"] });
        queryClient.removeQueries({ queryKey: ["cloud"] });
      }
      lastUserId = userId;
      initialized = true;
      setState((prev) => ({ user: session?.user ?? null, ready: true, recovery: event === "PASSWORD_RECOVERY" || (event === "INITIAL_SESSION" && recoveryHint && !!session) || (event !== "SIGNED_OUT" && prev.recovery) }));
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      void router.invalidate();
      if (event !== "SIGNED_OUT") void queryClient.invalidateQueries();
      else queryClient.removeQueries({ queryKey: ["cloud"] });
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** Only same-site paths are allowed as a post-sign-in destination. */
export function safeNext(next: unknown, fallback = "/grid"): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : fallback;
}
