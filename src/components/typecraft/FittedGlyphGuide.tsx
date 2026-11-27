import { useEffect, useRef, useState } from "react";

/** Measure the actual shaped ink, not character count: Tamil signs and conjuncts have very different widths. */
export function FittedGlyphGuide({
  text,
  baseline,
  fontSize,
  tamil = false,
  headroomTop = -80,
  className,
  opacity,
}: {
  text: string;
  baseline: number;
  fontSize: number;
  tamil?: boolean;
  headroomTop?: number;
  className?: string | undefined;
  opacity?: number | undefined;
}) {
  const ref = useRef<SVGTextElement>(null);
  const [transform, setTransform] = useState<string>();
  useEffect(() => {
    let disposed = false;
    const fit = () => {
      const el = ref.current;
      if (!el || disposed || typeof el.getBBox !== "function") return;
      const b = el.getBBox();
      if (!b.width || !b.height) return;
      const above = Math.max(0, baseline - b.y);
      const below = Math.max(0, b.y + b.height - baseline);
      const scale = Math.min(
        1,
        920 / b.width,
        above ? (baseline - headroomTop) / above : 1,
        below ? (960 - baseline) / below : 1,
      );
      setTransform(`translate(500 ${baseline}) scale(${scale}) translate(${-b.x - b.width / 2} ${-baseline})`);
    };
    fit();
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (fonts) {
      void fonts.ready.then(fit);
      fonts.addEventListener("loadingdone", fit);
    }
    return () => {
      disposed = true;
      fonts?.removeEventListener("loadingdone", fit);
    };
  }, [text, baseline, fontSize, headroomTop]);
  return (
    <g transform={transform}>
      <text
        ref={ref}
        x={500}
        y={baseline}
        textAnchor="middle"
        fontSize={fontSize}
        className={className}
        style={{
          fontFamily: tamil ? '"Noto Sans Tamil", "Mukta Malar", var(--font-sans)' : "var(--font-sans)",
          opacity: opacity !== undefined ? opacity : undefined,
        }}
      >
        {text}
      </text>
    </g>
  );
}