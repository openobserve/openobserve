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
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import DowntimeDetail from "./DowntimeDetail.vue";
import downtimes from "@/services/downtimes";
import type { DowntimeDetail as DowntimeDetailData } from "@/services/downtimes";
import alerts from "@/services/alerts";
import { queryClient } from "@/composables/query/queryClient";

vi.mock("@/services/downtimes", () => ({
  default: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
    preview: vi.fn(),
    resources: vi.fn(),
  },
}));

vi.mock("@/services/alerts", async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return { ...actual, default: { ...actual.default, getHistory: vi.fn() } };
});

vi.mock("@/services/common", async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return {
    ...actual,
    default: {
      ...actual.default,
      list_Folders: vi.fn(() =>
        Promise.resolve({ data: { list: [{ folderId: "default", name: "default" }] } }),
      ),
    },
  };
});

const NOW_MICROS = 1_770_000_000_000_000;
const HOUR_MICROS = 3600 * 1_000_000;

const detail: DowntimeDetailData = {
  id: "dt-1",
  org: "default",
  folder_id: "default",
  name: "Kafka upgrade",
  targets: [{ module: "alerts", folders: { kind: "all" } }],
  schedule: {
    repeat: "none",
    starts_at: NOW_MICROS - HOUR_MICROS,
    ends_at: NOW_MICROS + HOUR_MICROS,
    timezone: "UTC",
    duration_secs: 7200,
    weekdays: [],
  },
  show_banner: false,
  created_by: "root@example.com",
  created_at: NOW_MICROS - 2 * HOUR_MICROS,
  updated_by: "root@example.com",
  updated_at: NOW_MICROS - 2 * HOUR_MICROS,
  status: "active",
  current_window: { start: NOW_MICROS - HOUR_MICROS, end: NOW_MICROS + HOUR_MICROS },
  next_window: null,
  matched_alerts: 2,
  matched_anomalies: 0,
  matched_synthetics: 0,
  matched_slos: 0,
  affected: { alerts: [], anomalies: [], synthetics: [], slos: [] },
};

const mountDetail = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/downtimes", name: "downtimes", component: { template: "<div />" } },
      { path: "/downtimes/:id", name: "downtimeDetail", component: DowntimeDetail },
      { path: "/downtimes/:id/edit", name: "editDowntime", component: { template: "<div />" } },
    ],
  });
  await router.push({
    name: "downtimeDetail",
    params: { id: "dt-1" },
    query: { org_identifier: "default", folder: "default" },
  });
  await router.isReady();
  const wrapper = mount(DowntimeDetail, {
    global: { plugins: [store, router] },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, router };
};

describe("DowntimeDetail", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(downtimes.get).mockReset();
    vi.mocked(alerts.getHistory).mockReset();
    vi.mocked(alerts.getHistory).mockResolvedValue({ data: { hits: [], total: 0 } } as never);
    store.state.selectedOrganization = {
      ...store.state.selectedOrganization,
      identifier: "default",
    };
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the Suppressed tab from a 200 with two hits", async () => {
    vi.mocked(downtimes.get).mockResolvedValue({ data: detail } as never);
    vi.mocked(alerts.getHistory).mockResolvedValue({
      data: {
        total: 2,
        from: 0,
        size: 500,
        hits: [
          { timestamp: NOW_MICROS - 60_000_000, alert_name: "kafka-lag", status: "suppressed" },
          { timestamp: NOW_MICROS - 30_000_000, alert_name: "kafka-isr", status: "suppressed" },
        ],
      },
    } as never);

    const { wrapper } = await mountDetail();
    const tab = wrapper.get('[data-test="downtime-detail-tab-suppressed"]');
    expect(tab.text()).toContain("2");
    await tab.trigger("mousedown", { button: 0 });
    await flushPromises();

    const table = '[data-test="downtime-detail-suppressed-table"]';
    await vi.waitFor(() => expect(wrapper.get(table).text()).toContain("kafka-lag"));
    expect(wrapper.get(table).text()).toContain("kafka-isr");
    expect(wrapper.get(table).attributes("data-test-loading")).not.toBe("true");
    expect(alerts.getHistory).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ downtime_id: "dt-1", status: "suppressed" }),
    );
    wrapper.unmount();
  });

  it("reloads the status when the open window ends, without a refresh", async () => {
    const endsSoon = Date.now() * 1000 + 300_000;
    vi.mocked(downtimes.get)
      .mockResolvedValueOnce({
        data: { ...detail, current_window: { start: NOW_MICROS, end: endsSoon } },
      } as never)
      .mockResolvedValue({
        data: { ...detail, status: "ended", current_window: null },
      } as never);

    const { wrapper } = await mountDetail();
    expect(downtimes.get).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(downtimes.get).toHaveBeenCalledTimes(2), { timeout: 5_000 });
    wrapper.unmount();
  });

  it("shows a not-found state on a 404", async () => {
    vi.mocked(downtimes.get).mockRejectedValue({ response: { status: 404 } });

    const { wrapper } = await mountDetail();
    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="downtime-detail-not-found"]').exists()).toBe(true),
    );
    expect(wrapper.text()).toContain("Downtime not found");
    expect(wrapper.find('[data-test="downtime-detail-error"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows an error state on any other failure", async () => {
    vi.mocked(downtimes.get).mockRejectedValue({ response: { status: 500 } });

    const { wrapper } = await mountDetail();
    await vi.waitFor(
      () => expect(wrapper.find('[data-test="downtime-detail-error"]').exists()).toBe(true),
      { timeout: 10_000 },
    );
    expect(wrapper.find('[data-test="downtime-detail-not-found"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
