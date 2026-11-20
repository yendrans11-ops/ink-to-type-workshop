// Saves and opens font projects in the signed-in user's account (font_projects table, owner-only access).
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { drawnGlyphCount, fromCloudData, toCloudData } from "./cloudData";
import type { ProjectData } from "./store";

export type CloudFont = { id: string; localId: string; name: string; glyphCount: number; updatedAt: string };

export async function listCloudFonts(): Promise<CloudFont[]> {
  const { data, error } = await supabase.from("font_projects").select("id, local_id, name, glyph_count, updated_at").order("updated_at", { ascending: false });
  if (error) throw error;
  return data.map((r) => ({ id: r.id, localId: r.local_id, name: r.name, glyphCount: r.glyph_count, updatedAt: r.updated_at }));
}

export async function saveToCloud(p: ProjectData, expectedUserId?: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to save to your account");
  if (expectedUserId && u.user.id !== expectedUserId) throw new Error("The account changed. Save again from your current account.");
  const { error } = await supabase.from("font_projects").upsert(
    {
      user_id: u.user.id,
      local_id: p.projectId,
      name: p.meta.familyName.trim() || "Untitled font",
      data: toCloudData(p) as unknown as Json,
      glyph_count: drawnGlyphCount(p),
    },
    { onConflict: "user_id,local_id" },
  );
  if (error) throw error;
}

export async function loadFromCloud(id: string): Promise<ProjectData> {
  const { data, error } = await supabase.from("font_projects").select("data").eq("id", id).single();
  if (error) throw error;
  return fromCloudData(data.data);
}

export async function deleteCloudFont(id: string): Promise<void> {
  const { error } = await supabase.from("font_projects").delete().eq("id", id);
  if (error) throw error;
}
