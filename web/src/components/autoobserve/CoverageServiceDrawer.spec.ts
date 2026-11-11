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

import { describe, expect, it, onTestFinished, vi } from "vitest";
import config from "@/aws-exports";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { gt } from "@/types/i18n";
import type { AutoObserveCoverage } from "@/services/autoobserve";
import CoverageServiceDrawer from "./CoverageServiceDrawer.vue";
import { coverageFor, detectorsOf, type CoverageRow } from "./fixtures";
import { toCoverageSource } from "./live/liveAdapter";
import { LIVE_DOT } from "./live/liveCopy";

const api = vi.hoisted(() => ({
  correlate: vi.fn(),
  getStream: vi.fn(),
  fetch: vi.fn(),
  getLocations: vi.fn(),
  listAlerts: vi.fn(),
  schema: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/services/stream", () => ({
  default: { schema: (...args: unknown[]) => api.schema(...args) },
}));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ replace: vi.fn(), push: api.push }),
}));
vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  default: { name: "ChartRenderer", template: "<div />" },
}));
vi.mock("@/services/service_streams", () => ({
  default: { correlate: (...args: unknown[]) => api.correlate(...args) },
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStream: (...args: unknown[]) => api.getStream(...args) }),
}));
vi.mock("@/services/alerts", () => ({
  default: { listByFolderId: (...args: unknown[]) => api.listAlerts(...args) },
}));
vi.mock("@/services/synthetics", () => ({
  default: { getLocations: (...args: unknown[]) => api.getLocations(...args) },
}));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...args: unknown[]) => api.fetch(...args),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

const DrawerStub = { template: "<div><slot name='header' /><slot /></div>" };
const ChartStub = {
  name: "CoverageMetricChart",
  props: ["def", "cell", "added"],
  template: "<div />",
};

const monitor = (name: string) => ({
  monitor_kind: "alert",
  monitor_id: `${name}-id`,
  monitor_name: name,
  predicate: "",
  last_data_at: null,
});
const cell = (state: string, by?: string) => ({
  state,
  evidence: by ? [monitor(by)] : [],
  counts: {},
});

const liveRow = (
  cells: Record<string, ReturnType<typeof cell>>,
  streams: { type: string; name: string; learning_until?: number | null }[] = [],
) =>
  toCoverageSource(
    gt,
    {
      view: "strict",
      pass_at: Date.now() * 1000,
      refreshed_at: null,
      quality: null,
      classes: [],
      rows: [
        {
          service_id: "trace/checkout",
          service_name: "checkout",
          cluster: "prod-eu",
          namespace: "shop",
          streams,
          cells,
        },
      ],
    } as unknown as AutoObserveCoverage,
    { status: "ready", retry: () => undefined },
    "en-US",
  ).rows[0];

const mountDrawer = (
  row: CoverageRow,
  state: "watched" | "gap",
  live = true,
  expanded: "absence" | null = null,
) =>
  mount(CoverageServiceDrawer, {
    props: {
      row,
      serviceStates: { [row.service]: state },
      scenario: "demo",
      ledger: [],
      expanded,
      anchor: "body",
      fix: null,
      message: "",
      live,
    },
    global: {
      plugins: [i18n, store],
      stubs: { ODrawer: DrawerStub, CoverageMetricChart: ChartStub, CoverageSignalDetail: true },
    },
  });

const chips = (wrapper: ReturnType<typeof mountDrawer>) =>
  wrapper.findAll('[data-test^="autoobserve-coverage-drawer-chip-"]');

describe("CoverageServiceDrawer: a check just added here (COVERAGE-AFTER-ADD)", () => {
  it("reads Added in a neutral dot until a pass counts it, and offers no second add", async () => {
    const { serviceKeyOf, useRecentlyCreated } = await import("./insight/bulk/useRecentlyCreated");
    const recently = useRecentlyCreated();
    const org = String(store.state.selectedOrganization?.identifier ?? "");
    recently.add(serviceKeyOf(org, "checkout", "prod-eu", "shop"), "errors");
    try {
      const row = liveRow({ errors: cell("none"), latency: cell("none"), absence: cell("none") });
      const found = chips(mountDrawer(row, "gap"));
      expect(found[0].text()).toBe("Errors: Added");
      expect(found[0].find("span").classes().join(" ")).toContain(LIVE_DOT.added);
      expect(found[1].text()).toBe("Latency: Coverage gap");
      const wrapper = mountDrawer(row, "gap");
      const lines = wrapper
        .findAll('[data-test="autoobserve-coverage-drawer-gap-line"]')
        .map((l) => l.text());
      expect(lines.join(" ")).not.toContain("its errors,");
      expect(lines).toContain(
        "Added an alert for its errors. AutoObserve counts it at its next check.",
      );
      const added = Object.fromEntries(
        wrapper
          .findAllComponents(ChartStub)
          .map((c) => [c.props("def").signal, !!c.props("added")]),
      );
      expect(added).toEqual({ requests: false, errors: true, latency: false });
    } finally {
      recently.clearOnPass(org, Number.MAX_SAFE_INTEGER);
    }
  });
});

