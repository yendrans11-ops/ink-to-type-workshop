# Ink To Type Workshop

Act as a Principal Full-Stack Engineer and Typography Systems Architect. 

Build a web application (optimized for iPad touch and desktop) called "TypeCraft" that allows users to upload handwritten font templates, auto-extract and vectorize individual glyphs, provide an in-depth character adjustment editor, and generate installable TTF/OTF fonts.

### Core Tech Stack:

- Frontend: Next.js (React), Tailwind CSS, Lucide Icons, Shadcn UI

- Vectorization: `potrace-js` or WebAssembly Potrace (client-side raster-to-vector)

- Font Engine: `opentype.js` (client-side TrueType/OpenType font compilation)

- Canvas/Editing: HTML5 Canvas or Fabric.js for the glyph tuning editor

---

### Key Modules & Requirements:

1. TEMPLATE GENERATION & UPLOAD:

   - Provide a downloadable printable/digital template (grid layout with fiducial corner markers and labels for each character).

   - Allow users to upload their completed template (PNG, JPG, or PDF) drawn via iPad (Apple Pencil/Procreate) or physical scan.

   - Automatically detect grid cells, perspective-correct them, and slice each character into isolated bounding boxes.

2. RASTER-TO-VECTOR CONVERSION:

   - Convert cropped glyph bitmaps to clean SVG paths using Potrace.

   - Provide pre-processing options: Threshold/Binarization slider, Noise reduction, and Path smoothing tolerance.

3. CHARACTER ADJUSTMENT & CUSTOMIZATION STUDIO (CRUCIAL):

   For each individual glyph (and in batch mode), provide a visual tuning canvas with:

   - Metrics Guidelines: Movable lines for Ascender, Cap-Height, X-Height, Baseline, and Descender.

   - Spacing & Bearings: Drag handles for Left Side Bearing (LSB) and Right Side Bearing (RSB) to configure character width and letter-spacing.

   - Transform Controls: Scale, X/Y translation offset, rotation, and stroke weight/embolden.

   - Outlines & Path Tuning: Node preview with an option to simplify/smooth Bézier curves.

   - Granular Navigation: Character strip thumbnail ribbon at the bottom to easily switch between glyphs.

4. SCRIPT & UNICODE MAPPING:

   - Support Unicode mapping (configurable character sets: Basic Latin + Complex Indic scripts like Tamil vowels, consonants, and signs).

   - Allow re-assigning a drawn glyph to any Unicode codepoint.

5. LIVE TESTING & EXPORT:

   - Real-time interactive typing sandbox using the generated font via an in-memory `opentype.js` render.

   - Sliders for testing font-size, line-height, and tracking in the sandbox.

   - Single-click export to standard `.ttf` and `.otf` formats with custom font metadata (Font Name, Author, Version).

---

### Implementation Instructions:

1. Start by outlining the project structure.

2. Implement the client-side vectorization and `opentype.js` bridge first.

3. Build the interactive Character Adjustment Canvas with visual metric guidelines.

4. Ensure the UI is responsive, touch-friendly for iPad Safari, and runs completely in-browser without demanding server infrastructure.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/6220bf7c-b257-5a7b-8e4b-f51f48a8877b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
