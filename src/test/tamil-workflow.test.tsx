import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as hb from "harfbuzzjs";
import { DrawPad } from "@/components/typecraft/DrawPad";
import { compileProject } from "@/lib/typecraft/compile";
import { strokesToPotraceTile, strokesToTile, unitsToPadY, type Stroke } from "@/lib/typecraft/drawing";
import { DEFAULT_METRICS, useProject } from "@/lib/typecraft/store";
import { ligatureByText } from "@/lib/typecraft/tamil";
import { buildTemplateLayout } from "@/lib/typecraft/template";
import { TILE, traceTile } from "@/lib/typecraft/trace";

describe("Pure Hand-Drawn Tamil workflow & iPad DrawPad", () => {
  afterEach(() => {
    cleanup();
    useProject.getState().clearGlyphs();
  });

  beforeAll(async () => {
    // Stub ResizeObserver & Canvas 2D getContext for JSDOM
    if (typeof globalThis.ResizeObserver === "undefined") {
      globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
    if (typeof HTMLCanvasElement !== "undefined") {
      HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    }
    const real = globalThis.process;
    vi.stubGlobal("process", { ...real, versions: { ...real.versions, node: undefined } });
    await import("esm-potrace-wasm");
    vi.stubGlobal("process", real);
  });

  it("renders DrawPad with >=150u ascender headroom, Tamil ghost reference, and explicit guide lines", () => {
    const { container } = render(
      <DrawPad
        strokes={[]}
        onStroke={() => {}}
        tool="pen"
        brush={70}
        smooth={0.7}
        penStyle="brush"
        pencilOnly={false}
        onPencil={() => {}}
        metrics={DEFAULT_METRICS}
        ghost="கீ"
        ghostTamil={true}
        ghostOpacity={0.2}
      />,
    );

    const svg = container.querySelector("svg[viewBox]");
    expect(svg).not.toBeNull();
    const vb = svg!.getAttribute("viewBox")!.split(" ").map(Number);
    // viewBox = [-80, -160, 1160, 1160] -> 160u above ascender (260u above capHeight) & 80u side headroom
    expect(vb[0]).toBeLessThanOrEqual(-80);
    expect(vb[1]).toBeLessThanOrEqual(-150);

    expect(screen.getByText(/Upper hook/i)).toBeInTheDocument();
    expect(screen.getByText(/Cap \/ Consonant/i)).toBeInTheDocument();
    expect(screen.getByText(/Baseline 0/i)).toBeInTheDocument();
    expect(screen.getByText(/Descender -200/i)).toBeInTheDocument();

    const ghostText = container.querySelector("text");
    expect(ghostText).not.toBeNull();
    expect(ghostText!.textContent).toBe("கீ");
    expect(ghostText!.style.fontFamily).toMatch(/Noto Sans Tamil|Mukta Malar/);
    expect(ghostText!.style.opacity).toBe("0.2");
  });

  it("cycles Tamil slots saving Stroke[] cleanly without loss and compiles live Tamil GSUB font", async () => {
    const layout = buildTemplateLayout(["tamil-consonants", "tamil-signs", "tamil-syllables"], "");
    const kaSlot = layout.slots.find((s) => s.cp === 0x0b95)!;
    const kiSlot = layout.slots.find((s) => s.cp === ligatureByText("கி")!.id)!;
    const kiiSlot = layout.slots.find((s) => s.cp === ligatureByText("கீ")!.id)!;
    const kuSlot = layout.slots.find((s) => s.cp === ligatureByText("கு")!.id)!;

    const strokeFor = (topY: number): Stroke => ({
      size: 65,
      smooth: 0.7,
      penStyle: "brush",
      pts: [
        0.25, unitsToPadY(0), 0.6,
        0.25, unitsToPadY(topY), 0.7,
        0.65, unitsToPadY(topY), 0.7,
        0.65, unitsToPadY(0), 0.6,
      ],
    });

    const store = useProject.getState();
    store.setCharsets(["tamil-consonants", "tamil-signs", "tamil-syllables"]);

    for (const [slot, topY] of [
      [kaSlot, 520],
      [kiSlot, 820],
      [kiiSlot, 900],
      [kuSlot, 550],
    ] as const) {
      const s = strokeFor(topY);
      store.drawGlyph(slot, strokesToTile([s]), [s]);
      const { tile, pad } = strokesToPotraceTile([s], TILE);
      const { contours, empty } = await traceTile(tile, store.preprocess, { weight: 0, smoothing: null, optimize: null }, TILE, pad);
      store.setTraced(slot.id, contours, empty);
    }

    const updated = useProject.getState();
    // All individually drawn syllables retain their exact raw Stroke[] records
    expect(updated.glyphs[kiSlot.id]?.strokes).toHaveLength(1);
    expect(updated.glyphs[kiiSlot.id]?.strokes).toHaveLength(1);
    expect(updated.glyphs[kuSlot.id]?.strokes).toHaveLength(1);

    const compiled = compileProject(updated);
    const otfBytes = compiled.build("otf");
    const font = new hb.Font(new hb.Face(new hb.Blob(otfBytes)));

    for (const sample of ["க", "கி", "கீ", "கு"]) {
      const buf = new hb.Buffer();
      buf.addText(sample);
      buf.guessSegmentProperties();
      hb.shape(font, buf);
      const infos = buf.getGlyphInfos();
      expect(infos).toHaveLength(1);
      expect(infos[0]!.codepoint).toBeGreaterThan(0);
    }
  });
});
