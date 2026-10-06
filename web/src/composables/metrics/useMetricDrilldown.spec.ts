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
import { flushPromises } from "@vue/test-utils";
import config from "@/aws-exports";
import { useMetricDrilldown } from "./useMetricDrilldown";
import { b64DecodeUnicode } from "@/utils/zincutils";

const api = vi.hoisted(() => ({
  getIdentityConfig: vi.fn(),
  getSemanticGroups: vi.fn(),
  correlate: vi.fn(),
  labelValues: vi.fn(),
}));
vi.mock("@/services/service_streams", () => ({
  default: {
    getIdentityConfig: api.getIdentityConfig,
    getSemanticGroups: api.getSemanticGroups,
    correlate: api.correlate,
  },
}));
vi.mock("@/services/metrics", () => ({ default: { labelValues: api.labelValues } }));

const GROUPS = [
  { id: "service", display: "Service", fields: ["service_name", "job", "__name__"] },
  { id: "k8s-namespace", display: "Namespace", fields: ["k8s_namespace_name", "namespace"] },
];
const IDENTITY = {
  sets: [{ id: "k8s", label: "K8s", distinguish_by: ["k8s-namespace"] }],
  tracked_alias_ids: [],
};
const WINDOW = { start_time: 1_000_000, end_time: 2_000_000 };
const stream = (name: string, filters?: Record<string, string>, dropped?: string[]) => ({
  stream_name: name,
  stream_type: "logs",
  ...(filters ? { filters } : {}),
  ...(dropped ? { dropped_dimensions: dropped } : {}),
});
const correlated = (logs: any[], traces: any[]) => ({
  data: {
    service_name: "checkout",
    matched_dimensions: {},
    additional_dimensions: {},
    related_streams: { logs, traces, metrics: [], profiles: [] },
  },
});
const httpError = (status: number, message = "boom") =>
  Object.assign(new Error(message), { response: { status, data: { message } } });

let labels: string[] | undefined;
let schemaReady: Promise<void>;
const setup = (
  over: {
    filters?: any[];
    inapplicable?: any[];
    enabled?: boolean;
    metricLabels?: string[] | undefined;
  } = {},
) => {
  const router = { push: vi.fn() };
  const store = { dispatch: vi.fn() };
  const onDropped = vi.fn();
  const drilldown = useMetricDrilldown({
    org: () => "acme",
    metric: () => ({ name: "http_requests_total", labels: over.metricLabels }),
    labelsOf: () => labels,
    ensureSchemas: () => schemaReady,
    filters: () => over.filters ?? [],
    inapplicableFilters: () => over.inapplicable ?? [],
    timeRange: () => WINDOW,
    serviceStreamsEnabled: () => over.enabled ?? true,
    router,
    store,
    onDropped,
  });
  return { drilldown, router, store, onDropped };
};

