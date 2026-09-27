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
import { effectScope, nextTick, ref, type Ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { usePanelExemplars } from "./usePanelExemplars";
import searchService from "@/services/search";
import type { InjectedExemplars } from "@/ts/interfaces/exemplars";

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "org1" } } }),
}));

vi.mock("@/services/search", () => ({
  default: { metrics_query_exemplars: vi.fn() },
}));

const notify = vi.fn();
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: notify }),
}));

const START_US = 1_700_000_000_000_000;
const END_US = START_US + 3_600_000_000;
const fetchMock = searchService.metrics_query_exemplars as unknown as ReturnType<typeof vi.fn>;

const response = (exemplars: { ts: number; traceId: string }[]) => ({
  data: {
    status: "success",
    data: [
      {
        seriesLabels: {},
        exemplars: exemplars.map((e) => ({
          labels: { trace_id: e.traceId },
          value: "1",
          timestamp: e.ts,
        })),
      },
    ],
  },
});

const metaFor = (queries: string[], startUs = START_US, endUs = END_US) => ({
  queries: queries.map((query) => ({ query, startTime: startUs, endTime: endUs })),
});

interface Harness {
  enabled: Ref<boolean>;
  metadata: Ref<ReturnType<typeof metaFor> | { queries: [] }>;
  panelSchema: Ref<Record<string, unknown>>;
  injected: Ref<InjectedExemplars | undefined>;
  api: ReturnType<typeof usePanelExemplars>;
  stop: () => void;
}

const mount = (opts: {
  enabled?: boolean;
  type?: string;
  queryType?: string;
  queryTypes?: string[];
  metadata?: ReturnType<typeof metaFor>;
}): Harness => {
  const queryTypes = opts.queryTypes ?? ["range"];
  const enabled = ref(opts.enabled ?? true);
  const metadata = ref<ReturnType<typeof metaFor> | { queries: [] }>(
    opts.metadata ?? metaFor(queryTypes.map((_, i) => `q${i}`)),
  );
  const panelSchema = ref<Record<string, unknown>>({
    id: "p1",
    type: opts.type ?? "line",
    queryType: opts.queryType ?? "promql",
    queries: queryTypes.map((query_type) => ({ config: { query_type } })),
  });
  const injected = ref<InjectedExemplars | undefined>(undefined);
  const scope = effectScope();
  const api = scope.run(() =>
    usePanelExemplars({
      panelSchema,
      metadata,
      enabled,
      hiddenQueries: ref([]),
      injected,
      meta: ref({ dashboard_id: "d1", panel_id: "p1", tab_name: "Main" }),
    }),
  )!;
  return { enabled, metadata, panelSchema, injected, api, stop: () => scope.stop() };
};

