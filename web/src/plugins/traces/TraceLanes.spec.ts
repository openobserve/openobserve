// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";

const findRelatedTelemetry = vi.fn();
const search = vi.fn();
const metricsQueryRange = vi.fn();
const metricsQuery = vi.fn();

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: { identifier: "default" },
      zoConfig: { timestamp_column: "_timestamp" },
    },
  }),
}));
vi.mock("@/composables/useLockedAffordance", () => ({
  useLockedAffordance: () => computed(() => ({ allowed: true })),
}));
vi.mock("@/composables/useEnterpriseUpgradeDialog", () => ({
  useEnterpriseUpgradeDialog: () => ({ open: vi.fn() }),
}));
vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: () => ({ findRelatedTelemetry }),
}));
vi.mock("@/services/search", () => ({
  default: {
    search: (...args: unknown[]) => search(...args),
    metrics_query_range: (...args: unknown[]) => metricsQueryRange(...args),
    metrics_query: (...args: unknown[]) => metricsQuery(...args),
  },
}));

import TraceLanes from "./TraceLanes.vue";

const S = 1_000_000_000; // ns per second
const START_S = 1793230296.5;
const END_S = 1793230329.95;

const spans = (extra: Record<string, unknown> = {}) => [
  {
    span_id: "root",
    reference_parent_span_id: "",
    start_time: START_S * S,
    end_time: END_S * S,
    operation_name: "root",
    service_name: "api",
    ...extra,
  },
];

const mountLanes = (spanList = spans()) =>
  mount(TraceLanes, {
    props: {
      spans: spanList,
      streamName: "default",
      axisStartUs: START_S * 1_000_000,
      axisDurationUs: (END_S - START_S) * 1_000_000,
      labelWidth: 120,
    },
    global: {
      plugins: [i18n],
      stubs: { OIcon: true, OTruncatedText: { template: "<span><slot /></span>" } },
    },
  });

describe("TraceLanes", () => {
  beforeEach(() => {
    findRelatedTelemetry.mockReset();
    search.mockReset();
    metricsQueryRange.mockReset();
    metricsQuery.mockReset();
  });

  it("says so in one row when nothing correlates", async () => {
    findRelatedTelemetry.mockResolvedValue(null);
    const wrapper = mountLanes();
    await flushPromises();
    const row = wrapper.find('[data-test="trace-lanes-empty"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain("No correlated logs or metrics for these services.");
  });

  it("says the load failed when a query errored and nothing loaded", async () => {
    findRelatedTelemetry.mockRejectedValue(new Error("boom"));
    const wrapper = mountLanes();
    await flushPromises();
    expect(wrapper.find('[data-test="trace-lanes-failed"]').text()).toContain(
      "Could not load correlated logs or metrics.",
    );
  });

  it("samples log lines from both ends of the window, each line once", async () => {
    findRelatedTelemetry.mockResolvedValue({
      correlationData: {
        related_streams: {
          logs: [{ stream_name: "app_logs", filters: { service: "api" } }],
          metrics: [],
        },
      },
    });
    const early = { _timestamp: (START_S + 1) * 1_000_000, message: "start" };
    const late = { _timestamp: (END_S - 1) * 1_000_000, message: "end" };
    search.mockImplementation(({ query }: { query: { query: { sql: string } } }) =>
      Promise.resolve({
        data: { hits: query.query.sql.endsWith("ASC") ? [early, late] : [late] },
      }),
    );
    const wrapper = mountLanes();
    await flushPromises();

    const sqls = search.mock.calls.map(([arg]) => arg.query.query.sql as string);
    expect(sqls.some((sql) => sql.endsWith("ASC"))).toBe(true);
    expect(sqls.some((sql) => sql.endsWith("DESC"))).toBe(true);
    expect(search.mock.calls.every(([arg]) => arg.query.query.size === 100)).toBe(true);
    expect(wrapper.findAll('[data-test="trace-lane-log-tick"]')).toHaveLength(2);
  });

  it("shows the restart inside the axis when the scrape grid puts the rise after the spans", async () => {
    findRelatedTelemetry.mockResolvedValue(null);
    metricsQueryRange.mockResolvedValue({
      data: {
        data: {
          result: [
            {
              values: [
                [1793230320, "2"],
                [1793230335, "3"],
              ],
            },
          ],
        },
      },
    });
    metricsQuery.mockResolvedValue({
      data: { data: { result: [{ metric: { reason: "OOMKilled" }, value: [0, "1"] }] } },
    });
    const wrapper = mountLanes(spans({ k8s_pod_name: "api-0" }));
    await flushPromises();

    expect(wrapper.find('[data-test="trace-lane-pod-oomKilled"]').exists()).toBe(true);
    const marker = wrapper.find('[data-test="trace-lane-pod-restart"]');
    expect(marker.exists()).toBe(true);
    const left = parseFloat((marker.element as HTMLElement).style.left);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(100);
    expect(marker.classes()).not.toContain("bg-error-600");
  });
});
