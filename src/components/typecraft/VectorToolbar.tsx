// Floating/docked toolbar for TypeCraft's Vector Bézier Suite in Glyph Studio.
import {
  BoxSelect,
  CornerDownRight,
  Eraser,
  FlipHorizontal,
  FlipVertical,
  Hand,
  Lasso,
  Maximize,
  Minus,
  MousePointer2,
  PenTool,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Spline,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LASSO_THRESHOLD_MAX, LASSO_THRESHOLD_MIN, type CloseMode } from "@/lib/typecraft/lasso";
import { LAZY_RADIUS_MAX, LAZY_RADIUS_MIN } from "@/lib/typecraft/penSettings";
import type { PointType, VectorTool } from "@/lib/typecraft/vectorEditor";
import { cn } from "@/lib/utils";

export type StudioTool = "layout" | VectorTool;

type ToolDef = {
  id: StudioTool;
  label: string;
  shortcut: string;
  icon: React.ComponentType<{ className?: string }>;
};

const TOOLS: ToolDef[] = [
  { id: "layout", label: "Layout / Pan", shortcut: "H", icon: Hand },
  { id: "select", label: "Node Select & Box", shortcut: "V", icon: MousePointer2 },
  { id: "lasso", label: "Node Lasso", shortcut: "Q", icon: BoxSelect },
  { id: "lasso-fill", label: "Lasso Fill", shortcut: "L", icon: Lasso },
  { id: "pen", label: "Pen Tool", shortcut: "P", icon: PenTool },
  { id: "freeform", label: "Freeform Pen", shortcut: "F", icon: Pencil },
  { id: "curvature", label: "Curvature Pen", shortcut: "C", icon: Spline },
  { id: "add-anchor", label: "Add Anchor (+)", shortcut: "+", icon: Plus },
  { id: "delete-anchor", label: "Delete Anchor (-)", shortcut: "-", icon: Minus },
  { id: "convert-point", label: "Convert Point", shortcut: "K", icon: CornerDownRight },
];

