<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules

- Pre-export validation is a pure function in `src/lib/typecraft/preflight.ts`; errors block font download, warnings can be overridden — keeps the rules unit-testable and UI-independent.
- OpenType naming/style-linking rules live in pure `src/lib/typecraft/naming.ts`; `finalizeSfnt` in `font.ts` replaces opentype.js's name table and patches OS/2/head fields — opentype.js writes blank names, weight 500 and a fixed fontRevision, which real apps misread.
- `opentype.js` is listed in Vite `ssr.noExternal` — its CommonJS entry breaks named imports during SSR.
- Tamil syllables (கு, டி, க்ஷ …) are stored as glyph records keyed by append-only private ids from `src/lib/typecraft/tamil.ts`, exported unencoded and reached via a hand-written GSUB (`gsub.ts`, scripts DFLT/taml/tml2) — declaring tml2 makes browsers run the Indic shaper that reorders ெ ே ை; the live sandbox loads the same `buildOtf` bytes as the download so preview shaping matches installed fonts.
- Tamil syllable spacing lives in the project's `syllableSpacing` map (keyed by syllable text); `syllables.ts` decides what is adjustable — joined syllables use their glyph's bearings, letter+sign pairs become GPOS kern pairs in visual (post-reordering) order, pulli forms get extra advance — so preview and downloads apply identical spacing.
- Multiple font projects: the open one stays in the persisted main store; `library.ts` keeps every project as an IndexedDB snapshot plus an index (refreshed when the gallery opens or on switch), and switching flushes the store write immediately — so existing single-project saves keep working and a quick reload never reverts a switch.
- Template page formats (paper / iPad) are `PageSpec`s in `template.ts`; every layout carries its spec and uploads are read with the project's `templateFormat` — fiducial homography makes any page size work as long as slot geometry comes from the same spec.
- In-app drawing (`/draw`) stores pen strokes on the glyph record and rasterises them with the pure `strokesToTile` in `drawing.ts` into the same em-spanning tile a scan produces, then traces with Potrace — so drawn and scanned glyphs share one pipeline, Studio edits and export.
- The Draw page preview uses `fontCompiler.ts` (opentype.js straight from pen-stroke outlines: 500 px canvas em, baseline y=400, advance = lsb + bbox width + rsb), loaded with FontFace before tracing finishes. Tamil text still uses the full `buildOtf` font because only that font has the GSUB syllables — so drawn English letters show up instantly while Tamil keeps correct shaping.
- Accounts: one `AuthProvider` in `__root.tsx` owns the auth listener; saved fonts go to `font_projects` (owner-only RLS) as the `cloudData.ts` JSON — pen strokes kept, raster tiles dropped and rebuilt from strokes on load — so rows stay small and reopen editable.
- Download tiers: the pure `exportTier.ts` decides which characters a free download includes; `useFullExport` is the only place that knows whether the user paid — so checkout can be wired in later without touching the grid or download UI.
- SVG drawing guides fit measured shaped ink after fonts load, preserving the shared baseline; new Tamil joined-form ids are append-only — this prevents clipping and keeps saved glyph mappings stable.