describe("CoverageServiceDrawer: when a covered check's alert last fired (T2-13)", () => {
  it("shows no 'Last fired' for an alert that has only been evaluated, never fired (T2-N2)", async () => {
    api.listAlerts.mockResolvedValue({
      data: {
        list: [
          {
            alert_id: "checkout-errors-id",
            folder_id: "default",
            destinations: [],
            last_triggered_at: (Date.now() - 3 * 60_000) * 1000,
            last_satisfied_at: null,
          },
        ],
      },
    });
    try {
      const row = liveRow({
        errors: cell("none"),
        latency: cell("none"),
        absence: cell("covered", "checkout-errors"),
      });
      const wrapper = mountDrawer(row, "watched", true, "absence");
      await flushPromises();
      const detail = wrapper
        .findAllComponents({ name: "CoverageSignalDetail" })
        .find((c) => c.props("signal") === "absence");
      expect(detail?.props("lastFired")).toBeNull();
      expect(detail?.find('[data-test="autoobserve-coverage-detail-last-fired"]').exists()).toBe(
        false,
      );
    } finally {
      api.listAlerts.mockReset();
    }
  });
  it("reads it from the service's own alerts instead of 'Not available'", async () => {
    api.listAlerts.mockResolvedValue({
      data: {
        list: [
          {
            alert_id: "checkout-errors-id",
            folder_id: "default",
            destinations: [],
            last_triggered_at: (Date.now() - 60_000) * 1000,
            last_satisfied_at: (Date.now() - 2 * 60 * 60_000) * 1000,
          },
        ],
      },
    });
    try {
      const row = liveRow({
        errors: cell("none"),
        latency: cell("none"),
        absence: cell("covered", "checkout-errors"),
      });
      const wrapper = mountDrawer(row, "watched", true, "absence");
      await flushPromises();
      const detail = wrapper
        .findAllComponents({ name: "CoverageSignalDetail" })
        .find((c) => c.props("signal") === "absence");
      expect(String(detail?.props("lastFired"))).toBe("2 hours ago");
    } finally {
      api.listAlerts.mockReset();
    }
  });
});

describe("CoverageServiceDrawer: the threshold line on a live chart (G7)", () => {
  it("draws where the service's own latency alert fires", async () => {
    api.listAlerts.mockResolvedValue({
      data: {
        list: [
          {
            alert_id: "checkout-p95-id",
            folder_id: "default",
            destinations: ["ops"],
            stream_type: "traces",
            condition: {
              sql: `SELECT approx_percentile_cont("duration", 0.95) AS p95 FROM "app_traces" HAVING approx_percentile_cont("duration", 0.95) > 34000`,
            },
            trigger_condition: { period: 15 },
          },
        ],
      },
    });
    api.correlate.mockResolvedValue({
      data: {
        service_name: "checkout",
        related_streams: {
          traces: [
            {
              stream_name: "app_traces",
              stream_type: "traces",
              filters: { service_name: "checkout" },
            },
          ],
          logs: [],
        },
      },
    });
    api.getStream.mockResolvedValue({ schema: [{ name: "duration", type: "Int64" }] });
    try {
      const row = liveRow(
        { errors: cell("none"), latency: cell("covered", "checkout-p95"), absence: cell("none") },
        [{ type: "traces", name: "app_traces" }],
      );
      const wrapper = mountDrawer(row, "watched");
      await flushPromises();
      const latency = wrapper
        .findAllComponents(ChartStub)
        .find((c) => c.props("def").signal === "latency");
      expect(latency?.props("def").threshold).toBe(34);
    } finally {
      api.listAlerts.mockReset();
      api.correlate.mockReset();
      api.getStream.mockReset();
      api.fetch.mockReset();
      const { resetCorrelationCache } = await import("./live/useServiceCharts");
      resetCorrelationCache();
    }
  });
});

