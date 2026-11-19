// The signed-in person's profile (display name + photo). Photos live in a private folder per user.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth-context";

export type Profile = { displayName: string; avatarUrl: string | null; avatarPath: string | null };

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Photo links from Google/Apple are used as-is; uploaded photos get a short-lived signed link. */
async function resolveAvatar(stored: string | null): Promise<string | null> {
  if (!stored) return null;
  if (/^https:\/\//.test(stored)) return stored;
  const { data } = await supabase.storage.from("avatars").createSignedUrl(stored, 60 * 60);
  return data?.signedUrl ?? null;
}

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["cloud", "profile", user?.id],
    enabled: !!user,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase.from("profiles").select("display_name, avatar_url").eq("id", user!.id).maybeSingle();
      if (error) throw error;
      const meta = user!.user_metadata as Record<string, unknown>;
      const name = data?.display_name ?? (typeof meta["full_name"] === "string" ? meta["full_name"] : null) ?? "";
      const stored = data?.avatar_url ?? null;
      return { displayName: name, avatarPath: stored, avatarUrl: await resolveAvatar(stored) };
    },
  });
}

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (!AVATAR_TYPES.includes(file.type)) throw new Error("Choose a JPG, PNG, WebP or GIF image");
  if (file.size > AVATAR_MAX_BYTES) throw new Error("That photo is larger than 2 MB");
  const ext = file.type.split("/")[1] ?? "jpg";
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;
  return path;
}

export async function saveProfile(userId: string, p: { displayName: string; avatarPath: string | null }): Promise<void> {
  const { error } = await supabase.from("profiles").upsert({ id: userId, display_name: p.displayName.trim().slice(0, 60) || null, avatar_url: p.avatarPath });
  if (error) throw error;
}

export const initialsOf = (name: string, email?: string | null) =>
  (name.trim() || email || "?")
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