describe("usePanelExemplars", () => {
  let harness: Harness | null = null;

  beforeEach(() => {
    fetchMock.mockReset();
    notify.mockReset();
  });

  afterEach(() => harness?.stop());

  it("sends one request per range query with the query's own substituted text and window", async () => {
    fetchMock.mockResolvedValue(response([]));
    const panelWindow = metaFor(["rate(a[5m])", "rate(b[5m])"], START_US + 7, END_US - 7);
    harness = mount({ queryTypes: ["range", "range"], metadata: panelWindow });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((c) => c[0].query)).toEqual(["rate(a[5m])", "rate(b[5m])"]);
    const first = fetchMock.mock.calls[0][0];
    expect(first.start_time).toBe(START_US + 7);
    expect(first.end_time).toBe(END_US - 7);
    expect(first.org_identifier).toBe("org1");
    expect(first.dashboard_id).toBe("d1");
    expect(first.panel_id).toBe("p1");
    expect(first.tab_name).toBe("Main");
    expect(first.signal).toBeInstanceOf(AbortSignal);
  });

  it("skips instant queries", async () => {
    fetchMock.mockResolvedValue(response([]));
    harness = mount({ queryTypes: ["range", "instant"] });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].query).toBe("q0");
  });

  it("builds deduplicated in-window markers and reports ready", async () => {
    const inWindow = START_US / 1e6 + 60;
    fetchMock.mockResolvedValue(
      response([
        { ts: inWindow, traceId: "t1" },
        { ts: START_US / 1e6 - 1800, traceId: "early" },
      ]),
    );
    harness = mount({ queryTypes: ["range", "range"] });
    await flushPromises();
    expect(harness.api.status.value).toBe("ready");
    expect(harness.api.markers.value.map((m) => m.traceId)).toEqual(["t1"]);
    expect(harness.api.markers.value[0].queryIndexes).toEqual([0, 1]);
  });

  it("reports empty when nothing lands in the window", async () => {
    fetchMock.mockResolvedValue(response([{ ts: START_US / 1e6 - 1800, traceId: "early" }]));
    harness = mount({});
    await flushPromises();
    expect(harness.api.status.value).toBe("empty");
  });

  it("turns a failure into an error status with the server message and never notifies", async () => {
    fetchMock.mockRejectedValue({ response: { status: 500, data: { error: "scan exploded" } } });
    harness = mount({});
    await flushPromises();
    expect(harness.api.status.value).toBe("error");
    expect(harness.api.errorMessage.value).toBe("scan exploded");
    expect(notify).not.toHaveBeenCalled();
  });

  it("retry refetches only exemplars", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    harness = mount({});
    await flushPromises();
    expect(harness.api.status.value).toBe("error");
    fetchMock.mockResolvedValue(response([{ ts: START_US / 1e6 + 1, traceId: "t" }]));
    harness.api.retry();
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(harness.api.status.value).toBe("ready");
  });

  it.each([
    ["an SQL panel", { queryType: "sql" }],
    ["an h-bar panel", { type: "h-bar" }],
    ["a stacked panel", { type: "stacked" }],
    ["an instant-only panel", { queryTypes: ["instant"] }],
  ])("sends nothing for %s", async (_label, opts) => {
    harness = mount(opts);
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.api.status.value).toBe("off");
  });

  it("sends nothing while off across load, refresh, time change and variable change", async () => {
    harness = mount({ enabled: false });
    await flushPromises();
    harness.metadata.value = { queries: [] };
    await nextTick();
    harness.metadata.value = metaFor(["q0"]);
    await flushPromises();
    harness.metadata.value = metaFor(["q0"], START_US + 60_000_000, END_US + 60_000_000);
    await flushPromises();
    harness.metadata.value = metaFor(['q0{job="new"}']);
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.api.status.value).toBe("off");
  });

  it("turning off aborts the in-flight request and clears markers at once", async () => {
    fetchMock.mockResolvedValueOnce(response([{ ts: START_US / 1e6 + 1, traceId: "t" }]));
    harness = mount({});
    await flushPromises();
    expect(harness.api.markers.value).toHaveLength(1);
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((args: { signal: AbortSignal }) => {
      signal = args.signal;
      return new Promise(() => {});
    });
    harness.api.retry();
    await nextTick();
    harness.enabled.value = false;
    await nextTick();
    expect(signal?.aborted).toBe(true);
    expect(harness.api.markers.value).toEqual([]);
    expect(harness.api.status.value).toBe("off");
  });

  it("a new run aborts the old request, clears old markers first, and refetches the new window", async () => {
    fetchMock.mockResolvedValueOnce(response([{ ts: START_US / 1e6 + 1, traceId: "old" }]));
    harness = mount({});
    await flushPromises();
    expect(harness.api.markers.value.map((m) => m.traceId)).toEqual(["old"]);

    let firstSignal: AbortSignal | undefined;
    let release: (v: unknown) => void = () => {};
    fetchMock.mockImplementationOnce((args: { signal: AbortSignal }) => {
      firstSignal = args.signal;
      return new Promise((resolve) => (release = resolve));
    });
    const shifted = 60_000_000;
    harness.metadata.value = metaFor(["q0"], START_US + shifted, END_US + shifted);
    await nextTick();
    expect(harness.api.markers.value).toEqual([]);
    expect(harness.api.status.value).toBe("loading");

    // The executor resets metadata at the start of every run, as a refresh does.
    fetchMock.mockResolvedValueOnce(
      response([{ ts: (START_US + shifted) / 1e6 + 5, traceId: "new" }]),
    );
    harness.metadata.value = { queries: [] };
    await nextTick();
    expect(firstSignal?.aborted).toBe(true);
    harness.metadata.value = metaFor(["q0"], START_US + shifted, END_US + shifted);
    await flushPromises();
    release(response([{ ts: START_US / 1e6 + 2, traceId: "stale" }]));
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0].start_time).toBe(START_US + shifted);
    expect(harness.api.markers.value.map((m) => m.traceId)).toEqual(["new"]);
  });

  it("waits until every range query has metadata so no query is sent twice", async () => {
    fetchMock.mockResolvedValue(response([]));
    harness = mount({ queryTypes: ["range", "range"], metadata: metaFor(["q0"]) });
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    harness.metadata.value = metaFor(["q0", "q1"]);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("mirrors injected explorer state without fetching", async () => {
    fetchMock.mockResolvedValue(response([]));
    harness = mount({});
    harness.injected.value = { status: "empty", markers: [], errorMessage: "" };
    await flushPromises();
    expect(harness.api.status.value).toBe("empty");
    const callsBefore = fetchMock.mock.calls.length;
    harness.injected.value = { status: "error", markers: [], errorMessage: "nope" };
    await nextTick();
    expect(harness.api.status.value).toBe("error");
    expect(harness.api.errorMessage.value).toBe("nope");
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });
});