describe("useMetricDrilldown", () => {
  beforeEach(() => {
    (config as any).isEnterprise = "true";
    (config as any).isCloud = "false";
    vi.clearAllMocks();
    labels = ["job", "instance"];
    schemaReady = Promise.resolve();
    api.getIdentityConfig.mockResolvedValue({ data: IDENTITY });
    api.getSemanticGroups.mockResolvedValue({ data: GROUPS });
    api.labelValues.mockResolvedValue({ data: { data: ["payments", "checkout"] } });
    api.correlate.mockResolvedValue(
      correlated([stream("checkout_logs", { service_name: "checkout" })], []),
    );
  });

  afterEach(() => {
    (config as any).isEnterprise = "false";
  });

  describe("availability", () => {
    it("is locked on OSS, and reads and correlates nothing", async () => {
      (config as any).isEnterprise = "false";
      const { drilldown } = setup({ filters: [{ label: "service_name", value: "checkout" }] });
      await flushPromises();
      expect(drilldown.availability.value).toBe("oss");
      await drilldown.open();
      expect(api.getIdentityConfig).not.toHaveBeenCalled();
      expect(api.getSemanticGroups).not.toHaveBeenCalled();
      expect(api.correlate).not.toHaveBeenCalled();
    });

    it("is off when service discovery is off", async () => {
      const { drilldown } = setup({ enabled: false });
      await flushPromises();
      expect(drilldown.availability.value).toBe("discoveryOff");
      expect(api.getIdentityConfig).not.toHaveBeenCalled();
    });

    it("is forbidden when the identity config or the semantic groups are refused", async () => {
      api.getIdentityConfig.mockRejectedValueOnce(httpError(403));
      const first = setup();
      await flushPromises();
      expect(first.drilldown.availability.value).toBe("forbidden");

      api.getSemanticGroups.mockRejectedValueOnce(httpError(403));
      const second = setup();
      await flushPromises();
      expect(second.drilldown.availability.value).toBe("forbidden");
    });

    it("stays available on a server error, and the menu shows it with Retry", async () => {
      api.getIdentityConfig.mockRejectedValueOnce(httpError(500, "config store down"));
      const { drilldown } = setup({ filters: [{ label: "service_name", value: "checkout" }] });
      await flushPromises();
      expect(drilldown.availability.value).toBe("available");
      await drilldown.open();
      expect(drilldown.menu.value).toEqual({ kind: "error", message: "config store down" });

      await drilldown.retry();
      expect(drilldown.menu.value.kind).toBe("streams");
    });
  });

  describe("the metric's labels", () => {
    it("shows a loading line until the schema arrives", async () => {
      let resolve!: () => void;
      schemaReady = new Promise((r) => (resolve = r));
      labels = undefined;
      const { drilldown } = setup();
      await flushPromises();
      const opening = drilldown.open();
      await flushPromises();
      expect(drilldown.menu.value).toEqual({ kind: "loading" });

      labels = ["job"];
      resolve();
      await opening;
      expect(drilldown.menu.value.kind).toBe("pickService");
    });

    it("shows an error with Retry when the schema cannot be loaded", async () => {
      labels = undefined;
      const { drilldown } = setup();
      await flushPromises();
      await drilldown.open();
      expect(drilldown.menu.value).toEqual({ kind: "error", message: null });

      labels = ["job"];
      await drilldown.retry();
      expect(drilldown.menu.value.kind).toBe("pickService");
    });
  });

  describe("a service is required", () => {
    it("offers the service label's values for this metric and range, then correlates on the pick", async () => {
      const { drilldown } = setup({ filters: [{ label: "pod", value: "web-1" }] });
      await flushPromises();
      await drilldown.open();

      expect(api.labelValues).toHaveBeenCalledWith(
        expect.objectContaining({
          org_identifier: "acme",
          label: "job",
          match: "http_requests_total",
          ...WINDOW,
        }),
      );
      expect(drilldown.menu.value).toEqual({
        kind: "pickService",
        label: "job",
        values: ["checkout", "payments"],
      });
      expect(api.correlate).not.toHaveBeenCalled();

      await drilldown.pickService("checkout");
      expect(api.correlate).toHaveBeenCalledWith("acme", {
        source_stream: "http_requests_total",
        source_type: "metrics",
        available_dimensions: { service: "checkout" },
      });
      expect(drilldown.menu.value.kind).toBe("streams");
    });

    it("forgets the pick on the next opening", async () => {
      const { drilldown } = setup();
      await flushPromises();
      await drilldown.open();
      await drilldown.pickService("checkout");
      await drilldown.open();
      expect(drilldown.menu.value.kind).toBe("pickService");
    });

    it("caps the offered values at 20", async () => {
      api.labelValues.mockResolvedValueOnce({
        data: { data: Array.from({ length: 30 }, (_, i) => `svc-${String(i).padStart(2, "0")}`) },
      });
      const { drilldown } = setup();
      await flushPromises();
      await drilldown.open();
      expect((drilldown.menu.value as any).values).toHaveLength(20);
    });

    it("says so when the metric has no service label", async () => {
      labels = ["instance"];
      const { drilldown } = setup();
      await flushPromises();
      await drilldown.open();
      expect(drilldown.menu.value).toEqual({ kind: "notice", notice: "noServiceLabel" });
      expect(api.correlate).not.toHaveBeenCalled();
    });

    it("correlates straight away on a service filter, without __name__", async () => {
      const { drilldown } = setup({
        filters: [
          { label: "service_name", value: "checkout" },
          { label: "__name__", value: "http_requests_total" },
        ],
      });
      await flushPromises();
      await drilldown.open();
      expect(api.correlate.mock.calls[0][1].available_dimensions).toEqual({ service: "checkout" });
    });
  });

  describe("service is optional", () => {
    beforeEach(() => {
      api.getIdentityConfig.mockResolvedValue({ data: { ...IDENTITY, service_optional: true } });
    });

    it("asks for an identity filter, and sends nothing, when there is none", async () => {
      const { drilldown } = setup({ filters: [{ label: "service_name", value: "checkout" }] });
      await flushPromises();
      await drilldown.open();
      expect(drilldown.menu.value).toEqual({ kind: "notice", notice: "needIdentity" });
      expect(api.correlate).not.toHaveBeenCalled();
      expect(api.labelValues).not.toHaveBeenCalled();
    });

    it("correlates on an identity filter, even for a metric with no service label", async () => {
      labels = ["instance"];
      const { drilldown } = setup({ filters: [{ label: "k8s_namespace_name", value: "shop" }] });
      await flushPromises();
      await drilldown.open();
      expect(api.correlate.mock.calls[0][1].available_dimensions).toEqual({
        "k8s-namespace": "shop",
      });
    });
  });

  describe("the correlation", () => {
    const opened = async (response: any) => {
      if (response instanceof Error) api.correlate.mockRejectedValueOnce(response);
      else api.correlate.mockResolvedValueOnce(response);
      const ctx = setup({ filters: [{ label: "service_name", value: "checkout" }] });
      await flushPromises();
      await ctx.drilldown.open();
      return ctx;
    };

    it("lists each signal's streams; one without filters cannot be opened", async () => {
      const { drilldown } = await opened(
        correlated(
          [stream("checkout_logs", { service_name: "checkout" }), stream("all_logs")],
          [stream("default", { service_name: "checkout" })],
        ),
      );
      expect(drilldown.menu.value).toEqual({
        kind: "streams",
        service: "checkout",
        logs: [
          expect.objectContaining({ name: "checkout_logs", openable: true }),
          expect.objectContaining({ name: "all_logs", openable: false }),
        ],
        traces: [expect.objectContaining({ name: "default", openable: true })],
      });
    });

    it("leaves a signal with no streams empty, for its disabled line", async () => {
      const { drilldown } = await opened(
        correlated([stream("checkout_logs", { service_name: "checkout" })], []),
      );
      expect((drilldown.menu.value as any).traces).toEqual([]);
    });

    it("says no service matched on a null answer", async () => {
      const { drilldown } = await opened({ data: null });
      expect(drilldown.menu.value).toEqual({ kind: "notice", notice: "noService" });
    });

    it("says the user may not view services on a 403", async () => {
      const { drilldown } = await opened(httpError(403));
      expect(drilldown.menu.value).toEqual({ kind: "notice", notice: "noPermission" });
    });

    it("shows a network error with Retry", async () => {
      const { drilldown } = await opened(new Error("Network Error"));
      expect(drilldown.menu.value).toEqual({ kind: "error", message: "Network Error" });
      await drilldown.retry();
      expect(drilldown.menu.value.kind).toBe("streams");
    });
  });

  describe("opening a stream", () => {
    it("opens logs with the stream's identity filters, and names dropped dimensions by the user's labels", async () => {
      api.correlate.mockResolvedValueOnce(
        correlated([stream("checkout_logs", { service_name: "checkout" }, ["k8s-namespace"])], []),
      );
      const { drilldown, router, store, onDropped } = setup({
        filters: [
          { label: "service_name", value: "checkout" },
          { label: "namespace", value: "shop" },
        ],
      });
      await flushPromises();
      await drilldown.open();
      drilldown.openStream("logs", (drilldown.menu.value as any).logs[0]);

      expect(store.dispatch).toHaveBeenCalledWith("logs/setIsInitialized", false);
      const route = router.push.mock.calls[0][0];
      expect(route.path).toBe("/logs");
      expect(route.query).toMatchObject({
        stream: "checkout_logs",
        from: "1000000",
        to: "2000000",
      });
      expect(onDropped).toHaveBeenCalledWith(["namespace"]);
    });

    it("opens traces on the stream's own field names, without a toast", async () => {
      api.correlate.mockResolvedValueOnce(
        correlated([], [stream("default", { service_k8s_namespace_name: "shop" })]),
      );
      const { drilldown, router, onDropped } = setup({
        filters: [{ label: "service_name", value: "checkout" }],
      });
      await flushPromises();
      await drilldown.open();
      drilldown.openStream("traces", (drilldown.menu.value as any).traces[0]);

      const route = router.push.mock.calls[0][0];
      expect(route.name).toBe("traces");
      expect(b64DecodeUnicode(route.query.query)).toBe(`"service_k8s_namespace_name" = 'shop'`);
      expect(onDropped).not.toHaveBeenCalled();
    });
  });
});
