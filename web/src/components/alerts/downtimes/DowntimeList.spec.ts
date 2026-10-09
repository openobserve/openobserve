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
import DowntimeList from "./DowntimeList.vue";
import downtimes from "@/services/downtimes";
import type { DowntimeListItem, DowntimeListResponse } from "@/services/downtimes";
import common from "@/services/common";
import { queryClient } from "@/composables/query/queryClient";

// The route guard opens this page only with downtimes on.
vi.mock("@/composables/downtimes/useDowntimesEnabled", async () => {
  const { computed } = await import("vue");
  return { useDowntimesEnabled: () => computed(() => true) };
});

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

vi.mock("@/utils/commons", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getFoldersListByType: vi.fn(() => Promise.resolve([])),
}));

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

const NOW_MS = 1_770_000_000_000;
const SECOND_MICROS = 1_000_000;
const NOW_MICROS = NOW_MS * 1000;

const row = (overrides: Partial<DowntimeListItem> = {}): DowntimeListItem => ({
  id: "dt-1",
  org: "default",
  folder_id: "default",
  name: "Kafka upgrade",
  targets: [{ module: "alerts", folders: { kind: "all" } }],
  schedule: {
    repeat: "none",
    starts_at: NOW_MICROS + 2 * SECOND_MICROS,
    ends_at: NOW_MICROS + 3600 * SECOND_MICROS,
    timezone: "UTC",
    duration_secs: 3600,
    weekdays: [],
  },
  show_banner: false,
  created_by: "root@example.com",
  created_at: NOW_MICROS,
  updated_by: "root@example.com",
  updated_at: NOW_MICROS,
  status: "scheduled",
  current_window: null,
  next_window: { start: NOW_MICROS + 2 * SECOND_MICROS, end: NOW_MICROS + 3600 * SECOND_MICROS },
  matched_alerts: 3,
  matched_anomalies: 0,
  matched_synthetics: 0,
  matched_slos: 0,
  ...overrides,
});

const page = (items: DowntimeListItem[]): { data: DowntimeListResponse } => ({
  data: {
    items,
    total: items.length,
    counts: { active: 0, scheduled: 0, recurring: 0, ended: 0, cancelled: 0 },
  },
});

const mountList = async (query: Record<string, string> = {}) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/downtimes", name: "downtimes", component: DowntimeList },
      { path: "/downtimes/add", name: "addDowntime", component: { template: "<div />" } },
      { path: "/downtimes/:id", name: "downtimeDetail", component: { template: "<div />" } },
      { path: "/downtimes/:id/edit", name: "editDowntime", component: { template: "<div />" } },
    ],
  });
  await router.push({
    name: "downtimes",
    query: { org_identifier: "default", folder: "default", ...query },
  });
  await router.isReady();
  const wrapper = mount(DowntimeList, {
    global: {
      plugins: [store, router],
      stubs: { FolderList: true, MoveAcrossFolders: true },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return Object.assign(wrapper, { router });
};

describe("DowntimeList", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(downtimes.list).mockReset();
    vi.mocked(common.list_Folders).mockClear();
    store.state.selectedOrganization = {
      ...store.state.selectedOrganization,
      identifier: "default",
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("flips a row to Active within a second of its start, without a reload", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(NOW_MS);
    const started = row({
      status: "active",
      current_window: {
        start: NOW_MICROS + 2 * SECOND_MICROS,
        end: NOW_MICROS + 3600 * SECOND_MICROS,
      },
      next_window: null,
    });
    vi.mocked(downtimes.list)
      .mockResolvedValueOnce(page([row()]) as never)
      .mockResolvedValue(page([started]) as never);

    const wrapper = await mountList();
    const activeCount = () => wrapper.get('[data-test="downtime-summary-active"]').text();
    expect(activeCount()).toContain("0");
    expect(downtimes.list).toHaveBeenCalledTimes(1);

    // Just before the start (plus the one second of slack) nothing has refetched.
    await vi.advanceTimersByTimeAsync(2_900);
    expect(downtimes.list).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(downtimes.list).toHaveBeenCalledTimes(2);
    expect(activeCount()).toContain("1");
    wrapper.unmount();
  });

  it("shows a load error instead of the first-run empty state", async () => {
    vi.mocked(downtimes.list).mockRejectedValue({ response: { status: 500 } });

    const wrapper = await mountList();
    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="downtime-list-error"]').exists()).toBe(true),
    );
    expect(wrapper.find('[data-test="downtime-list-empty"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps the targets on one row and folds the rest behind +N", async () => {
    vi.mocked(downtimes.list).mockResolvedValue(
      page([
        row({
          targets: [
            { module: "alerts", folders: { kind: "all" } },
            { module: "anomaly_detections", folders: { kind: "all" } },
            { module: "synthetics", folders: { kind: "all" } },
            { module: "slos", folders: { kind: "all" } },
          ],
        }),
      ]) as never,
    );

    const wrapper = await mountList();
    const more = '[data-test="downtime-list-dt-1-targets-more"]';
    await vi.waitFor(() => expect(wrapper.find(more).exists()).toBe(true));
    expect(wrapper.get(more).text()).toContain("+2");
    wrapper.unmount();
  });

  it("keeps the user's folder narrowing when the status filter changes after a banner link", async () => {
    vi.mocked(downtimes.list).mockResolvedValue(
      page([
        row({ id: "dt-1", status: "active" }),
        row({ id: "dt-2", folder_id: "ops", status: "scheduled" }),
      ]) as never,
    );
    const wrapper = await mountList({ status: "active", scope: "all" });
    const total = () => wrapper.get('[data-test="downtime-summary-total"]').text();
    await vi.waitFor(() => expect(total()).toContain("2"));

    await wrapper.get('[data-test="downtime-list-scope-this"]').trigger("click");
    await flushPromises();
    expect(total()).toContain("1");
    expect(wrapper.router.currentRoute.value.query.scope).toBeUndefined();

    await wrapper.get('[data-test="downtime-summary-scheduled"]').trigger("click");
    await flushPromises();
    expect(wrapper.router.currentRoute.value.query.status).toBe("scheduled");
    expect(total()).toContain("1");
    wrapper.unmount();
  });

  it("filters to the ended-early rows when the URL changes to that status after mount", async () => {
    vi.mocked(downtimes.list).mockResolvedValue(
      page([
        row({ id: "dt-1", status: "active" }),
        row({ id: "dt-2", status: "ended_early" }),
      ]) as never,
    );
    const wrapper = await mountList();
    const shown = (id: string) => wrapper.find(`[data-test="downtime-list-${id}-name"]`).exists();
    await vi.waitFor(() => expect(shown("dt-1")).toBe(true));
    expect(shown("dt-2")).toBe(true);

    await wrapper.router.push({
      query: { ...wrapper.router.currentRoute.value.query, status: "ended_early" },
    });
    await flushPromises();
    expect(shown("dt-1")).toBe(false);
    expect(shown("dt-2")).toBe(true);
    wrapper.unmount();
  });
});
