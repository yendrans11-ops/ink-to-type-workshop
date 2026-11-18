// One auth listener for the whole app: exposes the signed-in user and refreshes routes on sign-in/out.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthState = { user: User | null; ready: boolean };
const AuthContext = createContext<AuthState>({ user: null, ready: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ user: null, ready: false });

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ user: session?.user ?? null, ready: true });
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      void router.invalidate();
      if (event !== "SIGNED_OUT") void queryClient.invalidateQueries();
      else queryClient.removeQueries({ queryKey: ["cloud"] });
    });
    void supabase.auth.getSession().then(({ data }) => setState({ user: data.session?.user ?? null, ready: true }));
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** Only same-site paths are allowed as a post-sign-in destination. */
export function safeNext(next: unknown, fallback = "/grid"): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : fallback;
}
