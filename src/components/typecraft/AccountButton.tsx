// Header account control, driven by the live session: "Sign in", or the person's photo with a profile editor and sign-out.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/auth-context";
import { initialsOf, saveProfile, uploadAvatar, useProfile } from "@/lib/auth/profile";

export function AccountButton() {
  const { user, ready } = useAuth();
  const profile = useProfile();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  if (!ready) return <div className="size-10 shrink-0" aria-hidden />;
  if (!user)
    return (
      <Button asChild variant="outline" className="h-10 shrink-0">
        <Link to="/auth" search={{}}>Sign in</Link>
      </Button>
    );
  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", search: {}, replace: true });
  };
  const name = profile.data?.displayName ?? "";
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-proof" aria-label="Account">
            <Avatar className="size-10 border">
              {profile.data?.avatarUrl && <AvatarImage src={profile.data.avatarUrl} alt="" />}
              <AvatarFallback className="bg-card text-sm">{initialsOf(name, user.email)}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="space-y-0.5">
            <span className="block truncate">{name || "Your account"}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-11" onSelect={() => setEditing(true)}><UserRound /> Edit profile</DropdownMenuItem>
          <DropdownMenuItem className="min-h-11" onSelect={() => void signOut()}><LogOut /> Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog open={editing} onOpenChange={setEditing} />
    </>
  );
}

function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const profile = useProfile();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(profile.data?.displayName ?? "");
    setFile(null);
    setPreview(null);
  }, [open, profile.data]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (!user) return null;
  const save = async () => {
    setBusy(true);
    try {
      const avatarPath = file ? await uploadAvatar(user.id, file) : (profile.data?.avatarPath ?? null);
      await saveProfile(user.id, { displayName: name, avatarPath });
      await queryClient.invalidateQueries({ queryKey: ["cloud", "profile"] });
      toast.success("Profile saved");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save your profile");
    } finally {
      setBusy(false);
    }
  };
  const shown = preview ?? profile.data?.avatarUrl ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-normal">Your profile</DialogTitle>
          <DialogDescription>Your name and photo appear on your account.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <Avatar className="size-24 border">
            {shown && <AvatarImage src={shown} alt="" />}
            <AvatarFallback className="bg-card text-2xl">{initialsOf(name, user.email)}</AvatarFallback>
          </Avatar>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFile(f);
              setPreview(URL.createObjectURL(f));
            }}
          />
          <Button variant="outline" className="h-11" onClick={() => fileRef.current?.click()}><Camera /> {shown ? "Change photo" : "Add photo"}</Button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="display-name">Name</Label>
          <Input id="display-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-11" autoComplete="name" />
        </div>
        <DialogFooter>
          <Button className="h-11 w-full" onClick={() => void save()} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Save profile</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