describe("CoverageServiceDrawer header for a logs-only service (T2-7)", () => {
  it("offers Open in Logs instead of Traces and the Service Catalog", () => {
    const row = liveRow({ errors: cell("none"), latency: cell("none"), absence: cell("none") }, [
      { type: "logs", name: "ingest_e" },
    ]);
    const wrapper = mountDrawer(row, "gap");
    expect(wrapper.find('[data-test="autoobserve-coverage-drawer-logs"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="autoobserve-coverage-drawer-traces"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve-coverage-drawer-catalog"]').exists()).toBe(false);
  });
});

describe("CoverageServiceDrawer in live mode", () => {
  it("shows the table's three checks, with their cell words and dots, and nothing else", () => {
    const row = liveRow({
      errors: cell("none"),
      latency: cell("silent", "checkout-p99"),
      absence: cell("covered", "checkout-heartbeat"),
      saturation: cell("none"),
    });
    const wrapper = mountDrawer(row, "watched");
    const found = chips(wrapper);
    expect(found.map((c) => c.attributes("data-test"))).toEqual([
      "autoobserve-coverage-drawer-chip-errors",
      "autoobserve-coverage-drawer-chip-latency",
      "autoobserve-coverage-drawer-chip-absence",
    ]);
    expect(found.map((c) => c.text())).toEqual([
      "Errors: Coverage gap",
      "Latency: Coverage gap",
      "Stops sending: Watched",
    ]);
    const dot = (i: number) => found[i].find("span").classes().join(" ");
    expect(dot(0)).toContain(LIVE_DOT.gap);
    expect(dot(1)).toContain(LIVE_DOT.gap);
    expect(dot(2)).toContain(LIVE_DOT.covered);
    const charts = wrapper.findAllComponents(ChartStub).map((c) => c.props("def").signal);
    expect(charts).toEqual(["requests", "errors", "latency"]);
    const other = wrapper.find('[data-test="autoobserve-coverage-drawer-extra"]').text();
    expect(other).toContain("Saturation");
    expect(other).not.toContain("Stops sending");
    expect(other).toContain("Coverage gap");
    expect(other).not.toMatch(/\bNone\b/);
    expect(wrapper.find('[data-test="autoobserve-coverage-drawer-logs"]').exists()).toBe(false);
  });

  it("counts detectors over the three checks, the same count the table and map use", () => {
    const row = liveRow({
      errors: cell("none"),
      latency: cell("none"),
      absence: cell("covered", "checkout-heartbeat"),
      saturation: cell("none"),
    });
    expect(detectorsOf(row)).toBe(1);
    expect(mountDrawer(row, "watched").text()).toContain("1 detector");
  });

  it("explains a gap from each check's own reason, grouping the checks with no monitor", () => {
    const row = liveRow({
      errors: cell("silent", "checkout-errors"),
      latency: cell("blind", "checkout-p99"),
      absence: cell("none"),
    });
    const wrapper = mountDrawer(row, "gap");
    expect(wrapper.find('[data-test="autoobserve-coverage-drawer-state"]').text()).toBe(
      "Coverage gap",
    );
    const lines = wrapper
      .findAll('[data-test="autoobserve-coverage-drawer-gap-line"]')
      .map((l) => l.text());
    expect(lines).toEqual([
      "Errors: checkout-errors matches, but it notifies no one",
      "Latency: checkout-p99 matches, but it can't see its data",
      "No alert watches whether it stops sending",
    ]);
    expect(wrapper.text()).not.toContain("No scoped monitor");
  });

  it("names the service's streams that are still learning, with their ready date (W3)", () => {
    const until = (Date.now() + 5 * 86_400_000) * 1000;
    const day = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    const row = liveRow({ errors: cell("none"), latency: cell("none"), absence: cell("none") }, [
      { type: "logs", name: "app_logs", learning_until: until },
      { type: "traces", name: "app_traces", learning_until: null },
    ]);
    const line = mountDrawer(row, "gap").find('[data-test="autoobserve-coverage-drawer-learning"]');
    expect(line.text()).toBe(`Learning until ${day.format(until / 1000)} · app_logs (logs)`);
  });

  describe("every learning stream shows its own date (D10)", () => {
    const day = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    const inDays = (d: number) => (Date.now() + d * 86_400_000) * 1000;
    const learningRows = (count: number) =>
      liveRow(
        { errors: cell("none"), latency: cell("none"), absence: cell("none") },
        Array.from({ length: count }, (_, i) => ({
          type: "logs",
          name: `s${String(i).padStart(2, "0")}`,
          learning_until: inDays(count - i),
        })),
      );
    const rowsOf = (row: CoverageRow) =>
      mountDrawer(row, "gap")
        .findAll('[data-test="autoobserve-coverage-drawer-learning-stream"]')
        .map((r) =>
          r
            .findAll("span")
            .map((s) => s.text())
            .join(" "),
        );

    it("one stream reads as one sentence, with no list", () => {
      const row = learningRows(1);
      const wrapper = mountDrawer(row, "gap");
      expect(wrapper.find('[data-test="autoobserve-coverage-drawer-learning"]').text()).toBe(
        `Learning until ${day.format(inDays(1) / 1000)} · s00 (logs)`,
      );
      expect(wrapper.findAll('[data-test="autoobserve-coverage-drawer-learning-stream"]')).toEqual(
        [],
      );
    });

    it("three streams a day apart each list their own date, soonest first", () => {
      const row = learningRows(3);
      const wrapper = mountDrawer(row, "gap");
      expect(
        wrapper.find('[data-test="autoobserve-coverage-drawer-learning-summary"]').text(),
      ).toBe("Learning 3 streams");
      expect(rowsOf(row)).toEqual([
        `s02 (logs) until ${day.format(inDays(1) / 1000)}`,
        `s01 (logs) until ${day.format(inDays(2) / 1000)}`,
        `s00 (logs) until ${day.format(inDays(3) / 1000)}`,
      ]);
    });

    it("many streams are all listed, none folded into a count", () => {
      const row = learningRows(14);
      const rows = rowsOf(row);
      expect(rows).toHaveLength(14);
      for (let i = 0; i < 14; i += 1)
        expect(rows[i]).toBe(
          `s${String(13 - i).padStart(2, "0")} (logs) until ${day.format(inDays(i + 1) / 1000)}`,
        );
      expect(
        mountDrawer(row, "gap").find('[data-test="autoobserve-coverage-drawer-learning"]').text(),
      ).not.toMatch(/more stream/);
    });
  });

  it("has no learning line when the server sends no learning_until (W3)", () => {
    const row = liveRow({ errors: cell("none"), latency: cell("none"), absence: cell("none") }, [
      { type: "logs", name: "app_logs" },
    ]);
    expect(
      mountDrawer(row, "gap").find('[data-test="autoobserve-coverage-drawer-learning"]').exists(),
    ).toBe(false);
  });

  it("says once that no monitor watches any check, when none has one", () => {
    const row = liveRow({ errors: cell("none"), latency: cell("none"), absence: cell("none") });
    const lines = mountDrawer(row, "gap")
      .findAll('[data-test="autoobserve-coverage-drawer-gap-line"]')
      .map((l) => l.text());
    expect(lines).toEqual([
      "No alert watches its errors, its latency, or whether it stops sending",
    ]);
  });

  it("opens the absence check's detail from its chip", async () => {
    const row = liveRow({
      errors: cell("none"),
      latency: cell("none"),
      absence: cell("covered", "checkout-heartbeat"),
    });
    const wrapper = mountDrawer(row, "watched");
    const DETAIL = '[data-test="autoobserve-coverage-drawer-absence-detail"]';
    const chip = wrapper.find('[data-test="autoobserve-coverage-drawer-chip-absence"]');
    expect(wrapper.find(DETAIL).exists()).toBe(false);
    await chip.trigger("click");
    expect(wrapper.emitted("expand")?.at(-1)).toEqual(["absence"]);
    await wrapper.setProps({ expanded: "absence" });
    expect(wrapper.find(DETAIL).exists()).toBe(true);
    expect(chip.attributes("aria-expanded")).toBe("true");
    await chip.trigger("click");
    expect(wrapper.emitted("expand")?.at(-1)).toEqual([null]);
  });

  it("arrives with the absence detail open when the table's Absence cell opened it", () => {
    const row = liveRow({
      errors: cell("none"),
      latency: cell("none"),
      absence: cell("covered", "checkout-heartbeat"),
    });
    const wrapper = mountDrawer(row, "watched", true, "absence");
    expect(wrapper.find('[data-test="autoobserve-coverage-drawer-absence-detail"]').exists()).toBe(
      true,
    );
    expect(
      wrapper
        .find('[data-test="autoobserve-coverage-drawer-chip-absence"]')
        .attributes("aria-expanded"),
    ).toBe("true");
  });
});

