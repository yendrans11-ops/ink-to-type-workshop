import { useMemo, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { FontMeta } from "@/lib/typecraft/font";
import { EMBEDDING, NAME_ID_LABELS, WEIGHTS, autoPostScriptName, resolveNames, standardStyleName, type Embedding } from "@/lib/typecraft/naming";
import { cn } from "@/lib/utils";

type TextKey = { [K in keyof FontMeta]: FontMeta[K] extends string ? K : never }[keyof FontMeta];

type Props = {
  meta: FontMeta;
  setMeta: (m: Partial<FontMeta>) => void;
  errors: Set<keyof FontMeta | undefined>;
  warnings: Set<keyof FontMeta | undefined>;
};

function Field({ id, label, nameId, hint, children }: { id: string; label: string; nameId?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {nameId && <span className="font-mono text-[0.65rem] text-muted-foreground">{nameId}</span>}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-proof">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function FontDetailsEditor({ meta, setMeta, errors, warnings }: Props) {
  const names = useMemo(() => resolveNames(meta), [meta]);
  const tone = (k: keyof FontMeta) => (errors.has(k) ? "border-destructive" : warnings.has(k) ? "border-proof" : undefined);

  const text = (key: TextKey, label: string, opts: { nameId?: string; placeholder?: string; hint?: string; type?: string } = {}) => (
    <Field id={`meta-${key}`} label={label} nameId={opts.nameId} hint={opts.hint}>
      <Input
        id={`meta-${key}`}
        type={opts.type}
        value={meta[key]}
        placeholder={opts.placeholder}
        aria-invalid={errors.has(key) || undefined}
        className={tone(key)}
        onChange={(e) => setMeta({ [key]: e.target.value })}
      />
    </Field>
  );

  // Weight and italic keep the style name in step unless the user typed a custom one.
  const setStyleFlags = (weightClass: number, italic: boolean) => {
    const autoStyle = standardStyleName(meta.weightClass, meta.italic);
    const custom = meta.styleName.trim() && meta.styleName.trim() !== autoStyle;
    setMeta({ weightClass, italic, ...(custom ? null : { styleName: standardStyleName(weightClass, italic) }) });
  };

  const year = new Date().getFullYear();

  return (
    <section className="space-y-6 rounded-lg border bg-card p-4 sm:p-5" aria-labelledby="font-details-title">
      <div>
        <h2 id="font-details-title" className="text-sm font-semibold">Font details</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Saved inside the font file. Apps use these to list, group and credit your font.</p>
      </div>

      <Group title="Name & style">
        {text("familyName", "Font name", { nameId: "ID 1 · 16", placeholder: "My Handwriting" })}
        {text("styleName", "Style", { nameId: "ID 2 · 17", placeholder: standardStyleName(meta.weightClass, meta.italic) })}
        <Field id="meta-weightClass" label="Weight" nameId="OS/2 weight">
          <Select value={String(meta.weightClass)} onValueChange={(v) => setStyleFlags(Number(v), meta.italic)}>
            <SelectTrigger id="meta-weightClass" className={cn("h-10", tone("weightClass"))}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEIGHTS.map((w) => (
                <SelectItem key={w.value} value={String(w.value)}>{w.value} · {w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="meta-italic" label="Italic" nameId="OS/2 · head">
          <div className={cn("flex h-10 items-center gap-3 rounded-md border px-3", tone("italic"))}>
            <Switch id="meta-italic" checked={meta.italic} onCheckedChange={(on) => setStyleFlags(meta.weightClass, on)} />
            <span className="text-sm text-muted-foreground">{meta.italic ? "Italic style" : "Upright style"}</span>
          </div>
        </Field>
        <div className="rounded-md bg-muted/60 p-3 text-xs sm:col-span-2" aria-live="polite">
          <p className="font-medium">How apps will list it</p>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Mac, Adobe, Figma</dt>
            <dd className="break-words"><strong>{names.family}</strong> → {names.subfamily}</dd>
            <dt className="text-muted-foreground">Word, older Windows</dt>
            <dd className="break-words"><strong>{names.legacyFamily}</strong> → {names.legacySubfamily}</dd>
          </dl>
        </div>
      </Group>

      <Group title="Credits">
        {text("designer", "Author", { nameId: "ID 9", placeholder: "Your name" })}
        {text("designerURL", "Author website", { nameId: "ID 12", placeholder: "https://", type: "url" })}
        {text("manufacturer", "Maker / foundry", { nameId: "ID 8", placeholder: "Studio or company" })}
        {text("manufacturerURL", "Maker website", { nameId: "ID 11", placeholder: "https://", type: "url" })}
        <Field id="meta-copyright" label="Copyright" nameId="ID 0">
          <div className="flex gap-2">
            <Input
              id="meta-copyright"
              value={meta.copyright}
              placeholder={`© ${year} ${meta.designer.trim() || "Your name"}`}
              aria-invalid={errors.has("copyright") || undefined}
              className={tone("copyright")}
              onChange={(e) => setMeta({ copyright: e.target.value })}
            />
            {!meta.copyright.trim() && (
              <Button type="button" variant="outline" className="h-10 shrink-0" onClick={() => setMeta({ copyright: `Copyright © ${year} ${meta.designer.trim() || meta.familyName.trim()}`.trim() })}>
                Fill in
              </Button>
            )}
          </div>
        </Field>
        {text("trademark", "Trademark", { nameId: "ID 7", placeholder: "Optional" })}
      </Group>

      <Group title="License & embedding">
        <Field id="meta-license" label="License" nameId="ID 13">
          <Textarea
            id="meta-license"
            rows={2}
            value={meta.license}
            placeholder="e.g. SIL Open Font License 1.1"
            aria-invalid={errors.has("license") || undefined}
            className={tone("license")}
            onChange={(e) => setMeta({ license: e.target.value })}
          />
        </Field>
        {text("licenseURL", "License link", { nameId: "ID 14", placeholder: "https://openfontlicense.org", type: "url" })}
        <Field id="meta-embedding" label="Embedding in documents" nameId="OS/2 fsType" hint={EMBEDDING[meta.embedding]?.hint}>
          <Select value={meta.embedding} onValueChange={(v) => setMeta({ embedding: v as Embedding })}>
            <SelectTrigger id="meta-embedding" className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(EMBEDDING) as Embedding[]).map((k) => (
                <SelectItem key={k} value={k}>{EMBEDDING[k].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Group>

      <Group title="Technical">
        {text("version", "Version", { nameId: "ID 5 · head", placeholder: "1.000", hint: "Raise it each time you re-export so apps replace the old copy." })}
        {text("postScriptName", "PostScript name", {
          nameId: "ID 6",
          placeholder: autoPostScriptName(names.family, names.subfamily),
          hint: "Leave empty to generate it. Used by design apps and PDFs.",
        })}
        {text("vendorId", "Vendor ID", { nameId: "OS/2 vendor", placeholder: "NONE", hint: "4-letter maker code; leave empty if you don't have one." })}
        {text("sampleText", "Sample text", { nameId: "ID 19", placeholder: "The quick brown fox" })}
        <div className="sm:col-span-2">
          <Field id="meta-description" label="Description" nameId="ID 10">
            <Textarea
              id="meta-description"
              rows={2}
              value={meta.description}
              placeholder="Made with TypeCraft"
              aria-invalid={errors.has("description") || undefined}
              className={tone("description")}
              onChange={(e) => setMeta({ description: e.target.value })}
            />
          </Field>
        </div>
      </Group>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group -ml-2 gap-1.5">
            <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
            Show name table ({names.records.length} records)
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 overflow-x-auto rounded-md border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/60 font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-2 py-1.5">ID</th><th className="px-2 py-1.5">Field</th><th className="px-2 py-1.5">Value</th></tr>
              </thead>
              <tbody>
                {names.records.map((r) => (
                  <tr key={r.nameID} className="border-t align-top">
                    <td className="px-2 py-1.5 font-mono">{r.nameID}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{NAME_ID_LABELS[r.nameID]}</td>
                    <td className="break-all px-2 py-1.5">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t px-2 py-1.5 font-mono text-[0.65rem] text-muted-foreground">
              Weight {names.weightClass} · fsSelection {names.fsSelection} · macStyle {names.macStyle} · fsType {names.fsType} · vendor “{names.vendorId}”
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
