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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import AlertCalibrationDigestDetail from "./AlertCalibrationDigestDetail.vue";
import type { RunRow } from "./digests";

const DAY_MICROS = 86_400_000_000;
const NOW = Date.now() * 1000;

const RUN: RunRow = {
  window_start: NOW - 30 * DAY_MICROS,
  window_end: NOW,
  emitted_at: NOW,
  finding_count: 0,
  skip_count: 0,
  alerts_in_scope: 8,
  coverage_gap: false,
  coverage_unreadable_definitions: 0,
  coverage_facts_without_definition: 0,
  coverage_definitions_without_facts: 0,
  coverage_transitions_truncated: false,
  coverage_counters_truncated: false,
  coverage_error_clusters_truncated: false,
  coverage_error_clusters_unattributed: 0,
  coverage_stream_substrate_empty: false,
};

vi.mock("@/composables/alertCalibration/useAlertCalibrationEnabled", () => ({
  useLeaveIfAlertCalibrationOff: () => {},
}));

vi.mock("./useDigestSearch", () => ({
  useDigestSearch: () => ({ search: vi.fn(), orgId: ref("default") }),
  useLatestRead: () => ({
    data: ref({ hits: 1, run: RUN, findings: [] }),
    error: ref(null),
    loading: ref(false),
    load: vi.fn(),
  }),
}));

const mountPage = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/logs", name: "logs", component: { template: "<div />" } },
      { path: "/runs", name: "alertCalibrationRuns", component: { template: "<div />" } },
    ],
  });
  await router.push("/");
  const push = vi.spyOn(router, "push");
  const wrapper = mount(AlertCalibrationDigestDetail, {
    props: { windowStart: RUN.window_start, windowEnd: RUN.window_end },
    global: { plugins: [store, router] },
  });
  await flushPromises();
  return { wrapper, push };
};

const VIEW_IN_LOGS = '[data-test="alert-calibration-digest-view-in-logs"]';

describe("AlertCalibrationDigestDetail view in logs", () => {
  afterEach(() => {
    delete (store.state.zoConfig as Record<string, unknown>).features;
  });

  it("logs locked: View in logs is disabled with a lock and opens nothing", async () => {
    (store.state.zoConfig as Record<string, unknown>).features = { logs: "locked" };
    const { wrapper, push } = await mountPage();
    const button = wrapper.find(VIEW_IN_LOGS);
    expect(button.attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-test="alert-calibration-digest-view-in-logs-lock"]').exists()).toBe(
      true,
    );
    await button.trigger("click");
    expect(push).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("logs enabled: View in logs opens Logs on the digest stream", async () => {
    const { wrapper, push } = await mountPage();
    expect(wrapper.find('[data-test="alert-calibration-digest-view-in-logs-lock"]').exists()).toBe(
      false,
    );
    await wrapper.find(VIEW_IN_LOGS).trigger("click");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/logs",
        query: expect.objectContaining({ stream_type: "logs" }),
      }),
    );
    wrapper.unmount();
  });
});
