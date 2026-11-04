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

import { onMounted, onUnmounted } from "vue";

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

type LegacyMediaQueryList = Partial<
  Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">
> & {
  addListener?: (fn: () => void) => void;
  removeListener?: (fn: () => void) => void;
};

/** The ratio right now; ECharts' own default is the one read when zrender was first imported. */
export const currentDevicePixelRatio = (): number =>
  (typeof window !== "undefined" && window.devicePixelRatio) || 1;

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
    mql = ratioQuery(currentDevicePixelRatio());
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

/** Re-rasterizes a mounted canvas chart at `ratio` in place, keeping its instance, handlers and interaction state; returns whether it changed anything. */
export const applyDevicePixelRatio = (
  chart: { getZr?: () => unknown } | null | undefined,
  ratio: number,
): boolean => {
  // ECharts has no public setter for the ratio, so this updates zrender 6.1's canvas painter fields directly.
  const painter = (chart?.getZr?.() as { painter?: Partial<CanvasPainter> } | undefined)?.painter;
  if (!painter || painter.type !== "canvas" || painter.dpr === ratio) return false;
  const { getLayers, getWidth, getHeight, refresh } = painter;
  if (
    typeof getLayers !== "function" ||
    typeof getWidth !== "function" ||
    typeof getHeight !== "function" ||
    typeof refresh !== "function"
  ) {
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
  // Layers made later (hover, incremental) are built from painter.dpr, so setting it covers them too.
  painter.dpr = ratio;
  layers.forEach((layer) => {
    layer.dpr = ratio;
    layer.ctx.dpr = ratio;
    layer.resize(width, height);
  });
  refresh.call(painter, { paintAll: true });
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

export default useDevicePixelRatioChange;
