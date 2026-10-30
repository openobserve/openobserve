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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/services/http", () => ({ default: () => ({ get }) }));

import AlertListPanelRenderer from "@/components/dashboards/panels/AlertListPanelRenderer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const alerts = [
  {
    alert_id: "a1",
    name: "disk full",
    folder_id: "default",
    folder_name: "default",
    enabled: true,
    last_outcome: "firing",
    last_satisfied_at: 1793057797456037,
  },
  {
    alert_id: "a2",
    name: "api errors",
    folder_id: "payments",
    folder_name: "Payments",
    enabled: true,
    last_outcome: "succeeded",
    last_satisfied_at: null,
  },
  {
    alert_id: "a3",
    name: "cpu high",
    folder_id: "default",
    folder_name: "default",
    enabled: false,
    last_outcome: "firing",
    last_satisfied_at: null,
  },
];

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", name: "home", component: { template: "<div />" } },
    { path: "/alerts/detail/:alert_id", name: "alertDetail", component: { template: "<div />" } },
    { path: "/dashboards/add_panel", name: "addPanel", component: { template: "<div />" } },
  ],
});

let wrapper: VueWrapper<any> | undefined;
beforeEach(() => {
  get.mockReset();
  store.state.selectedOrganization = { identifier: "test-org" };
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

const mountPanel = async (config: Record<string, unknown> = {}, refreshSignal: unknown = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  wrapper = mount(AlertListPanelRenderer, {
    props: { config, refreshSignal },
    global: { plugins: [i18n, store, router, [VueQueryPlugin, { queryClient }]] },
  });
  await flushPromises();
  // OTable holds its loading skeleton for a minimum time so a fast load does not flash.
  await new Promise((resolve) => setTimeout(resolve, 80));
  await flushPromises();
  return wrapper;
};

const names = (view: VueWrapper<any>) =>
  view.findAll("tbody tr").map((row) => row.findAll("td")[0]?.text() ?? "");

describe("AlertListPanelRenderer", () => {
  it("lists the alerts with a state tag, firing first, through the real OTable", async () => {
    get.mockResolvedValue({ data: { list: alerts } });
    const view = await mountPanel();
    expect(get).toHaveBeenCalledWith("/api/v2/test-org/alerts?sort_by=name&desc=false&name=", {
      skipAccessToast: true,
    });
    expect(names(view)).toEqual(["disk full", "api errors", "cpu high"]);
    expect(view.get('[data-test="dashboard-alert-list-panel-state-a1"]').text()).toBe("Firing");
    // Like the Alerts page, a paused alert shows no stale outcome; its row is muted with a grey rail.
    expect(view.get('[data-test="dashboard-alert-list-panel-state-a3"]').text()).toBe("—");
    const pausedRow = view.findAll("tbody tr")[2];
    expect(pausedRow.classes()).toContain("!bg-surface-panel");
    expect(pausedRow.attributes("style")).toContain("--color-grey-400");
  });

  it("uses the Alerts page's column headers", async () => {
    get.mockResolvedValue({ data: { list: alerts } });
    const view = await mountPanel();
    const headers = view.findAll("thead th").map((th) => th.text().trim());
    for (const key of [
      "name",
      "lastOutcome",
      "priority",
      "owner",
      "lastTriggered",
      "lastSatisfied",
      "folder",
    ]) {
      expect(headers).toContain(String(i18n.global.t(`alerts.${key}`)));
    }
  });

  it("applies the folder, state and max settings", async () => {
    get.mockResolvedValue({ data: { list: alerts } });
    const view = await mountPanel({
      alert_list_folder: "default",
      alert_list_state: ["firing", "paused"],
      alert_list_max: 1,
    });
    expect(get.mock.calls[0][0]).toContain("&folder=default");
    expect(names(view)).toEqual(["disk full"]);
  });

  it("opens the alert's page on row click", async () => {
    get.mockResolvedValue({ data: { list: alerts } });
    const push = vi.spyOn(router, "push");
    const view = await mountPanel();
    await view.findAll("tbody tr")[1].trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "alertDetail",
      params: { alert_id: "a2" },
      query: { org_identifier: "test-org", folder: "payments" },
    });
  });

  it("opens the alert in a new tab from the panel editor, keeping the unsaved panel", async () => {
    get.mockResolvedValue({ data: { list: alerts } });
    await router.push({ name: "addPanel" });
    const push = vi.spyOn(router, "push");
    push.mockClear();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const view = await mountPanel();
    await view.findAll("tbody tr")[1].trigger("click");
    expect(push).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("/alerts/detail/a2"),
      "_blank",
      "noopener",
    );
    open.mockRestore();
    push.mockRestore();
    await router.push({ name: "home" });
  });

  it("fetches the alerts again on every dashboard refresh", async () => {
    get.mockResolvedValue({ data: { list: alerts } });
    const view = await mountPanel({}, { start: 1 });
    expect(get).toHaveBeenCalledTimes(1);
    get.mockResolvedValue({ data: { list: alerts.slice(0, 1) } });
    await view.setProps({ refreshSignal: { start: 2 } });
    await flushPromises();
    expect(get).toHaveBeenCalledTimes(2);
    expect(names(view)).toEqual(["disk full"]);
  });

  it("shows the empty state when nothing matches", async () => {
    get.mockResolvedValue({ data: { list: [] } });
    const view = await mountPanel();
    expect(view.find('[data-test="dashboard-alert-list-panel-empty"]').exists()).toBe(true);
  });

  it("shows no access, not an error, on a 403", async () => {
    get.mockRejectedValue({ response: { status: 403 } });
    const view = await mountPanel();
    expect(view.find('[data-test="dashboard-alert-list-panel-forbidden"]').exists()).toBe(true);
    expect(view.find('[data-test="dashboard-alert-list-panel-error"]').exists()).toBe(false);
  });

  it("shows a load error for any other failure", async () => {
    get.mockRejectedValue({ response: { status: 500 } });
    const view = await mountPanel();
    expect(view.find('[data-test="dashboard-alert-list-panel-error"]').exists()).toBe(true);
  });
});
