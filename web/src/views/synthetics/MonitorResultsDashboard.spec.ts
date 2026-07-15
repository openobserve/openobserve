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

// @vitest-environment jsdom
//
// Render tests for MonitorResultsDashboard.vue — pins the KPI-card glue
// (value/unit derivation from the composable's typed state) and the runs
// table wiring. The query builders / mappers are covered in
// `composables/synthetics/syntheticResultsSchema.spec.ts` and the fetch
// orchestration in `composables/useSyntheticResults.spec.ts`.

import { ref } from "vue";

const mockKpi = ref({
  uptimePct: 0,
  p95Ms: 0,
  failedRuns: 0,
  totalRuns: 0,
  lastRunStatus: null as "passed" | "warning" | "failed" | "error" | null,
  lastRunAt: null as number | null,
});
const mockBuckets = ref<any[]>([]);
const mockRuns = ref<any[]>([]);
const mockLoading = ref(false);
const mockFetchAll = vi.fn(async () => {});
const mockCancelAll = vi.fn();

vi.mock("@/composables/useSyntheticResults", () => ({
  default: () => ({
    kpi: mockKpi,
    buckets: mockBuckets,
    runs: mockRuns,
    loading: mockLoading,
    error: ref(null),
    hasLoadedOnce: ref(true),
    fetchAll: mockFetchAll,
    cancelAll: mockCancelAll,
  }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

vi.mock("echarts", () => ({
  init: () => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  }),
}));

vi.mock("@/services/synthetics", () => ({
  default: {
    getRuns: vi.fn(),
  },
}));

vi.mock("vuex", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useStore: vi.fn(() => ({
      state: { selectedOrganization: { identifier: "test-org" } },
    })),
  };
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import MonitorResultsDashboard from "./MonitorResultsDashboard.vue";
import syntheticsService from "@/services/synthetics";

function mountDashboard() {
  return mount(MonitorResultsDashboard, {
    props: {
      monitorId: "mon-1",
      startTime: 1_700_000_000_000_000,
      endTime: 1_700_003_600_000_000,
    },
    global: {
      stubs: {
        KpiSparkline: { template: '<div data-test="kpi-sparkline" />' },
        RunRowExpansion: { template: '<div class="run-expansion" />' },
      },
    },
  });
}

describe("MonitorResultsDashboard", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    mockKpi.value = {
      uptimePct: 99.65,
      p95Ms: 2940,
      failedRuns: 1,
      totalRuns: 288,
      lastRunStatus: "passed",
      lastRunAt: Date.now() - 120_000,
    };
    mockBuckets.value = [
      { tsMs: 1, avgMs: 1500, p95Ms: 2000, uptimePct: 100, failedRuns: 0 },
      { tsMs: 2, avgMs: 1600, p95Ms: 2100, uptimePct: 99, failedRuns: 1 },
    ];
    mockRuns.value = [
      { timestamp: Date.now(), status: "passed", durationMs: 1820, location: "us-east-1", device: "desktop", error: "" },
      { timestamp: Date.now(), status: "failed", durationMs: 1760, location: "ap-southeast-1", device: "mobile", error: "Timeout" },
    ];
    vi.mocked(syntheticsService.getRuns).mockResolvedValue({
      data: {
        runs: [
          { id: "run-1", status: "passed", scheduled_ts: Date.now(), completed_at: Date.now() + 1820, location: "us-east-1", device: "desktop", trigger_type: "scheduled", jobs_done: 1, job_count: 1 },
          { id: "run-2", status: "failed", scheduled_ts: Date.now(), completed_at: Date.now() + 1760, location: "ap-southeast-1", device: "mobile", trigger_type: "scheduled", jobs_done: 0, job_count: 1, error: "Timeout" },
        ],
        total: 2,
      },
    } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("should render the four KPI cards with values derived from the kpi state", () => {
    wrapper = mountDashboard();
    expect(
      wrapper.find('[data-test="synthetic-monitor-results-kpi-uptime"]').text(),
    ).toContain("99.65");
    expect(
      wrapper.find('[data-test="synthetic-monitor-results-kpi-failed"]').text(),
    ).toContain("1");
    // p95 of 2940ms → splitDuration(2940000 micros) → "2.9" "s".
    const p95Text = wrapper
      .find('[data-test="synthetic-monitor-results-kpi-p95"]')
      .text();
    expect(p95Text).toContain("2.9");
    // Last Run shows the i18n key for "passed".
    expect(
      wrapper.find('[data-test="synthetic-monitor-results-kpi-last-run"]').text(),
    ).toContain("synthetics.results.passed");
  });

  it("should render runs after refresh fetches data via REST API", async () => {
    wrapper = mountDashboard();
    // refresh() triggers fetchRuns() which calls syntheticsService.getRuns()
    await (wrapper.vm as any).refresh();
    await flushPromises();
    // After fetchRuns() completes, the custom HTML table renders .runs-row elements
    const rows = wrapper.findAll(".runs-row");
    expect(rows).toHaveLength(2);
    // First run has "passed" status text
    expect(rows[0].text()).toContain("synthetics.results.passed");
    // Second run has "failed" status text
    expect(rows[1].text()).toContain("synthetics.results.failed");
  });

  it("should call fetchAll when the exposed refresh() is invoked", async () => {
    wrapper = mountDashboard();
    await (wrapper.vm as any).refresh(111, 222);
    await flushPromises();
    expect(mockFetchAll).toHaveBeenCalledWith("mon-1", 111, 222);
  });
});
