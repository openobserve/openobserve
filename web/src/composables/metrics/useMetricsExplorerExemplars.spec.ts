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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useMetricsExplorerExemplars } from "./useMetricsExplorerExemplars";
import { createPreviewQueue, PRIORITY } from "./useMetricsPreviewQueue";
import searchService from "@/services/search";

vi.mock("@/services/search", () => ({
  default: { metrics_query_exemplars: vi.fn() },
}));

const fetchMock = searchService.metrics_query_exemplars as unknown as ReturnType<typeof vi.fn>;
const START_US = 1_700_000_000_000_000;
const END_US = START_US + 3_600_000_000;

const response = (ts: number) => ({
  data: {
    status: "success",
    data: [
      { seriesLabels: {}, exemplars: [{ labels: { trace_id: "t" }, value: "1", timestamp: ts }] },
    ],
  },
});

const setup = () => {
  const queue = createPreviewQueue();
  const runSpy = vi.spyOn(queue, "run");
  const api = useMetricsExplorerExemplars({
    queue,
    org: ref("org1"),
    timeRange: ref({ start_time: START_US, end_time: END_US }),
    queriesOf: () => [
      { expr: "histogram_quantile(0.5, x)", legend: "p50" },
      { expr: "histogram_quantile(0.99, x)", legend: "p99" },
    ],
    stepOf: () => 60,
    valueUnitOf: () => ({ unit: "seconds", unitCustom: null }),
  });
  return { api, queue, runSpy };
};

// Overrides are shared module state, so every test gets its own card name.
let seq = 0;
let card = { name: "lat_seconds_bucket" };

describe("useMetricsExplorerExemplars", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    fetchMock.mockReset();
    card = { name: `lat_seconds_bucket_${++seq}` };
  });

  it("is off by default and sends nothing", async () => {
    const { api } = setup();
    api.ensure(card);
    await flushPromises();
    expect(api.enabled(card.name)).toBe(false);
    expect(api.exemplarKeysOf(card)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turning a card on fetches each of its queries through the queue, owned by the card and uncached", async () => {
    fetchMock.mockResolvedValue(response(START_US / 1e6 + 5));
    const { api, runSpy } = setup();
    api.toggle(card);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runSpy.mock.calls.map((c) => c[3])).toEqual([
      { owner: card.name, cache: false },
      { owner: card.name, cache: false },
    ]);
    expect(runSpy.mock.calls[0][0]).toMatch(/^exemplars\|org1\|/);
    expect(window.sessionStorage.getItem(`o2.exemplars.org1.metrics-explorer.${card.name}`)).toBe(
      "1",
    );
    const state = api.stateOf(card.name)!;
    expect(state.status).toBe("ready");
    expect(state.markers).toHaveLength(1);
    expect(state.markers[0].queryIndexes).toEqual([0, 1]);
    expect(state.queryLabels).toEqual(["p50", "p99"]);
    expect(state.valueUnit).toBe("seconds");
  });

  it("runs a prefetch card's jobs at the caller's priority", async () => {
    fetchMock.mockResolvedValue(response(START_US / 1e6 + 5));
    const { api, runSpy } = setup();
    window.sessionStorage.setItem(`o2.exemplars.org1.metrics-explorer.${card.name}`, "1");
    api.ensure(card, PRIORITY.PREFETCH);
    await flushPromises();
    expect(runSpy.mock.calls.map((c) => c[1])).toEqual([PRIORITY.PREFETCH, PRIORITY.PREFETCH]);
  });

  it("a loading prefetch card's queued jobs move up when it becomes visible", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { api, queue } = setup();
    const bump = vi.spyOn(queue, "reprioritize");
    window.sessionStorage.setItem(`o2.exemplars.org1.metrics-explorer.${card.name}`, "1");
    api.ensure(card, PRIORITY.PREFETCH);
    await flushPromises();
    api.ensure(card, PRIORITY.VISIBLE);
    expect(bump.mock.calls).toEqual(api.exemplarKeysOf(card).map((k) => [k, PRIORITY.VISIBLE]));
  });

  it("scroll-away cancels the card's exemplar jobs and a later visit refetches", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    const { api, queue } = setup();
    api.toggle(card);
    await flushPromises();
    for (const key of api.exemplarKeysOf(card)) queue.cancel(key, card.name);
    await flushPromises();
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(api.stateOf(card.name)).toBeUndefined();
    fetchMock.mockResolvedValue(response(START_US / 1e6 + 5));
    api.ensure(card);
    await flushPromises();
    expect(api.stateOf(card.name)?.status).toBe("ready");
  });

  it("a filter or time change (cancelAll) aborts the jobs and drops the state", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    const { api, queue } = setup();
    api.toggle(card);
    await flushPromises();
    queue.cancelAll();
    api.clearAll();
    await flushPromises();
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(api.stateOf(card.name)).toBeUndefined();
  });

  it("turning off aborts in-flight jobs and clears the markers", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    const { api } = setup();
    api.toggle(card);
    await flushPromises();
    api.toggle(card);
    await flushPromises();
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(api.enabled(card.name)).toBe(false);
    expect(api.stateOf(card.name)).toBeUndefined();
  });

  it("reports a failure with the server message and retries", async () => {
    fetchMock.mockImplementation(async () => {
      throw { response: { status: 500, data: { error: "exemplar scan failed" } } };
    });
    const { api } = setup();
    api.toggle(card);
    await flushPromises();
    expect(api.stateOf(card.name)).toMatchObject({
      status: "error",
      errorMessage: "exemplar scan failed",
    });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(response(START_US / 1e6 - 1800));
    api.retry(card);
    await flushPromises();
    expect(api.stateOf(card.name)?.status).toBe("empty");
  });
});
