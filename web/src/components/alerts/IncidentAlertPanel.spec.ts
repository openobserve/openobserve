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
import { flushPromises, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createStore } from "vuex";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import alerts from "@/services/alerts";
import incidents from "@/services/incidents";
import { queryClient } from "@/composables/query/queryClient";
import { makeAlertSectionRouter } from "@/test/unit/helpers/alertSectionRouter";
import { b64DecodeUnicode } from "@/utils/zincutils";
import { incidentUnfold } from "@/utils/incidents/incidentUnfold";
import type { IncidentAlertSummary } from "@/utils/incidents/incidentUnfold";
import type { IncidentAlertListRow } from "@/utils/incidents/incidentAlertPanel";
import IncidentAlertPanel from "./IncidentAlertPanel.vue";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/services/incidents", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});

const MIN = 60_000_000;
const NOW = Date.UTC(2026, 10, 12, 7, 45) * 1000;
const FIRST = Date.UTC(2026, 10, 11, 15, 35) * 1000;

const store = createStore({
  state: { selectedOrganization: { identifier: "acme" }, timezone: "UTC" },
});
const router = makeAlertSectionRouter();

const summary = (over: Partial<IncidentAlertSummary> = {}): IncidentAlertSummary => ({
  alertId: "a1",
  name: "go_gc_rate_high",
  tone: "warning",
  count: 2,
  first: FIRST,
  last: FIRST + 30 * MIN,
  times: ["Nov 11, 15:35", "Nov 11, 16:05"],
  medianInterval: 30 * MIN,
  longestGap: 30 * MIN,
  groupedBy: raw("Same service"),
  ...over,
});

const row = (over: Partial<IncidentAlertListRow> = {}): IncidentAlertListRow => ({
  alert_id: "a1",
  name: "go_gc_rate_high",
  enabled: true,
  stream_type: "metrics",
  stream_name: "go_gc_duration_seconds_count",
  folder_id: "f1",
  folder_name: "K8s library",
  description: "Go GC runs too often.",
  last_satisfied_at: NOW - 12 * MIN,
  condition: {
    type: "promql",
    promql: "rate(go_gc[5m])",
    promql_condition: { operator: ">", value: 10 },
  },
  trigger_condition: { period: 5, frequency: 5, frequency_type: "minutes", silence: 30 },
  ...over,
});

const definition = {
  id: "a1",
  name: "go_gc_rate_high",
  stream_type: "metrics",
  stream_name: "go_gc_duration_seconds_count",
  owner: "root@acme.io",
  destinations: ["k8s-alerts"],
  notify_on_recovery: false,
  query_condition: row().condition,
  trigger_condition: row().trigger_condition,
};

const getDetail = vi.fn();
const getHistory = vi.fn();
const getHistorySummary = vi.fn();
const listIncidents = vi.fn();

