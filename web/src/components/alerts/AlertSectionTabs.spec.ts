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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { provideFeatureLock } from "@/composables/useFeatureLock";

import AlertSectionTabs from "./AlertSectionTabs.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { makeAlertSectionRouter } from "@/test/unit/helpers/alertSectionRouter";
import { queryClient } from "@/composables/query/queryClient";
import alerts from "@/services/alerts";
import { firingAlertsQuery } from "@/services/alerts.queries";

// A router with just the sibling routes: the app router pulls in every view and
// runs the real auth guard, neither of which this component depends on.
const router = makeAlertSectionRouter();

const mountTabs = () =>
  mount(AlertSectionTabs, {
    global: {
      provide: { store },
      plugins: [i18n, router],
    },
  });

describe("AlertSectionTabs", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.removeItem("o2_alert_section_tab_order");
    queryClient.clear();
    store.state.zoConfig.custom_hide_menus = "";
    await router.push({ name: "alertList" });
    await router.isReady();
  });

  it("renders the sibling sections in workflow order with Firing first", () => {
    // Library last: it is where you go once to fetch an alert, not where you
    // work.
    const wrapper = mountTabs();
    const labels = wrapper.findAll('[role="tab"]').map((tab) => tab.text());
    expect(labels).toEqual([
      "Firing",
      "All Alerts",
      "Notification Destinations",
      "Destination Templates",
      "Alert Library",
    ]);
  });

  it("badges Firing with the unacked firing count, Muted excluded", async () => {
    const org = store.state.selectedOrganization.identifier;
    const firing = { name: "a", last_outcome: "firing" };
    queryClient.setQueryData(firingAlertsQuery(org).queryKey, {
      list: [
        { ...firing, alert_id: "1" },
        { ...firing, alert_id: "2" },
        { ...firing, alert_id: "3", active_downtime: { id: "d" } },
        { alert_id: "4", name: "b", last_outcome: "normal" },
      ],
    } as any);
    const wrapper = mountTabs();
    await flushPromises();
    expect(wrapper.find('[data-test="alert-section-tab-alertFiring-badge"]').text()).toBe("2");
  });

  it("hides the badge when the run state is unavailable, rather than showing 0", async () => {
    const org = store.state.selectedOrganization.identifier;
    queryClient.setQueryData(firingAlertsQuery(org).queryKey, {
      list: [],
      status_unavailable: true,
    });
    const wrapper = mountTabs();
    await flushPromises();
    expect(wrapper.find('[data-test="alert-section-tab-alertFiring-badge"]').exists()).toBe(false);
  });

  it("shares one list read with the Firing page", async () => {
    const read = vi
      .spyOn(alerts, "listByFolderId")
      .mockResolvedValue({ data: { list: [] } } as any);
    mountTabs();
    mountTabs();
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][6]).toBeUndefined();
  });

  it("keeps a hidden section's saved place when another tab is dragged", async () => {
    store.state.zoConfig.custom_hide_menus = "alertLibrary";
    localStorage.setItem(
      "o2_alert_section_tab_order",
      JSON.stringify(["alertLibrary", "alertList", "alertFiring"]),
    );
    const wrapper = mountTabs();
    wrapper
      .findComponent({ name: "OTabs" })
      .vm.$emit("reorder", { from: "alertFiring", to: "alertList", before: true });
    await flushPromises();
    const saved = JSON.parse(localStorage.getItem("o2_alert_section_tab_order") ?? "[]");
    expect(saved.slice(0, 3)).toEqual(["alertLibrary", "alertFiring", "alertList"]);
  });

  it("restores a saved order and appends a section the save never knew", () => {
    localStorage.setItem(
      "o2_alert_section_tab_order",
      JSON.stringify(["alertLibrary", "gone", "alertFiring"]),
    );
    const wrapper = mountTabs();
    const keys = wrapper
      .findAll('[role="tab"]')
      .map((tab) => tab.attributes("data-test")?.replace("alert-section-tab-", ""));
    expect(keys).toEqual([
      "alertLibrary",
      "alertFiring",
      "alertList",
      "alertDestinations",
      "alertTemplates",
    ]);
  });

  it("saves a dragged order", async () => {
    const wrapper = mountTabs();
    wrapper
      .findComponent({ name: "OTabs" })
      .vm.$emit("reorder", { from: "alertLibrary", to: "alertFiring", before: true });
    await flushPromises();
    expect(JSON.parse(localStorage.getItem("o2_alert_section_tab_order") ?? "[]")[0]).toBe(
      "alertLibrary",
    );
    expect(wrapper.findAll('[role="tab"]')[0].text()).toContain("Alert Library");
  });

  it("survives storage that throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const wrapper = mountTabs();
    expect(wrapper.findAll('[role="tab"]')[0].text()).toContain("Firing");
    wrapper
      .findComponent({ name: "OTabs" })
      .vm.$emit("reorder", { from: "alertLibrary", to: "alertFiring", before: true });
    await flushPromises();
    expect(wrapper.findAll('[role="tab"]')[0].text()).toContain("Alert Library");
  });

  it("marks the tab for the current route active", async () => {
    await router.push({ name: "alertLibrary" });
    await flushPromises();
    const wrapper = mountTabs();
    const active = wrapper.find('[data-test="alert-section-tab-alertLibrary"]');
    expect(active.attributes("aria-selected")).toBe("true");
  });

  it("navigates by route name, carrying the org identifier", async () => {
    const push = vi.spyOn(router, "push");
    const wrapper = mountTabs();
    // reka-ui's TabsTrigger activates on mousedown, not click.
    await wrapper.find('[data-test="alert-section-tab-alertLibrary"]').trigger("mousedown");
    expect(push).toHaveBeenCalledWith({
      name: "alertLibrary",
      query: { org_identifier: store.state.selectedOrganization.identifier },
    });
  });

  it("does not re-navigate when the active tab is clicked", async () => {
    const push = vi.spyOn(router, "push");
    const wrapper = mountTabs();
    await wrapper.find('[data-test="alert-section-tab-alertList"]').trigger("mousedown");
    expect(push).not.toHaveBeenCalled();
  });

  it("selects no tab on an unrelated route, rather than defaulting to the first", async () => {
    await router.push({ name: "home" });
    await flushPromises();
    const wrapper = mountTabs();
    expect(wrapper.findAll('[aria-selected="true"]')).toHaveLength(0);
  });

  it("drops the Library tab when custom_hide_menus lists 'alertLibrary'", () => {
    store.state.zoConfig.custom_hide_menus = "openapi,reports,alertLibrary";
    const wrapper = mountTabs();
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual([
      "Firing",
      "All Alerts",
      "Notification Destinations",
      "Destination Templates",
    ]);
  });

  it("keeps the Library tab when the flag lists other menus", () => {
    store.state.zoConfig.custom_hide_menus = "openapi,reports";
    const wrapper = mountTabs();
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toContain("Alert Library");
  });

  describe("license", () => {
    afterEach(() => {
      delete store.state.zoConfig.features;
    });

    const lockOf = (wrapper: ReturnType<typeof mountTabs>, key: string) =>
      wrapper.find(`[data-test="alert-section-tab-${key}-lock"]`).exists();

    it("puts a lock on every tab when alerts is locked", () => {
      store.state.zoConfig.features = { alerts: "locked" };
      const wrapper = mountTabs();
      expect(lockOf(wrapper, "alertList")).toBe(true);
      expect(lockOf(wrapper, "alertLibrary")).toBe(true);
      expect(lockOf(wrapper, "alertDestinations")).toBe(true);
      expect(lockOf(wrapper, "alertTemplates")).toBe(true);
    });

    it("shows no lock when alerts is enabled", () => {
      store.state.zoConfig.features = { alerts: "enabled" };
      const wrapper = mountTabs();
      expect(wrapper.find('[data-test$="-lock"]').exists()).toBe(false);
    });

    it("drops the alert-owned tabs when alerts is hidden, keeping destinations and templates", () => {
      store.state.zoConfig.features = { alerts: "hidden" };
      const wrapper = mountTabs();
      expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual([
        "Notification Destinations",
        "Destination Templates",
      ]);
    });

    it("still navigates to the free destinations from a license-locked alert page", async () => {
      store.state.zoConfig.features = { alerts: "locked" };
      const push = vi.spyOn(router, "push");
      const LockedPage = defineComponent({
        setup() {
          provideFeatureLock(ref("alerts"));
          return () => h(AlertSectionTabs);
        },
      });
      const wrapper = mount(LockedPage, {
        global: { provide: { store }, plugins: [i18n, router] },
      });
      await wrapper.find('[data-test="alert-section-tab-alertDestinations"]').trigger("mousedown");
      expect(push).toHaveBeenCalledWith({
        name: "alertDestinations",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
    });
  });
});
