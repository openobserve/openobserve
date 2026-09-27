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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import {
  EXEMPLAR_CARD_CLOSE_MS,
  EXEMPLAR_LOOKUP_DWELL_MS,
  usePanelExemplarInteraction,
} from "./usePanelExemplarInteraction";
import { EXEMPLAR_SERIES_ID } from "@/utils/dashboard/exemplars/applyExemplarSeries";
import type { ExemplarMarker, TraceVerdict } from "@/ts/interfaces/exemplars";

const marker = (id: string, over: Partial<ExemplarMarker> = {}): ExemplarMarker => ({
  id,
  queryIndexes: [0],
  tsMs: 1_000,
  value: 5,
  labels: {},
  seriesLabels: {},
  traceId: `trace-${id}`,
  ...over,
});

const event = (m: ExemplarMarker, pointerType = "mouse") => ({
  seriesId: EXEMPLAR_SERIES_ID,
  data: { exemplar: { id: m.id } },
  event: { event: { pointerType } },
});

const found: TraceVerdict = { state: "found", stream: "default", startUs: 1, endUs: 2 };

const setup = (
  markers: ExemplarMarker[],
  verdict: TraceVerdict = found,
  placeY?: (m: ExemplarMarker) => number | null,
) => {
  const cache = new Map<string, TraceVerdict>();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const lookupFn = vi.fn(async (traceId: string) => {
    await gate;
    cache.set(traceId, verdict);
    return verdict;
  });
  const inFlight = new Map<string, Promise<TraceVerdict>>();
  const lookup = {
    lookup: (traceId: string, tsMs: number) => {
      if (!inFlight.has(traceId)) inFlight.set(traceId, lookupFn(traceId, tsMs));
      return inFlight.get(traceId)!;
    },
    peek: (traceId: string) => cache.get(traceId),
    dispose: vi.fn(),
  };
  const navigate = vi.fn();
  const chart = {
    dispatchAction: vi.fn(),
    setOption: vi.fn(),
    convertToPixel: vi.fn(() => [10, 20]),
    getModel: () => ({
      getComponent: (type: string) => ({
        axis: { scale: { getExtent: () => (type === "yAxis" ? [0, 100] : [0, 9_000]) } },
      }),
    }),
    getDom: () => ({ getBoundingClientRect: () => ({ left: 100, top: 50 }) }),
  };
  const scope = effectScope();
  const api = scope.run(() =>
    usePanelExemplarInteraction({
      chartRendererRef: ref({ chart }) as any,
      markers: ref(markers),
      seriesExtent: ref<[number, number]>([0, 10]),
      windowMs: ref<[number, number]>([0, 5_000]),
      lookup,
      toChartX: (ts) => ts,
      navigate,
      placeY,
    }),
  )!;
  return { api, lookupFn, navigate, chart, release, scope };
};