const mountPanel = async (props: Record<string, unknown> = {}) => {
  const wrapper = mount(IncidentAlertPanel, {
    props: {
      summary: summary(),
      row: row(),
      rowsState: "ready",
      incidentId: "inc-1",
      zone: "UTC",
      now: NOW,
      ...props,
    },
    attachTo: document.body,
    global: {
      provide: { store },
      plugins: [i18n, router, [VueQueryPlugin, { queryClient }]],
      stubs: {
        ODrawer: {
          props: ["open"],
          template:
            "<div v-if='open' data-test='drawer'><slot name='header' /><slot /><slot name='footer' /></div>",
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
};
const text = (wrapper: Awaited<ReturnType<typeof mountPanel>>, id: string) =>
  wrapper.get(`[data-test="incident-alert-panel-${id}"]`).text();

describe("IncidentAlertPanel", () => {
  beforeEach(() => {
    queryClient.clear();
    getDetail.mockReset().mockResolvedValue({ data: definition });
    getHistory.mockReset().mockImplementation(() =>
      Promise.resolve({
        data: {
          hits: [
            {
              timestamp: FIRST + 30 * MIN,
              actual_value: 16.3,
              threshold_value: 10,
              threshold_operator: ">",
            },
          ],
        },
      }),
    );
    getHistorySummary.mockReset().mockImplementation((_org, query) =>
      Promise.resolve({
        data: {
          rows: [
            {
              bucket: Date.UTC(2026, 10, 5) * 1000,
              alert_id: "a1",
              outcome: "firing",
              n: 32,
              silenced: 32,
            },
            {
              bucket: Date.UTC(2026, 10, 11) * 1000,
              alert_id: "a1",
              outcome: "firing",
              n: 48,
              silenced: 40,
            },
          ].filter((row) => row.bucket >= query.start_time && row.bucket < query.end_time),
          interval: query.interval,
          start_time: query.start_time,
          end_time: query.end_time,
          is_partial: false,
        },
      }),
    );
    Object.assign(alerts as object, { get_by_alert_id: getDetail, getHistory, getHistorySummary });
    listIncidents.mockReset().mockResolvedValue({ data: { incidents: [], total: 0 } });
    Object.assign(incidents as object, { list: listIncidents });
  });

  it("is closed without an alert", async () => {
    const wrapper = await mountPanel({ summary: null });
    expect(wrapper.find('[data-test="drawer"]').exists()).toBe(false);
    expect(getDetail).not.toHaveBeenCalled();
  });

  it("heads with the name, its tag and where it reads from, and closes from the title row", async () => {
    const wrapper = await mountPanel({
      summary: summary({ tag: "alerts.incidents.unfold.firstToFire" }),
    });
    expect(text(wrapper, "header")).toMatch(
      /go_gc_rate_high.*Metrics · go_gc_duration_seconds_count · K8s library.*First to fire/,
    );
    await wrapper.get('[data-test="incident-alert-panel-close"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("sums up its firings in this incident on one line, with a histogram only above 8", async () => {
    const twice = await mountPanel();
    expect(text(twice, "incident")).toMatch(/^×2 · Nov 11, 15:35 → 16:05 · every ~30 min/);
    expect(twice.find('[data-test="incident-alert-panel-histogram"]').exists()).toBe(false);
    twice.unmount();
    const histogram = { points: [1, 0, 8], caption: raw("c"), ticks: [raw("from"), raw("to")] };
    const many = await mountPanel({ summary: summary({ count: 9, times: undefined, histogram }) });
    expect(text(many, "histogram")).toMatch(/from\s*to/);
  });

  it.each([
    ["fired within its last 2 checks plus the silence", {}, "Firing now"],
    ["a normal check since", { last_outcome: "normal" }, "Quiet now"],
    ["its last check errored", { last_outcome: "error" }, "Can't run · last check errored"],
    ["turned off", { enabled: false }, "Disabled"],
  ])("states the alert now by the card's rule: %s", async (_case, over, state) => {
    const wrapper = await mountPanel({ row: row(over) });
    expect(text(wrapper, "state")).toBe(state);
  });

  it("links a later firing to the incident that holds it, and says nothing without one", async () => {
    (await mountPanel({ row: row({ last_satisfied_at: FIRST + 30 * MIN }) })).unmount();
    expect(listIncidents).not.toHaveBeenCalled();
    const later = { last_satisfied_at: FIRST + 24 * 60 * MIN };
    const elsewhere = {
      id: "inc-2",
      first_alert_at: FIRST + 23 * 60 * MIN,
      last_alert_at: FIRST + 25 * 60 * MIN,
      alert_groups: [{ alert_id: "a1", alert_name: "go_gc_rate_high", count: 3 }],
    };
    const none = await mountPanel({ row: row(later) });
    expect(none.find('[data-test="incident-alert-panel-fired-again"]').exists()).toBe(false);
    none.unmount();
    queryClient.clear();
    listIncidents.mockResolvedValue({ data: { incidents: [elsewhere], total: 1 } });
    const linked = await mountPanel({ row: row(later) });
    const link = linked.get('[data-test="incident-alert-panel-fired-again"]');
    expect(link.text()).toBe("Fired again 15:35 in another incident");
    expect(link.attributes("href")).toContain("/incidents/inc-2");
  });

  // History rows carry processing time; the firing's own evaluation is the first at or after it.
  it.each([
    ["a later firing", FIRST + 31 * MIN - 1_000_000, 50_000_000, "16:05"],
    [
      "an evaluation processed before the firing",
      FIRST + 30 * MIN - 5_000_000,
      50_000_000,
      "16:05",
    ],
    ["a later firing when the queue held it past one check", FIRST + 38 * MIN, 7 * MIN, "16:12"],
  ])(
    "puts the incident's last firing's own value beside what the alert needs, not %s",
    async (_name, otherAt, delay, at) => {
      const hits = [
        { timestamp: otherAt, actual_value: 999 },
        { timestamp: FIRST + 30 * MIN + delay, actual_value: 16.3 },
      ];
      getHistory.mockImplementation((_org: string, query: { size: number }) =>
        Promise.resolve({ data: { hits: hits.slice(0, query.size) } }),
      );
      const wrapper = await mountPanel();
      expect(text(wrapper, "value")).toBe(`16.3 at ${at} · alert now needs > 10 over 5 min`);
    },
  );

  it("reads each firing's own evaluation, even for two firings seconds apart", async () => {
    getHistory.mockImplementation((_org: string, query: { start_time: number }) =>
      Promise.resolve({
        data: { hits: [{ timestamp: query.start_time, actual_value: query.start_time % 7 }] },
      }),
    );
    const at = FIRST + 30 * MIN;
    (await mountPanel({ summary: summary({ last: at }) })).unmount();
    const second = await mountPanel({
      incidentId: "inc-2",
      summary: summary({ last: at + 10_000_000 }),
    });
    expect(text(second, "value")).toMatch(new RegExp(`^${(at + 10_000_000) % 7} at`));
  });

  it("starts the condition with a capital when no firing value leads the line", async () => {
    getHistory.mockResolvedValue({ data: { hits: [] } });
    expect(text(await mountPanel(), "value")).toBe("Needs > 10 over 5 min");
  });

  // The history record carries no evaluation window, so today's period is not claimed for it.
  it("explains historical firings with recorded thresholds after edits", async () => {
    getDetail.mockResolvedValue({
      data: {
        ...definition,
        query_condition: { type: "promql", promql_condition: { operator: ">", value: 1000 } },
        trigger_condition: { ...definition.trigger_condition, period: 60 },
      },
    });
    const wrapper = await mountPanel();
    expect(text(wrapper, "value")).toBe("16.3 at 16:05 · alert needs > 10");
    expect(
      wrapper
        .get('[data-test="incident-alert-panel-schedule"]')
        .findComponent({ name: "OTooltip" })
        .props("content"),
    ).toContain("alert now needs > 1,000 over 1 h");
    expect(text(wrapper, "value")).not.toContain("1,000");
  });

  it("shows the last 7 days as one figure and a bar per day", async () => {
    const wrapper = await mountPanel();
    expect(text(wrapper, "week-total")).toMatch(/^48\s*· 1\/7 days/);
    const days = wrapper.findAll('[data-test^="incident-alert-panel-week-day-"]');
    expect(days).toHaveLength(7);
    expect(days.every((day) => day.attributes("data-o-tooltip-trigger") !== undefined)).toBe(true);
    const tips = wrapper
      .get('[data-test="incident-alert-panel-week-bars"]')
      .findAllComponents({ name: "OTooltip" })
      .map((tip) => tip.props("content"));
    expect(tips.slice(4)).toEqual([
      "Tue, Nov 10: no firings",
      "Wed, Nov 11: 48 firings",
      "Thu, Nov 12: no firings",
    ]);
    const windows = getHistorySummary.mock.calls.map(([, query]) => query);
    expect(windows).toHaveLength(2);
    expect(windows[0].end_time).toBe(windows[1].start_time);
    expect(
      windows.every(
        (query) =>
          query.interval === 900 &&
          (query.end_time - query.start_time) / 1_000_000 / query.interval <= 500,
      ),
    ).toBe(true);

    await wrapper.setProps({ open: false, now: NOW + 24 * 60 * MIN });
    await wrapper.setProps({ open: true });
    await flushPromises();
    expect(getHistorySummary.mock.calls.at(-1)?.[1].end_time).toBe(NOW + 24 * 60 * MIN);
  });

  it("keeps a complete week complete when reopened later in the same cached minute", async () => {
    const wrapper = await mountPanel();
    const calls = getHistorySummary.mock.calls.length;
    await wrapper.setProps({ open: false, now: NOW + 20_000_000 });
    await wrapper.setProps({ open: true });
    await flushPromises();
    expect(getHistorySummary.mock.calls.length).toBe(calls);
    expect(wrapper.find('[data-test="incident-alert-panel-week-incomplete"]').exists()).toBe(false);
  });

  it("does not turn clamped or partial history into a complete empty week", async () => {
    for (const partial of [false, true]) {
      queryClient.clear();
      getHistorySummary.mockReset().mockImplementation((_org, query) =>
        Promise.resolve({
          data: {
            rows: [],
            interval: 900,
            is_partial: partial,
            start_time: partial ? query.start_time : query.end_time - 24 * 60 * MIN,
            end_time: query.end_time,
          },
        }),
      );
      const wrapper = await mountPanel();
      expect(text(wrapper, "week")).not.toContain("None in 7 days");
      expect(wrapper.find('[data-test="incident-alert-panel-week-incomplete"]').exists()).toBe(
        true,
      );
      wrapper.unmount();
    }
  });

  // Search-backed sections fail fast under the app's retry policy, so a degraded search never holds a skeleton.
  it.each([
    ["week", () => getHistorySummary, { data: { rows: [] } }, "None in 7 days"],
    [
      "value",
      () => getHistory,
      { data: { hits: [{ timestamp: FIRST + 30 * MIN, actual_value: 3 }] } },
      "3 at",
    ],
  ])(
    "the %s section shows a skeleton, then a red error with Retry, then its data",
    async (id, api, ok, shown) => {
      const appRetry = queryClient.getDefaultOptions().queries;
      queryClient.setDefaultOptions({ queries: { ...appRetry, retry: 2 } });
      let fail: (err: unknown) => void = () => undefined;
      api()
        .mockReset()
        .mockReturnValue(new Promise((_r, reject) => (fail = reject)));
      const wrapper = await mountPanel({ summary: summary({ count: 1, times: ["15:35"] }) });
      expect(wrapper.find(`[data-test="incident-alert-panel-${id}-loading"]`).exists()).toBe(true);

      fail({ response: { status: 500, data: { message: "MemoryCircuitBreakerError" } } });
      await flushPromises();
      const section = text(wrapper, id === "week" ? "week" : "why");
      expect(section).not.toMatch(/MemoryCircuitBreaker|500/);
      expect(wrapper.get(`[data-test="incident-alert-panel-${id}-error"]`).text()).toContain(
        "Couldn't load",
      );
      if (id === "value")
        expect(
          wrapper
            .get('[data-test="incident-alert-panel-schedule"]')
            .findComponent({ name: "OTooltip" })
            .props("content"),
        ).toContain("alert needs > 10 over 5 min");
      if (id === "week") expect(section).toContain("search is busy");
      expect(api()).toHaveBeenCalledTimes(id === "week" ? 2 : 1);

      api().mockImplementation((_org, query) =>
        Promise.resolve({
          ...ok,
          data: {
            ...ok.data,
            start_time: query.start_time,
            end_time: query.end_time,
            is_partial: false,
          },
        }),
      );
      const before = api().mock.calls.length;
      await wrapper.get(`[data-test="incident-alert-panel-${id}-retry"]`).trigger("click");
      await flushPromises();
      expect(api().mock.calls.length).toBeGreaterThan(before);
      expect(text(wrapper, id === "week" ? "week" : "why")).toContain(shown);
      queryClient.setDefaultOptions({ queries: appRetry });
    },
  );

  it("shows the alert's state as loading, then failed with Retry", async () => {
    const loading = await mountPanel({ row: undefined, rowsState: "loading" });
    expect(loading.find('[data-test="incident-alert-panel-state"]').exists()).toBe(false);
    loading.unmount();
    const failed = await mountPanel({ row: undefined, rowsState: "error" });
    await failed.get('[data-test="incident-alert-panel-state-retry"]').trigger("click");
    expect(failed.emitted("retry-state")).toHaveLength(1);
  });

  it.each([
    [{}, "Notifies k8s-alerts"],
    [{ destinations: ["a", "b", "c"] }, "Notifies a, +2"],
    [{ destinations: [], oncall_team: "team-1" }, "Notifies an on-call team"],
    [{ destinations: [], workflows: ["w1", "w2"] }, "Notifies 2 workflows"],
    [{ destinations: [] }, "Notifies no one"],
  ])("names the first thing it notifies and counts the rest: %o", async (over, shown) => {
    getDetail.mockResolvedValue({ data: { ...definition, ...over } });
    expect(text(await mountPanel(), "notifies")).toBe(shown);
  });

  it("regenerates a filter-built alert's query once its definition replaces the list row", async () => {
    const custom = (value: string) => ({
      type: "custom",
      conditions: [{ column: "status", operator: "=", value }],
    });
    let answer: (value: unknown) => void = () => undefined;
    getDetail.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const generate_sql = vi.fn(async (_org, data) => ({
      data: { sql: `SELECT * WHERE status = ${data.query_condition.conditions[0].value}` },
    }));
    Object.assign(alerts as object, { generate_sql });
    const place = { stream_type: "logs", stream_name: "requests" };
    const wrapper = await mountPanel({ row: row({ ...place, condition: custom("500") }) });
    expect(text(wrapper, "query")).toContain("status = 500");
    answer({ data: { ...definition, ...place, query_condition: custom("400") } });
    await flushPromises();
    expect(text(wrapper, "query")).toContain("status = 400");
  });

  it("carries external identity from the graph and only links its source", async () => {
    const external = incidentUnfold(
      {
        status: "open",
        firstAlertAt: FIRST,
        now: NOW,
        triggers: [
          {
            alert_id: "external-record",
            alert_name: "External alert",
            alert_fired_at: FIRST,
            alert_kind: "external",
            source_url: "https://example.com/alert",
          },
        ],
      },
      i18n.global.t,
    ).alerts["alert-external-record"];
    const wrapper = await mountPanel({ summary: external, row: undefined });
    expect(getDetail).not.toHaveBeenCalled();
    expect(getHistory).not.toHaveBeenCalled();
    expect(getHistorySummary).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="incident-alert-panel-open-alert"]').exists()).toBe(false);
    const link = wrapper.get('[data-test="incident-alert-panel-source"]');
    expect(link.attributes("href")).toBe("https://example.com/alert");
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener noreferrer");
    await wrapper.setProps({ summary: { ...external, sourceUrl: null } });
    expect(wrapper.find('[data-test="incident-alert-panel-source"]').exists()).toBe(false);
  });

  it("links to logs at the firing only for a logs alert", async () => {
    const metrics = await mountPanel();
    expect(metrics.find('[data-test="incident-alert-panel-logs"]').exists()).toBe(false);
    expect(metrics.find('[data-test="incident-alert-panel-open-alert"]').exists()).toBe(true);
    metrics.unmount();
    queryClient.clear();

    const logsRow = row({
      stream_type: "logs",
      stream_name: "vpc_flow",
      condition: { type: "sql", sql: 'SELECT * FROM "vpc_flow"' },
      trigger_condition: { period: 15, frequency: 15, operator: ">=", threshold: 1 },
    });
    getDetail.mockResolvedValue({
      data: { ...definition, ...logsRow, query_condition: logsRow.condition },
    });
    const logs = await mountPanel({
      row: logsRow,
      summary: summary({ count: 1, times: ["15:35"] }),
    });
    const url = new URL(
      logs.get('[data-test="incident-alert-panel-logs"]').attributes("href")!,
      "http://x",
    );
    expect(url.searchParams.get("stream")).toBe("vpc_flow");
    expect(Number(url.searchParams.get("from"))).toBe(FIRST - 15 * MIN);
    expect(Number(url.searchParams.get("to"))).toBe(FIRST);
    expect(b64DecodeUnicode(url.searchParams.get("query")!)).toBe('SELECT * FROM "vpc_flow"');
  });
});
