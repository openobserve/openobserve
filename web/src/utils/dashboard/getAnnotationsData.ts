import { toZonedTime } from "date-fns-tz";
import { chartMarkerColor, HEX_RE } from "@/utils/chartTheme";
import type { QueryAnnotationMarker } from "@/ts/interfaces/dashboard";

/** A manual (timed) or query-sourced annotation; only a query-sourced one carries `source`. */
interface AnnotationMark {
  title?: string;
  start_time?: number | null;
  end_time?: number | null;
  source?: QueryAnnotationMarker["source"];
}

/** The label ECharts renders on a mark; `formatter`/`distance` are absent once `label.show` is false. */
interface MarkLabel {
  show: boolean;
  formatter?: string;
  distance?: number;
}

interface MarkLineStyle {
  symbol: string[];
  symbolSize: number;
  label: { show: false };
  lineStyle: { color: string; type: string; width: number };
  itemStyle: { color: string };
}

/** A tiled hatch image when canvas is available, else a flat tinted/translucent fill. */
type MarkAreaFill =
  { color: { image: HTMLCanvasElement; repeat: string } } | { color: string; opacity?: number };

interface MarkAreaStyle {
  label: { show: false };
  itemStyle: MarkAreaFill & { borderColor: string; borderWidth: number };
}

interface MarkLineEntry extends Partial<Omit<MarkLineStyle, "label" | "symbol">> {
  symbol?: string[];
  name?: string;
  type: "xAxis";
  xAxis: Date;
  label: MarkLabel;
  annotationDetails: AnnotationMark;
}

interface MarkAreaPoint {
  name?: string;
  label?: MarkLabel;
  xAxis: Date;
  annotationDetails: AnnotationMark;
  itemStyle?: MarkAreaStyle["itemStyle"];
}

type MarkAreaEntry = [MarkAreaPoint, MarkAreaPoint];

// Query markers can number in the hundreds, so their titles live in the tooltip rather than on the line.
const queryMarkLineStyle = (color: string): MarkLineStyle => ({
  symbol: ["none", "circle"],
  symbolSize: 6,
  label: { show: false },
  lineStyle: { color, type: "solid", width: 1.5 },
  itemStyle: { color },
});

const HATCH_TILE = 8;
// Caps hatchTiles below so a long-lived tab cycling through custom colors can't grow it forever.
const HATCH_TILE_CACHE_LIMIT = 32;
const hatchTiles = new Map<string, HTMLCanvasElement | null>();

const cacheHatchTile = (color: string, tile: HTMLCanvasElement | null) => {
  hatchTiles.delete(color);
  if (hatchTiles.size >= HATCH_TILE_CACHE_LIMIT) {
    const oldest = hatchTiles.keys().next().value;
    if (oldest !== undefined) hatchTiles.delete(oldest);
  }
  hatchTiles.set(color, tile);
};

// A flat tint vanishes over an area fill of similar lightness; diagonal stripes read over any fill.
const hatchTile = (color: string): HTMLCanvasElement | null => {
  if (hatchTiles.has(color)) {
    const cached = hatchTiles.get(color) ?? null;
    // Re-insert so the Map's iteration order tracks recency, making the oldest key evictable.
    cacheHatchTile(color, cached);
    return cached;
  }
  const canvas = typeof document === "undefined" ? null : document.createElement("canvas");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) {
    cacheHatchTile(color, null);
    return null;
  }
  canvas.width = HATCH_TILE;
  canvas.height = HATCH_TILE;
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, HATCH_TILE, HATCH_TILE);
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // The main diagonal plus its two corner stubs, so neighbouring tiles join into unbroken stripes.
  [
    [0, HATCH_TILE, HATCH_TILE, 0],
    [-1, 1, 1, -1],
    [HATCH_TILE - 1, HATCH_TILE + 1, HATCH_TILE + 1, HATCH_TILE - 1],
  ].forEach(([x1, y1, x2, y2]) => {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  });
  ctx.stroke();
  cacheHatchTile(color, canvas);
  return canvas;
};

// The fill carries its own alpha so the edge lines stay fully opaque; without a canvas it falls back to a tint.
const queryMarkAreaFill = (color: string): MarkAreaFill => {
  const tile = hatchTile(color);
  if (tile) return { color: { image: tile, repeat: "repeat" } };
  return HEX_RE.test(color) ? { color: `${color}38` } : { color, opacity: 0.22 };
};

const queryMarkAreaStyle = (color: string): MarkAreaStyle => ({
  label: { show: false },
  itemStyle: { ...queryMarkAreaFill(color), borderColor: color, borderWidth: 1 },
});

export const getAnnotationsData = (
  annotations: { value?: AnnotationMark[] } | null | undefined,
  timezone: string,
) => {
  const markLines: MarkLineEntry[] = [];
  const markAreas: MarkAreaEntry[] = [];

  annotations?.value?.forEach((annotation) => {
    // Lightened only when the saved colour would otherwise blend into a dark canvas.
    const rawColor: string | undefined = annotation.source?.color;
    const sourceColor = rawColor ? chartMarkerColor(rawColor) : rawColor;
    if (annotation.start_time && annotation.end_time) {
      markAreas.push([
        {
          name: annotation.title,
          label: { show: true, formatter: annotation.title, distance: 0.2 },
          xAxis: toZonedTime(new Date(annotation.start_time / 1000), timezone),
          annotationDetails: annotation,
          ...(sourceColor ? queryMarkAreaStyle(sourceColor) : {}),
        },
        {
          xAxis: toZonedTime(new Date(annotation.end_time / 1000), timezone),
          annotationDetails: annotation,
        },
      ]);
    } else if (annotation.start_time) {
      markLines.push({
        symbol: ["circle", "triangle"],
        name: annotation.title,
        type: "xAxis",
        xAxis: toZonedTime(new Date(annotation.start_time / 1000), timezone),
        label: { show: true, formatter: annotation.title, distance: 0.2 },
        annotationDetails: annotation,
        ...(sourceColor ? queryMarkLineStyle(sourceColor) : {}),
      });
    }
  });

  return { markLines, markAreas };
};
