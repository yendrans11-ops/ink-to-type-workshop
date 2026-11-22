import { useEffect, useRef, useState } from "react";

/** Measure the actual shaped ink, not character count: Tamil signs and conjuncts have very different widths. */
export function FittedGlyphGuide({
  text,
  baseline,
  fontSize,
  className,
  opacity,
}: {
  text: string;
  baseline: number;
  fontSize: number;
  className?: string | undefined;
  opacity?: number | undefined;
}) {
  const ref = useRef<SVGTextElement>(null);
  const [transform, setTransform] = useState<string>();
  useEffect(() => {
    let disposed = false;
    const fit = () => {
      const el = ref.current;
      if (!el || disposed) return;
      const b = el.getBBox();
      if (!b.width || !b.height) return;
      const above = Math.max(0, baseline - b.y);
      const below = Math.max(0, b.y + b.height - baseline);
      const scale = Math.min(1, 820 / b.width, above ? (baseline - 80) / above : 1, below ? (920 - baseline) / below : 1);
      setTransform(`translate(500 ${baseline}) scale(${scale}) translate(${-b.x - b.width / 2} ${-baseline})`);
    };
    fit();
    void document.fonts.ready.then(fit);
    document.fonts.addEventListener("loadingdone", fit);
    return () => { disposed = true; document.fonts.removeEventListener("loadingdone", fit); };
  }, [text, baseline, fontSize]);
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
          fontFamily: "var(--font-sans)",
          opacity: opacity !== undefined ? opacity : undefined,
        }}
      >
        {text}
      </text>
    </g>
  );
}