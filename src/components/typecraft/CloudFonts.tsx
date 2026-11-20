// Account saving: save the open font to your account and reopen saved fonts on any device.
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, CloudUpload, FolderOpen, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/auth/auth-context";
import { deleteCloudFont, listCloudFonts, loadFromCloud, saveToCloud } from "@/lib/typecraft/cloud";
import { openProjectData } from "@/lib/typecraft/library";
import { projectSnapshot, useProject } from "@/lib/typecraft/store";
import { createSaveQueue } from "@/lib/typecraft/saveQueue";

type Status = "idle" | "saving" | "saved" | "error";

/** Saves the open project to the account; `schedule` debounces so a burst of edits makes one save. */
export function useCloudSave() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("idle");
  const owner = useRef(user?.id ?? null);
  owner.current = user?.id ?? null;
  const queue = useRef<ReturnType<typeof createSaveQueue<ReturnType<typeof projectSnapshot>>> | null>(null);
  if (!queue.current) queue.current = createSaveQueue(async (snapshot, userId) => {
    if (owner.current !== userId) return;
    setStatus("saving");
    await saveToCloud(snapshot, userId);
    if (owner.current === userId) {
      setStatus("saved");
      void queryClient.invalidateQueries({ queryKey: ["cloud", "fonts", userId] });
    }
  }, () => owner.current);
  const failed = (e: unknown) => { setStatus("error"); toast.error(e instanceof Error ? e.message : "Couldn't save to your account"); };
  const saveNow = async () => {
    if (!user) return;
    try { await queue.current?.save(projectSnapshot(useProject.getState()), user.id); } catch (e) { failed(e); }
  };
  const schedule = () => {
    if (!user) return;
    queue.current?.schedule(projectSnapshot(useProject.getState()), user.id, failed);
  };
  useEffect(() => { queue.current?.cancel(); setStatus("idle"); return () => queue.current?.cancel(); }, [user?.id]);
  return { signedIn: !!user, status, saveNow, schedule };
}

export function CloudBar({ save }: { save: ReturnType<typeof useCloudSave> }) {
  const { ready } = useAuth();
  if (!ready) return null;
  if (!save.signedIn)
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
        <Cloud className="size-4 text-muted-foreground" aria-hidden />
        <span className="mr-auto text-muted-foreground">Your drawings are kept on this device.</span>
        <Button asChild size="sm" variant="outline" className="h-10"><Link to="/auth" search={{ next: "/grid" }}>Sign in to save to your account</Link></Button>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-auto flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
        {save.status === "saving" ? <Loader2 className="size-4 animate-spin" /> : <Cloud className="size-4" />}
        {save.status === "saving" ? "Saving to your account…" : save.status === "saved" ? "Saved to your account" : save.status === "error" ? "Not saved — try again" : "Saves to your account as you draw"}
      </span>
      <Button variant="outline" className="h-10" onClick={() => void save.saveNow()} disabled={save.status === "saving"}><CloudUpload /> Save now</Button>
      <SavedFonts />
    </div>
  );
}

function SavedFonts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const currentId = useProject((s) => s.projectId);
  const fonts = useQuery({ queryKey: ["cloud", "fonts", user?.id], queryFn: listCloudFonts, enabled: open && !!user });

  const openFont = async (id: string) => {
    try {
      await openProjectData(await loadFromCloud(id));
      setOpen(false);
      toast.success("Font opened");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open that font");
    }
  };
  const remove = async (id: string) => {
    try {
      await deleteCloudFont(id);
      void queryClient.invalidateQueries({ queryKey: ["cloud", "fonts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete that font");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-10"><FolderOpen /> Your saved fonts</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        {fonts.isPending ? (
          <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</p>
        ) : fonts.isError ? (
          <p className="p-3 text-sm text-destructive">Couldn't load your fonts.</p>
        ) : !fonts.data.length ? (
          <p className="p-3 text-sm text-muted-foreground">Nothing saved yet. Draw a character and it saves here.</p>
        ) : (
          <ul className="space-y-1">
            {fonts.data.map((f) => (
              <li key={f.id} className="flex items-center gap-1">
                <Button variant="ghost" type="button" onClick={() => void openFont(f.id)} className="h-auto min-h-11 min-w-0 flex-1 flex-col items-start rounded-md px-2 py-1 text-left">
                  <span className="w-full truncate text-sm font-medium">{f.name}{f.localId === currentId && <span className="ml-1.5 text-xs font-normal text-proof">open</span>}</span>
                  <span className="text-xs text-muted-foreground">{f.glyphCount} characters · {new Date(f.updatedAt).toLocaleDateString()}</span>
                </Button>
                <Button size="icon" variant="ghost" className="size-11 shrink-0" onClick={() => void remove(f.id)} aria-label={`Delete ${f.name} from your account`}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
