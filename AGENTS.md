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