type Props = {
  tool: StudioTool;
  onTool: (t: StudioTool) => void;
  selectedCount: number;
  canUndo: boolean;
  canRedo: boolean;
  pencilOnly: boolean;
  onPencilOnly: (b: boolean) => void;
  lassoCloseMode: CloseMode;
  onLassoCloseMode: (m: CloseMode) => void;
  lassoThreshold: number;
  onLassoThreshold: (n: number) => void;
  lassoErase: boolean;
  onLassoErase: (b: boolean) => void;
  lazyEnabled: boolean;
  onLazyEnabled: (b: boolean) => void;
  lazyRadius: number;
  onLazyRadius: (n: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onConvertSelected: (type: PointType) => void;
  onScaleSelected: (factor: number) => void;
  onRotateSelected: (deg: number) => void;
  onFlipSelected: (axis: "x" | "y") => void;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
};

export function VectorToolbar({
  tool,
  onTool,
  selectedCount,
  canUndo,
  canRedo,
  pencilOnly,
  onPencilOnly,
  lassoCloseMode,
  onLassoCloseMode,
  lassoThreshold,
  onLassoThreshold,
  lassoErase,
  onLassoErase,
  lazyEnabled,
  onLazyEnabled,
  lazyRadius,
  onLazyRadius,
  onUndo,
  onRedo,
  onConvertSelected,
  onScaleSelected,
  onRotateSelected,
  onFlipSelected,
  onDeleteSelected,
  onClearSelection,
}: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card p-1.5 shadow-sm touch-none select-none [-webkit-user-select:none]">
        <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Vector Bézier tools">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const active = tool === t.id;
            return (
              <Button
                key={t.id}
                type="button"
                size="sm"
                variant={active ? "default" : "ghost"}
                onClick={() => onTool(t.id)}
                title={`${t.label} (${t.shortcut})`}
                aria-label={t.label}
                aria-pressed={active}
                className={cn(
                  "h-11 gap-1.5 px-2.5 text-xs touch-none select-none [-webkit-user-select:none]",
                  active && "shadow-sm",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="hidden xl:inline">{t.label}</span>
              </Button>
            );
          })}
        </div>

        <div className="mx-1 h-5 w-px bg-border hidden sm:block" aria-hidden />

        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-11 touch-none select-none [-webkit-user-select:none]"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo vector edit (Ctrl/Cmd+Z)"
            aria-label="Undo vector edit"
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-11 touch-none select-none [-webkit-user-select:none]"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo vector edit (Ctrl/Cmd+Shift+Z)"
            aria-label="Redo vector edit"
          >
            <Redo2 className="size-4" />
          </Button>
        </div>

        <label className="ml-auto flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent/50 touch-none select-none [-webkit-user-select:none]">
          <Switch checked={pencilOnly} onCheckedChange={onPencilOnly} aria-label="Apple Pencil only mode" />
          <span className="whitespace-nowrap">Pencil only</span>
        </label>
      </div>

      {(tool === "lasso-fill" || tool === "freeform") && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/95 px-2.5 py-1.5 text-xs shadow-sm touch-none select-none [-webkit-user-select:none]">
          {tool === "lasso-fill" && (
            <>
              <span className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">Lasso close</span>
              <ToggleGroup
                type="single"
                value={lassoCloseMode}
                onValueChange={(v) => v && onLassoCloseMode(v as CloseMode)}
                variant="outline"
                aria-label="Studio lasso close mode"
              >
                <ToggleGroupItem value="always" className="h-11 px-2.5 text-xs">Close Always</ToggleGroupItem>
                <ToggleGroupItem value="far" className="h-11 px-2.5 text-xs">Close Far</ToggleGroupItem>
                <ToggleGroupItem value="off" className="h-11 px-2.5 text-xs">Close Off</ToggleGroupItem>
              </ToggleGroup>
              {lassoCloseMode === "far" && (
                <div className="flex min-h-11 items-center gap-2 px-1">
                  <span className="text-muted-foreground">Snap</span>
                  <Slider
                    value={[lassoThreshold]}
                    min={LASSO_THRESHOLD_MIN}
                    max={LASSO_THRESHOLD_MAX}
                    step={5}
                    onValueChange={([v]) => v !== undefined && onLassoThreshold(v)}
                    className="w-28"
                    aria-label="Studio lasso snap distance"
                  />
                  <span className="w-11 font-mono tabular-nums text-muted-foreground">{lassoThreshold} u</span>
                </div>
              )}
              <Button
                type="button"
                variant={lassoErase ? "destructive" : "outline"}
                className="h-11 gap-1.5 px-3 text-xs touch-manipulation"
                onClick={() => onLassoErase(!lassoErase)}
                aria-pressed={lassoErase}
              >
                <Eraser className="size-4" />
                <span>{lassoErase ? "Subtracting" : "Subtract"}</span>
              </Button>
            </>
          )}
          <label className="ml-auto flex min-h-11 cursor-pointer items-center gap-2 px-1 font-medium">
            <span>Rubber band</span>
            <Switch checked={lazyEnabled} onCheckedChange={onLazyEnabled} aria-label="Studio lazy rubber band stabilizer" />
          </label>
          {lazyEnabled && (
            <div className="flex min-h-11 items-center gap-2 px-1">
              <span className="text-muted-foreground">Radius</span>
              <Slider
                value={[lazyRadius]}
                min={LAZY_RADIUS_MIN}
                max={LAZY_RADIUS_MAX}
                step={5}
                onValueChange={([v]) => v !== undefined && onLazyRadius(v)}
                className="w-24"
                aria-label="Studio rubber band radius"
              />
              <span className="w-10 font-mono tabular-nums text-muted-foreground">{lazyRadius} u</span>
            </div>
          )}
        </div>
      )}

      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-proof/30 bg-card/95 px-2.5 py-1.5 text-xs shadow-sm touch-none select-none [-webkit-user-select:none]">
          <span className="font-mono text-[0.7rem] font-medium text-proof mr-1">
            {selectedCount} {selectedCount === 1 ? "node" : "nodes"} selected
          </span>
          <Button type="button" size="sm" variant="outline" className="h-9 px-2.5 text-xs" onClick={() => onConvertSelected("corner")}>
            Corner
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-9 px-2.5 text-xs" onClick={() => onConvertSelected("smooth")}>
            Smooth
          </Button>
          <div className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <Button type="button" size="icon" variant="outline" className="size-9" onClick={() => onScaleSelected(0.9)} title="Scale selected -10%" aria-label="Scale down">
            <ZoomOut className="size-3.5" />
          </Button>
          <Button type="button" size="icon" variant="outline" className="size-9" onClick={() => onScaleSelected(1.1)} title="Scale selected +10%" aria-label="Scale up">
            <ZoomIn className="size-3.5" />
          </Button>
          <Button type="button" size="icon" variant="outline" className="size-9" onClick={() => onRotateSelected(-15)} title="Rotate selected -15°" aria-label="Rotate counter-clockwise">
            <RotateCcw className="size-3.5" />
          </Button>
          <Button type="button" size="icon" variant="outline" className="size-9" onClick={() => onRotateSelected(15)} title="Rotate selected +15°" aria-label="Rotate clockwise">
            <RotateCw className="size-3.5" />
          </Button>
          <Button type="button" size="icon" variant="outline" className="size-9" onClick={() => onFlipSelected("x")} title="Flip horizontal" aria-label="Flip horizontal">
            <FlipHorizontal className="size-3.5" />
          </Button>
          <Button type="button" size="icon" variant="outline" className="size-9" onClick={() => onFlipSelected("y")} title="Flip vertical" aria-label="Flip vertical">
            <FlipVertical className="size-3.5" />
          </Button>
          <div className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <Button type="button" size="sm" variant="destructive" className="h-9 gap-1 px-2.5 text-xs" onClick={onDeleteSelected} title="Delete selected nodes (Backspace)">
            <Trash2 className="size-3.5" /> Delete
          </Button>
          <Button type="button" size="sm" variant="ghost" className="ml-auto h-9 gap-1 px-2.5 text-xs" onClick={onClearSelection}>
            <Maximize className="size-3.5" /> Deselect
          </Button>
        </div>
      )}
    </div>
  );
}
