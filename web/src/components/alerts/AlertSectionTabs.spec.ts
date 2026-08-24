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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

import AlertSectionTabs from "./AlertSectionTabs.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { makeAlertSectionRouter } from "@/test/unit/helpers/alertSectionRouter";

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
    await router.push({ name: "alertList" });
    await router.isReady();
  });

  it("renders the four sibling sections in workflow order", () => {
    // Library last: it is where you go once to fetch an alert, not where you
    // work. The rail's Reliability flyout lists the same four in this order.
    const wrapper = mountTabs();
    const labels = wrapper.findAll('[role="tab"]').map((tab) => tab.text());
    expect(labels).toEqual(["All Alerts", "Destinations", "Destination Templates", "Library"]);
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
});