describe("CoverageServiceDrawer live charts", () => {
  const TRACES = [{ type: "traces", name: "app_traces" }];
  const mountLive = (row: CoverageRow) =>
    mount(CoverageServiceDrawer, {
      props: {
        row,
        serviceStates: { [row.service]: "watched" },
        scenario: "demo",
        ledger: [],
        expanded: null,
        anchor: "body",
        fix: null,
        message: "",
        live: true,
      },
      global: {
        plugins: [i18n, store],
        stubs: { ODrawer: DrawerStub, CoverageSignalDetail: true },
      },
    });

  it("charts requests, errors and latency from the service's own data", async () => {
    api.correlate.mockResolvedValue({
      data: {
        service_name: "checkout",
        matched_dimensions: {},
        additional_dimensions: {},
        related_streams: {
          logs: [],
          traces: [
            {
              stream_name: "app_traces",
              stream_type: "traces",
              filters: { service_name: "checkout" },
            },
          ],
          metrics: [],
          profiles: [],
        },
      },
    });
    api.getStream.mockResolvedValue({
      schema: [
        { name: "span_status", type: "Utf8" },
        { name: "duration", type: "Int64" },
      ],
    });
    const row = liveRow(
      {
        errors: cell("none"),
        latency: cell("covered", "checkout-p99"),
        absence: cell("covered", "checkout-heartbeat"),
      },
      TRACES,
    );
    const wrapper = mountLive(row);
    await flushPromises();
    const call = api.fetch.mock.calls[0];
    if (call) {
      const step = 15 * 60_000;
      const t = new Date(Math.floor(Date.now() / step) * step - step).toISOString().slice(0, 19);
      call[1].data(call[0], {
        type: "search_response_hits",
        content: { results: { hits: [{ t, n: 90, e: 9, p95: 120_000 }] } },
      });
      call[1].complete(call[0], {});
    }
    await flushPromises();
    const sections = wrapper
      .findAll('section[data-test^="autoobserve-coverage-chart-"]')
      .map((s) => s.attributes("data-test"));
    expect(sections).toEqual([
      "autoobserve-coverage-chart-requests",
      "autoobserve-coverage-chart-errors",
      "autoobserve-coverage-chart-latency",
    ]);
    expect(wrapper.find('[data-test^="autoobserve-coverage-chart-nodata-"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Chart not available yet");
    const value = (signal: string) =>
      wrapper.find(`[data-test="autoobserve-coverage-chart-value-${signal}"]`).text();
    expect(value("requests")).toBe("6/min");
    expect(value("errors")).toBe("10%");
    expect(value("latency")).toBe("120 ms");
    expect(wrapper.find('[data-test="autoobserve-coverage-drawer-range"]').exists()).toBe(true);
  });
});

describe("CoverageServiceDrawer in fixture mode", () => {
  it("keeps the six design signals and the log patterns section", () => {
    const row = coverageFor("demo", gt)[0];
    const wrapper = mountDrawer(row, "watched", false);
    expect(chips(wrapper)).toHaveLength(6);
    expect(wrapper.find('[data-test="autoobserve-coverage-drawer-logs"]').exists()).toBe(true);
  });
});

describe("CoverageServiceDrawer synthetic check inputs (F6)", () => {
  it("reads the health address and the locations only once Synthetic check opens", async () => {
    const enterprise = config.isEnterprise;
    config.isEnterprise = "true";
    onTestFinished(() => {
      config.isEnterprise = enterprise;
    });
    const isAddress = (call: unknown[]) =>
      atob((call[0] as any).queryReq.query.sql).includes("server_address");
    api.fetch.mockImplementation((req: any, handlers: any) => {
      if (!atob(req.queryReq.query.sql).includes("server_address")) return;
      handlers.data(null, {
        type: "search_response_hits",
        content: {
          results: {
            hits: [{ server_address: "shop.example.com", server_port: 443, http_route: "/health" }],
          },
        },
      });
      handlers.complete();
    });
    api.getLocations.mockResolvedValue({
      data: {
        locations: [
          {
            id: "pub-1",
            kind: "public",
            status: "online",
            label: "EU",
            region: "eu",
            provider: "o2",
          },
        ],
      },
    });
    const row = liveRow(
      {
        errors: cell("none"),
        latency: cell("none"),
        absence: cell("none"),
        external_probe: cell("none"),
      },
      [{ type: "traces", name: "app_traces" }],
    );
    const wrapper = mountDrawer(row, "gap");
    await flushPromises();
    expect(api.fetch.mock.calls.filter(isAddress)).toHaveLength(0);
    expect(api.getLocations).not.toHaveBeenCalled();
    await wrapper
      .find('[data-test="autoobserve-coverage-drawer-row-external_probe"]')
      .trigger("click");
    await flushPromises();
    expect(api.fetch.mock.calls.filter(isAddress)).toHaveLength(1);
    expect(api.getLocations).toHaveBeenCalledTimes(1);
    const detail = wrapper
      .findAllComponents({ name: "CoverageSignalDetail" })
      .find((c) => c.props("signal") === "external_probe")!;
    const target = detail.props("insight").cta.target;
    expect(target.prefill.url).toBe("https://shop.example.com/health");
    expect(target.prefill.locations).toEqual(["pub-1"]);
  });

  it("fills the folder and who gets notified from the service's own alerts (F6)", async () => {
    const enterprise = config.isEnterprise;
    config.isEnterprise = "true";
    onTestFinished(() => {
      config.isEnterprise = enterprise;
    });
    api.fetch.mockImplementation(() => undefined);
    api.getLocations.mockResolvedValue({ data: { locations: [] } });
    api.listAlerts.mockResolvedValue({
      data: {
        list: [
          {
            alert_id: "checkout-errors-id",
            folder_id: "f-pay",
            folder_name: "payments",
            destinations: ["pay-slack"],
          },
          { alert_id: "other-id", folder_id: "f-x", folder_name: "x", destinations: ["x"] },
        ],
      },
    });
    const row = liveRow(
      {
        errors: cell("covered", "checkout-errors"),
        latency: cell("none"),
        absence: cell("none"),
        external_probe: cell("none"),
      },
      [{ type: "traces", name: "app_traces" }],
    );
    const wrapper = mountDrawer(row, "gap");
    await wrapper
      .find('[data-test="autoobserve-coverage-drawer-row-external_probe"]')
      .trigger("click");
    await flushPromises();
    const detail = wrapper
      .findAllComponents({ name: "CoverageSignalDetail" })
      .find((c) => c.props("signal") === "external_probe")!;
    const prefill = detail.props("insight").cta.target.prefill;
    expect(prefill.folder).toBe("f-pay");
    expect(prefill.destinations).toEqual(["pay-slack"]);
  });
});

describe("CoverageServiceDrawer gap CTA counts what it can build (T2-11)", () => {
  it("offers one Add alert when the stream has no field to count errors by", async () => {
    const enterprise = config.isEnterprise;
    config.isEnterprise = "true";
    onTestFinished(() => {
      config.isEnterprise = enterprise;
      api.schema.mockReset();
    });
    api.schema.mockResolvedValue({
      data: {
        schema: [
          { name: "service_name" },
          { name: "k8s_cluster" },
          { name: "k8s_namespace_name" },
          { name: "body" },
        ],
      },
    });
    // The no-data draft's filter keeps the stream's rows, so only the errors draft is ruled out.
    api.fetch.mockImplementation((_req: unknown, handlers: any) => {
      handlers.data(null, {
        type: "search_response_hits",
        content: { results: { hits: [{ total: 10, matching: 10 }] } },
      });
      handlers.complete();
    });
    const row = liveRow(
      { errors: cell("none"), latency: cell("covered", "checkout-p95"), absence: cell("none") },
      [{ type: "logs", name: "checkout_logs" }],
    );
    const wrapper = mountDrawer(row, "gap");
    await flushPromises();
    const cta = wrapper.find(
      '[data-test="autoobserve-coverage-drawer-gap-actions"] [data-test$="-cta"]',
    );
    expect(cta.text()).toBe("Add alert");
  });
});

describe("CoverageServiceDrawer Service Catalog link (T2-7)", () => {
  it("opens the catalog filtered to the service", async () => {
    api.push.mockReset();
    const row = liveRow(
      {
        errors: cell("covered", "e"),
        latency: cell("covered", "l"),
        absence: cell("covered", "a"),
      },
      [{ type: "traces", name: "default" }],
    );
    const wrapper = mountDrawer(row, "watched");
    await wrapper.find('[data-test="autoobserve-coverage-drawer-catalog"]').trigger("click");
    expect(api.push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "traces",
        query: expect.objectContaining({ tab: "services-catalog", service: "checkout" }),
      }),
    );
  });
});
