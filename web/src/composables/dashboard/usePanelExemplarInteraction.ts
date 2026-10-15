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

import { onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import {
  EXEMPLAR_SERIES_ID,
  exemplarY,
  type ExemplarPlaceY,
} from "@/utils/dashboard/exemplars/applyExemplarSeries";
import type { useExemplarTraceLookup } from "@/composables/dashboard/useExemplarTraceLookup";
import type { ExemplarMarker, ExemplarPoint, TraceVerdict } from "@/ts/interfaces/exemplars";

/** Hover intent before a card starts its trace lookup, so a pointer sweep costs nothing. */
export const EXEMPLAR_LOOKUP_DWELL_MS = 200;
/** Grace period that lets the pointer travel from a marker into its card. */
export const EXEMPLAR_CARD_CLOSE_MS = 150;

interface EChartsLike {
  getModel?: () => {
    getComponent: (
      type: string,
      index: number,
    ) => { axis?: { scale?: { getExtent: () => number[] } } } | undefined;
  };
  convertToPixel?: (finder: Record<string, unknown>, value: number[]) => number[] | undefined;
  dispatchAction?: (action: Record<string, unknown>) => void;
  setOption?: (option: Record<string, unknown>) => void;
  getDom?: () => HTMLElement;
}

interface ExemplarEventParams {
  seriesId?: string;
  data?: { exemplar?: { id?: string } };
  event?: { event?: { pointerType?: string; type?: string } };
}

interface InteractionArgs {
  chartRendererRef: Ref<{ chart?: EChartsLike | null } | null>;
  markers: Ref<ExemplarMarker[]>;
  seriesExtent: Ref<[number, number]>;
  windowMs: Ref<[number, number]>;
  lookup: ReturnType<typeof useExemplarTraceLookup>;
  toChartX: (tsMs: number) => number;
  navigate: (marker: ExemplarMarker, verdict: TraceVerdict) => void;
  placeY?: ExemplarPlaceY;
}

const sameExtent = (a: [number, number], b: number[] | undefined): boolean =>
  !!b && a[0] === b[0] && a[1] === b[1];

const isExemplarEvent = (params: ExemplarEventParams | undefined): boolean =>
  params?.seriesId === EXEMPLAR_SERIES_ID;

const isTouch = (params: ExemplarEventParams): boolean => {
  const event = params?.event?.event;
  return event?.pointerType === "touch" || !!event?.type?.startsWith("touch");
};

/** Owns marker extents, pixel positions, the hover card and the click-to-trace flow. */
export function usePanelExemplarInteraction(args: InteractionArgs) {
  const { chartRendererRef, markers, seriesExtent, windowMs, lookup, toChartX, navigate, placeY } =
    args;

  const yExtent = ref<[number, number]>([...seriesExtent.value]);
  const xExtent = ref<[number, number]>([...windowMs.value]);
  const points = shallowRef<ExemplarPoint[]>([]);
  const activeMarker = shallowRef<ExemplarMarker | null>(null);
  const cardAnchor = shallowRef<DOMRect | null>(null);
  const verdict = shallowRef<TraceVerdict>({ state: "none" });
  const cardHovered = ref(false);
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  // Only a data extent that escapes the painted axis resets it; `finished` narrows it back, so steady refreshes cause no extra paint.
  watch(seriesExtent, (next) => {
    const [min, max] = yExtent.value;
    const unknown = !Number.isFinite(min) || !Number.isFinite(max);
    if (unknown || next[0] < min || next[1] > max) yExtent.value = [next[0], next[1]];
  });
  watch(windowMs, (next) => {
    if (!sameExtent(xExtent.value, next)) xExtent.value = [next[0], next[1]];
  });

  const chart = (): EChartsLike | null | undefined => chartRendererRef.value?.chart;

  // Null while the painted option has no exemplar series yet, so no marker is published at 0,0.
  const pointOf = (
    marker: ExemplarMarker,
    c: EChartsLike | null | undefined,
  ): ExemplarPoint | null => {
    const { y, clamped, placement } = exemplarY(marker, yExtent.value, placeY);
    let pixel: number[] | undefined;
    try {
      pixel = c?.convertToPixel?.({ seriesId: EXEMPLAR_SERIES_ID }, [toChartX(marker.tsMs), y]);
    } catch {
      pixel = undefined;
    }
    if (!pixel || !Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1])) return null;
    return { marker, xPx: pixel[0], yPx: pixel[1], clamped, placement };
  };

  const samePoints = (next: ExemplarPoint[]): boolean =>
    next.length === points.value.length &&
    next.every((p, i) => {
      const prev = points.value[i];
      return (
        prev.marker === p.marker &&
        prev.xPx === p.xPx &&
        prev.yPx === p.yPx &&
        prev.clamped === p.clamped &&
        prev.placement === p.placement
      );
    });

  /** Pins the hidden axes to the primary axes' rendered extents; updates only on change to avoid a render loop. */
  const onFinished = () => {
    const c = chart();
    const model = c?.getModel?.();
    const x = model?.getComponent("xAxis", 0)?.axis?.scale?.getExtent();
    const y = model?.getComponent("yAxis", 0)?.axis?.scale?.getExtent();
    let moved = false;
    if (x && x.length === 2 && !sameExtent(xExtent.value, x)) {
      xExtent.value = [x[0], x[1]];
      moved = true;
    }
    if (y && y.length === 2 && !sameExtent(yExtent.value, y)) {
      yExtent.value = [y[0], y[1]];
      moved = true;
    }
    // A pinned extent repaints the markers, so pixels read now would be stale; the next paint publishes them.
    if (moved && markers.value.length) return;
    const next = markers.value.map((m) => pointOf(m, c));
    if (next.some((p) => p === null)) return;
    const resolved = next as ExemplarPoint[];
    if (!samePoints(resolved)) points.value = resolved;
  };

  const clearTimers = () => {
    if (dwellTimer) clearTimeout(dwellTimer);
    if (closeTimer) clearTimeout(closeTimer);
    dwellTimer = null;
    closeTimer = null;
  };

  const suppressAxisTooltip = (on: boolean) => {
    const c = chart();
    if (on) c?.dispatchAction?.({ type: "hideTip" });
    c?.setOption?.({ tooltip: { triggerOn: on ? "none" : "mousemove|click" } });
  };

  const anchorFor = (marker: ExemplarMarker): DOMRect | null => {
    const dom = chart()?.getDom?.();
    const rect = dom?.getBoundingClientRect?.();
    if (!rect) return null;
    const point = points.value.find((p) => p.marker.id === marker.id) ?? pointOf(marker, chart());
    if (!point) return null;
    return new DOMRect(rect.left + point.xPx, rect.top + point.yPx, 0, 0);
  };

  const startLookup = (marker: ExemplarMarker) => {
    if (!marker.traceId) return;
    const cached = lookup.peek(marker.traceId);
    if (cached) {
      verdict.value = cached;
      return;
    }
    if (dwellTimer) clearTimeout(dwellTimer);
    dwellTimer = null;
    verdict.value = { state: "checking" };
    void lookup.lookup(marker.traceId, marker.tsMs).then((result) => {
      if (activeMarker.value?.id === marker.id) verdict.value = result;
    });
  };

  const openCard = (marker: ExemplarMarker, immediate = false) => {
    const switching = activeMarker.value?.id !== marker.id;
    activeMarker.value = marker;
    cardAnchor.value = anchorFor(marker);
    suppressAxisTooltip(true);
    if (!switching) {
      // Re-entering the open marker only cancels the pending close; its dwell timer must keep running.
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = null;
      if (immediate && verdict.value.state === "checking") startLookup(marker);
      return;
    }
    clearTimers();
    if (!marker.traceId) {
      verdict.value = { state: "none" };
      return;
    }
    const cached = lookup.peek(marker.traceId);
    verdict.value = cached ?? { state: "checking" };
    if (cached) return;
    if (immediate) startLookup(marker);
    else dwellTimer = setTimeout(() => startLookup(marker), EXEMPLAR_LOOKUP_DWELL_MS);
  };

  const closeCard = () => {
    clearTimers();
    if (!activeMarker.value) return;
    activeMarker.value = null;
    cardAnchor.value = null;
    cardHovered.value = false;
    suppressAxisTooltip(false);
  };

  const scheduleClose = () => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (!cardHovered.value) closeCard();
    }, EXEMPLAR_CARD_CLOSE_MS);
  };

  const markerFrom = (params: ExemplarEventParams): ExemplarMarker | undefined => {
    const id = params?.data?.exemplar?.id;
    return id ? markers.value.find((m) => m.id === id) : undefined;
  };

  const onMouseOver = (params: ExemplarEventParams) => {
    if (!isExemplarEvent(params)) return;
    const marker = markerFrom(params);
    if (marker) openCard(marker);
  };

  const onMouseOut = (params: ExemplarEventParams) => {
    if (isExemplarEvent(params) && activeMarker.value) scheduleClose();
  };

  const onCardEnter = () => {
    cardHovered.value = true;
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
  };

  const onCardLeave = () => {
    cardHovered.value = false;
    scheduleClose();
  };

  const follow = async (marker: ExemplarMarker) => {
    if (!marker.traceId) return;
    if (dwellTimer) clearTimeout(dwellTimer);
    dwellTimer = null;
    const result = await lookup.lookup(marker.traceId, marker.tsMs);
    if (activeMarker.value?.id === marker.id) verdict.value = result;
    if (result.state === "found" || result.state === "unverified") navigate(marker, result);
  };

  const onExemplarClick = async (params: ExemplarEventParams) => {
    const marker = markerFrom(params);
    if (!marker) return;
    if (isTouch(params) && activeMarker.value?.id !== marker.id) {
      openCard(marker, true);
      return;
    }
    await follow(marker);
  };

  const openTrace = async () => {
    if (activeMarker.value) await follow(activeMarker.value);
  };

  watch(markers, () => {
    if (activeMarker.value && !markers.value.some((m) => m.id === activeMarker.value?.id)) {
      closeCard();
    }
    onFinished();
  });

  onScopeDispose(() => {
    clearTimers();
    lookup.dispose();
  });

  return {
    yExtent,
    xExtent,
    points,
    activeMarker,
    cardAnchor,
    verdict,
    onFinished,
    onMouseOver,
    onMouseOut,
    onCardEnter,
    onCardLeave,
    onExemplarClick,
    openTrace,
    openCard,
    closeCard,
    follow,
  };
}
