import { Minus, Plus } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  className?: string;
  disabled?: boolean;
};

export function ParamSlider({ label, value, min, max, step = 1, unit = "", hint, format, onChange, onCommit, className, disabled }: Props) {
  const nudge = (dir: number) => {
    const v = Math.min(max, Math.max(min, +(value + dir * step).toFixed(4)));
    onChange(v);
    onCommit?.(v);
  };
  return (
    <div className={cn("space-y-0.5", disabled && "opacity-50", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium leading-tight">{label}</div>
          {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
        </div>
        <div className="flex shrink-0 items-center rounded-md border bg-card">
          <button type="button" disabled={disabled} onClick={() => nudge(-1)} className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground" aria-label={`Decrease ${label}`}>
            <Minus className="size-3.5" />
          </button>
          <span className="min-w-[4.25rem] text-center font-mono text-xs tabular-nums">
            {format ? format(value) : value}
            {unit}
          </span>
          <button type="button" disabled={disabled} onClick={() => nudge(1)} className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground" aria-label={`Increase ${label}`}>
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={!!disabled}
        onValueChange={([v]) => v !== undefined && onChange(v)}
        onValueCommit={([v]) => v !== undefined && onCommit?.(v)}
        aria-label={label}
      />
    </div>
  );
}