describe("usePanelExemplarInteraction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the card on hover and hides the axis tooltip, but looks nothing up before the dwell", async () => {
    const m = marker("a");
    const { api, lookupFn, chart } = setup([m]);
    api.onMouseOver(event(m));
    expect(api.activeMarker.value?.id).toBe("a");
    expect(api.verdict.value).toEqual({ state: "checking" });
    expect(chart.dispatchAction).toHaveBeenCalledWith({ type: "hideTip" });
    expect(chart.setOption).toHaveBeenCalledWith({ tooltip: { triggerOn: "none" } });
    await vi.advanceTimersByTimeAsync(EXEMPLAR_LOOKUP_DWELL_MS - 1);
    expect(lookupFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(lookupFn).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the pointer leaves before the dwell", async () => {
    const m = marker("a");
    const { api, lookupFn, chart } = setup([m]);
    api.onMouseOver(event(m));
    api.onMouseOut(event(m));
    await vi.advanceTimersByTimeAsync(EXEMPLAR_CARD_CLOSE_MS + EXEMPLAR_LOOKUP_DWELL_MS);
    expect(api.activeMarker.value).toBeNull();
    expect(lookupFn).not.toHaveBeenCalled();
    expect(chart.setOption).toHaveBeenLastCalledWith({ tooltip: { triggerOn: "mousemove|click" } });
  });

  it("re-entering the open marker inside the close grace keeps the dwell and looks up once", async () => {
    const m = marker("a");
    const { api, lookupFn } = setup([m]);
    api.onMouseOver(event(m));
    await vi.advanceTimersByTimeAsync(EXEMPLAR_LOOKUP_DWELL_MS / 2);
    api.onMouseOut(event(m));
    await vi.advanceTimersByTimeAsync(EXEMPLAR_CARD_CLOSE_MS / 2);
    api.onMouseOver(event(m));
    await vi.advanceTimersByTimeAsync(EXEMPLAR_LOOKUP_DWELL_MS);
    expect(api.activeMarker.value?.id).toBe("a");
    expect(lookupFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(EXEMPLAR_CARD_CLOSE_MS * 2);
    expect(api.activeMarker.value?.id).toBe("a");
  });

  it("does not reset the extent on a refresh whose data stays inside the painted axis", async () => {
    const seriesExtent = ref<[number, number]>([0, 10]);
    const scope = effectScope();
    const api = scope.run(() =>
      usePanelExemplarInteraction({
        chartRendererRef: ref({ chart: null }) as any,
        markers: ref([]),
        seriesExtent,
        windowMs: ref<[number, number]>([0, 5_000]),
        lookup: { lookup: vi.fn(), peek: vi.fn(), dispose: vi.fn() } as any,
        toChartX: (ts) => ts,
        navigate: vi.fn(),
      }),
    )!;
    api.yExtent.value = [0, 20];
    const before = api.yExtent.value;
    seriesExtent.value = [1, 15];
    await vi.advanceTimersByTimeAsync(0);
    expect(api.yExtent.value).toBe(before);
    seriesExtent.value = [1, 40];
    await vi.advanceTimersByTimeAsync(0);
    expect(api.yExtent.value).toEqual([1, 40]);
    scope.stop();
  });

  it("keyboard focus on the already-open marker starts its lookup at once", async () => {
    const m = marker("a");
    const { api, lookupFn } = setup([m]);
    api.onMouseOver(event(m));
    expect(lookupFn).not.toHaveBeenCalled();
    api.openCard(m, true);
    expect(lookupFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(EXEMPLAR_LOOKUP_DWELL_MS);
    expect(lookupFn).toHaveBeenCalledTimes(1);
  });

  it("keeps the card open while the pointer is inside it", async () => {
    const m = marker("a");
    const { api } = setup([m]);
    api.onMouseOver(event(m));
    api.onMouseOut(event(m));
    api.onCardEnter();
    await vi.advanceTimersByTimeAsync(EXEMPLAR_CARD_CLOSE_MS * 2);
    expect(api.activeMarker.value?.id).toBe("a");
  });

  it("a click during the dwell starts one lookup, waits for it, then navigates", async () => {
    const m = marker("a", { spanId: "s" });
    const { api, lookupFn, navigate, release } = setup([m]);
    api.onMouseOver(event(m));
    const clicked = api.onExemplarClick(event(m));
    expect(lookupFn).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    release();
    await clicked;
    await vi.advanceTimersByTimeAsync(EXEMPLAR_LOOKUP_DWELL_MS);
    expect(lookupFn).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(m, found);
  });

  it("a click during the lookup reuses it", async () => {
    const m = marker("a");
    const { api, lookupFn, navigate, release } = setup([m]);
    api.onMouseOver(event(m));
    await vi.advanceTimersByTimeAsync(EXEMPLAR_LOOKUP_DWELL_MS);
    const clicked = api.onExemplarClick(event(m));
    release();
    await clicked;
    expect(lookupFn).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("does not navigate for a trace that is not available", async () => {
    const m = marker("a");
    const { api, navigate, release } = setup([m], { state: "not_available" });
    const clicked = api.onExemplarClick(event(m));
    release();
    await clicked;
    expect(navigate).not.toHaveBeenCalled();
  });

  it("an exemplar without trace_id shows no action, looks nothing up and ignores clicks", async () => {
    const m = marker("a", { traceId: undefined });
    const { api, lookupFn, navigate } = setup([m]);
    api.onMouseOver(event(m));
    expect(api.verdict.value).toEqual({ state: "none" });
    await vi.advanceTimersByTimeAsync(EXEMPLAR_LOOKUP_DWELL_MS * 2);
    await api.onExemplarClick(event(m));
    expect(lookupFn).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a first tap opens the card and starts the lookup at once without navigating", async () => {
    const m = marker("a");
    const { api, lookupFn, navigate } = setup([m]);
    await api.onExemplarClick(event(m, "touch"));
    expect(api.activeMarker.value?.id).toBe("a");
    expect(lookupFn).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("pins the hidden axes to the primary axes' rendered extents and reports pixels", () => {
    const m = marker("a", { value: 500 });
    const { api } = setup([m]);
    api.onFinished();
    expect(api.yExtent.value).toEqual([0, 100]);
    expect(api.xExtent.value).toEqual([0, 9_000]);
    expect(api.points.value).toEqual([]);
    api.onFinished();
    expect(api.points.value).toEqual([
      { marker: m, xPx: 10, yPx: 20, clamped: "top", placement: "value" },
    ]);
  });

  it("publishes no marker pixels while the painted option lacks the exemplar series", () => {
    const m = marker("a");
    const { api, chart } = setup([m]);
    api.onFinished();
    chart.convertToPixel.mockReturnValue(undefined as unknown as number[]);
    api.onFinished();
    expect(api.points.value).toEqual([]);
    chart.convertToPixel.mockReturnValue([10, 20]);
    api.onFinished();
    expect(api.points.value).toHaveLength(1);
  });

  it("publishes line-mode pixels at the line's y, not the exemplar value", () => {
    const m = marker("a", { value: 500 });
    const { api, chart } = setup([m], found, () => 7);
    api.onFinished();
    api.onFinished();
    expect(chart.convertToPixel).toHaveBeenLastCalledWith(
      { seriesId: EXEMPLAR_SERIES_ID },
      [1_000, 7],
    );
    expect(api.points.value[0]).toMatchObject({ clamped: false, placement: "line" });
  });

  it("ignores events from other series", () => {
    const m = marker("a");
    const { api } = setup([m]);
    api.onMouseOver({ seriesId: "cpu", data: { exemplar: { id: "a" } } } as any);
    expect(api.activeMarker.value).toBeNull();
  });
});
