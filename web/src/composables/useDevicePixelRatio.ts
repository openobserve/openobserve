// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { onMounted, onUnmounted, ref, type Ref } from "vue";

interface CanvasLayer {
  dpr: number;
  ctx: { dpr?: number };
  resize: (width: number, height: number) => void;
}

interface CanvasPainter {
  type: string;
  dpr: number;
  getLayers: () => Record<string, Partial<CanvasLayer> | undefined>;
  getWidth: () => number;
  getHeight: () => number;
  refresh: (opt: { paintAll: boolean }) => unknown;
}

type EChartsLike = { getZr?: () => unknown };

type LegacyMediaQueryList = Partial<
  Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">
> & {
  addListener?: (fn: () => void) => void;
  removeListener?: (fn: () => void) => void;
};

let warnedUnrecognisedPainter = false;

/** The ratio right now, never below 1 like zrender's own default, so zoomed-out charts and their exports keep full resolution. */
export const currentDevicePixelRatio = (): number => Math.max(rawDevicePixelRatio(), 1);

/** Whether one CSS pixel spans a non-whole number of device pixels (Windows display scaling, browser zoom), where the browser resamples canvases. */
export const isFractionalDevicePixelRatio = (ratio: number): boolean => !Number.isInteger(ratio);

/** Calls `onChange` with the new ratio each time it changes (display move, browser zoom); returns a stop function. */
export const watchDevicePixelRatio = (onChange: (ratio: number) => void): (() => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  let mql: LegacyMediaQueryList | null = null;

  const disarm = () => {
    if (typeof mql?.removeEventListener === "function")
      mql.removeEventListener("change", handleChange);
    else mql?.removeListener?.(handleChange);
    mql = null;
  };

  // A resolution query only flips once, when the ratio leaves the value it was built for, so it is rebuilt after each change.
  const arm = () => {
    // Armed on the raw ratio: a clamped one would never match below 1, so zoom changes there would go unseen.
    mql = ratioQuery(rawDevicePixelRatio());
    if (typeof mql?.addEventListener === "function") mql.addEventListener("change", handleChange);
    else mql?.addListener?.(handleChange);
  };

  function handleChange() {
    disarm();
    arm();
    onChange(currentDevicePixelRatio());
  }

  arm();
  return disarm;
};

/** Component-scoped `watchDevicePixelRatio`: listens while mounted, stops on unmount. */
export const useDevicePixelRatioChange = (onChange: (ratio: number) => void): void => {
  let stop = () => {};
  onMounted(() => {
    stop = watchDevicePixelRatio(onChange);
  });
  onUnmounted(() => stop());
};

/** Whether a chart's canvas should be shown pixelated, kept true only while it is rasterized at the current fractional ratio; call `sync` after each re-init. */
export const useChartPixelRatio = (
  getChart: () => EChartsLike | null | undefined,
): { pixelated: Ref<boolean>; sync: () => void } => {
  const pixelated = ref(isFractionalDevicePixelRatio(currentDevicePixelRatio()));
  // A skipped apply (SVG, echarts-gl) leaves a bitmap at the old ratio, which nearest-neighbour scaling would make jagged.
  const sync = () => {
    const ratio = currentDevicePixelRatio();
    pixelated.value =
      isFractionalDevicePixelRatio(ratio) && canvasPainterOf(getChart())?.dpr === ratio;
  };
  useDevicePixelRatioChange((ratio) => {
    applyDevicePixelRatio(getChart(), ratio);
    sync();
  });
  return { pixelated, sync };
};

/** Re-rasterizes a mounted canvas chart at `ratio` in place, keeping its instance, handlers and interaction state; returns whether it changed anything. */
export const applyDevicePixelRatio = (
  chart: EChartsLike | null | undefined,
  ratio: number,
): boolean => {
  // ECharts has no public setter for the ratio, so this updates zrender 6.1's canvas painter fields directly.
  const painter = canvasPainterOf(chart);
  if (!painter || painter.dpr === ratio) return false;
  const { getLayers, getWidth, getHeight, refresh } = painter;
  if (
    typeof getLayers !== "function" ||
    typeof getWidth !== "function" ||
    typeof getHeight !== "function" ||
    typeof refresh !== "function"
  ) {
    warnUnrecognisedPainter("its canvas painter lacks the methods it relies on");
    return false;
  }
  const layers = Object.values(getLayers.call(painter) ?? {}) as Partial<CanvasLayer>[];
  // An echarts-gl layer has no 2D context and sizes its viewport from painter.dpr, so the whole chart is left as is.
  if (
    !layers.every(
      (layer): layer is CanvasLayer => !!layer?.ctx && typeof layer.resize === "function",
    )
  ) {
    return false;
  }
  const width = getWidth.call(painter);
  const height = getHeight.call(painter);
  const previous = painter.dpr;
  const previousLayers = layers.map((layer) => ({ dpr: layer.dpr, ctxDpr: layer.ctx.dpr }));
  try {
    // Layers made later (hover, incremental) are built from painter.dpr, so setting it covers them too.
    painter.dpr = ratio;
    layers.forEach((layer) => {
      layer.dpr = ratio;
      layer.ctx.dpr = ratio;
      layer.resize(width, height);
    });
    refresh.call(painter, { paintAll: true });
  } catch (e) {
    // Restored so painter.dpr still differs from the next ratio and a later change retries.
    painter.dpr = previous;
    layers.forEach((layer, i) => {
      layer.dpr = previousLayers[i].dpr;
      layer.ctx.dpr = previousLayers[i].ctxDpr;
    });
    // Layers resized before the throw hold a cleared bitmap at the new ratio, so they are rebuilt at the old one.
    try {
      layers.forEach((layer) => layer.resize(width, height));
      refresh.call(painter, { paintAll: true });
    } catch {
      // The next init rebuilds the canvas; nothing more can be done in place.
    }
    warnUnrecognisedPainter(`re-rasterizing threw: ${String(e)}`);
    return false;
  }
  return true;
};

const ratioQuery = (ratio: number): LegacyMediaQueryList | null => {
  const standard: LegacyMediaQueryList | null =
    window.matchMedia(`(resolution: ${ratio}dppx)`) || null;
  if (standard?.matches) return standard;
  // Safari before 16 matches only the prefixed form of the ratio query.
  const prefixed: LegacyMediaQueryList | null =
    window.matchMedia(`(-webkit-device-pixel-ratio: ${ratio})`) || null;
  return prefixed?.matches ? prefixed : standard;
};

const rawDevicePixelRatio = (): number =>
  (typeof window !== "undefined" && window.devicePixelRatio) || 1;

const canvasPainterOf = (
  chart: EChartsLike | null | undefined,
): Partial<CanvasPainter> | undefined => {
  const painter = (chart?.getZr?.() as { painter?: Partial<CanvasPainter> } | undefined)?.painter;
  return painter?.type === "canvas" ? painter : undefined;
};

const warnUnrecognisedPainter = (reason: string) => {
  if (warnedUnrecognisedPainter) return;
  warnedUnrecognisedPainter = true;
  console.warn(`Could not re-rasterize a chart at the new device pixel ratio: ${reason}.`);
};
