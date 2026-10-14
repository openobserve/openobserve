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
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import alertCalibration from "@/services/alert_calibration";
import AlertCalibrationDigests from "./AlertCalibrationDigests.vue";
import type { RunRow } from "./digests";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/aws-exports")>();
  return { default: { ...actual.default, isEnterprise: "true" } };
});

vi.mock("@/services/alert_calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/alert_calibration")>();
  return {
    ...actual,
    default: { ...actual.default, getConfig: vi.fn(), searchDigests: vi.fn(), requestRun: vi.fn() },
  };
});

const DAY_MICROS = 86_400_000_000;
const NOW = Date.now() * 1000;

const run = (windowEnd: number, emittedAt: number, findings: number): RunRow => ({
  window_start: windowEnd - 30 * DAY_MICROS,
  window_end: windowEnd,
  emitted_at: emittedAt,
  finding_count: findings,
  skip_count: 2,
  alerts_in_scope: 8,
  coverage_gap: false,
  coverage_window_clamped: false,
  coverage_dropped_span_secs: 0,
  coverage_unreadable_definitions: 0,
  coverage_facts_without_definition: 0,
  coverage_definitions_without_facts: 0,
  coverage_transitions_truncated: false,
  coverage_counters_truncated: false,
  coverage_error_clusters_truncated: false,
  coverage_error_clusters_unattributed: 0,
  coverage_stream_substrate_empty: false,
  coverage_meta_fallback_used: false,
});

const mountPage = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/alert-calibration", name: "alertCalibration", component: AlertCalibrationDigests },
      {
        path: "/alert-calibration/dashboard",
        name: "alertCalibrationDashboard",
        component: { template: "<div />" },
      },
      {
        path: "/alert-calibration/digests/:windowStart/:windowEnd",
        name: "alertCalibrationDigest",
        component: { template: "<div />" },
      },
      {
        path: "/settings/alert_calibration",
        name: "alertCalibrationSettings",
        component: { template: "<div />" },
      },
      { path: "/alerts", name: "alertList", component: { template: "<div />" } },
    ],
  });
  await router.push({ name: "alertCalibration", query: { org_identifier: "default" } });
  await router.isReady();
  const wrapper = mount(AlertCalibrationDigests, {
    global: { plugins: [store, router] },
    attachTo: document.body,
  });
  await flushPromises();
  // OTable holds its skeleton briefly so a fast response does not flash.
  await new Promise((r) => setTimeout(r, 75));
  await flushPromises();
  return Object.assign(wrapper, { router });
};

describe("AlertCalibrationDigests", () => {
  beforeEach(() => {
    queryClient.clear();
    store.state.zoConfig = {
      ...store.state.zoConfig,
      version: "v1",
      alert_calibration_enabled: true,
    };
    vi.mocked(alertCalibration.getConfig).mockResolvedValue({
      data: {
        id: "c1",
        org: "default",
        enabled: true,
        frequency_minutes: 1440,
        window_minutes: 43_200,
        created_at: 1,
        updated_at: 1,
      },
    } as never);
  });

  it("lists a run pulled twice once, as its newest emission", async () => {
    vi.mocked(alertCalibration.searchDigests).mockResolvedValue([
      run(NOW - DAY_MICROS, NOW - 100, 3),
      run(NOW - DAY_MICROS, NOW - 200, 5),
      run(NOW - 2 * DAY_MICROS, NOW - 300, 0),
    ]);
    const wrapper = await mountPage();
    const rows = wrapper.findAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("3");
    expect(wrapper.text()).toContain("Latest run findings");
    wrapper.unmount();
  });

  it("reads a digest stream that does not exist yet as no runs, not as a failure", async () => {
    vi.mocked(alertCalibration.searchDigests).mockRejectedValue({
      response: { status: 400, data: { code: 20002, message: "Search stream not found" } },
    });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("No runs in the last 14 days");
    expect(wrapper.text()).not.toContain("Runs unavailable");
    wrapper.unmount();
  });

  it("opens a run by its window", async () => {
    const latest = run(NOW - DAY_MICROS, NOW - 100, 1);
    vi.mocked(alertCalibration.searchDigests).mockResolvedValue([latest]);
    const wrapper = await mountPage();
    await wrapper.find("tbody tr").trigger("click");
    await flushPromises();
    expect(wrapper.router.currentRoute.value.name).toBe("alertCalibrationDigest");
    expect(wrapper.router.currentRoute.value.params).toEqual({
      windowStart: String(latest.window_start),
      windowEnd: String(latest.window_end),
    });
    wrapper.unmount();
  });

  it("leaves for the alert list once /config says the deployment has it off", async () => {
    vi.mocked(alertCalibration.searchDigests).mockResolvedValue([]);
    store.state.zoConfig = { ...store.state.zoConfig, alert_calibration_enabled: false };
    const page = await mountPage();
    expect(page.router.currentRoute.value.name).toBe("alertList");
    page.unmount();
  });
});
