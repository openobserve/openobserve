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

import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import FleetManager from "./FleetManager.vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/", name: "fleet", component: { template: "<div />" } }],
});

const created = vi.fn();

// Each view that owns a create flow exposes create(); the stub records which one the header reached.
const creatable = (name: string) =>
  defineComponent({
    name,
    setup(_props, { expose }) {
      expose({ create: () => created(name) });
      return () => null;
    },
  });

const stubs = {
  FleetOverview: true,
  FleetFleets: creatable("FleetFleets"),
  FleetConfigurations: creatable("FleetConfigurations"),
  FleetSettings: true,
  FleetAudit: true,
};

async function mountAt(tab: string) {
  await router.push({ name: "fleet", query: { tab } });
  const w = mount(FleetManager, { global: { plugins: [i18n, router, store], stubs } });
  await flushPromises();
  return w;
}

describe("FleetManager", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    created.mockClear();
  });

  it("names the fleets tab Fleets, in place of Groups", async () => {
    wrapper = await mountAt("fleets");
    expect(wrapper.find('[data-test="fleet-manager-tab-fleets"]').text()).toBe("Fleets");
    expect(wrapper.find('[data-test="fleet-manager-tab-groups"]').exists()).toBe(false);
  });

  it.each([
    ["fleets", "New fleet", "FleetFleets"],
    ["configurations", "New configuration", "FleetConfigurations"],
  ])(
    "offers %s's create action to everyone and opens that tab's dialog",
    async (tab, label, target) => {
      wrapper = await mountAt(tab);
      const btn = wrapper.find(`[data-test="fleet-manager-create-${tab}"]`);
      expect(btn.text()).toBe(label);
      expect(btn.attributes("aria-disabled")).toBeUndefined();
      await btn.trigger("click");
      await flushPromises();
      expect(created).toHaveBeenCalledWith(target);
    },
  );

  it.each(["overview", "settings", "audit"])("offers no create action on %s", async (tab) => {
    wrapper = await mountAt(tab);
    expect(wrapper.find('[data-test^="fleet-manager-create-"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Add collector");
  });

  it.each([{}, { tab: "collectors" }, { tab: "enrollment" }])(
    "shows Overview for a missing or unknown tab (%j)",
    async (query) => {
      await router.push({ name: "fleet", query });
      wrapper = mount(FleetManager, { global: { plugins: [i18n, router, store], stubs } });
      await flushPromises();
      expect(wrapper.findComponent({ name: "OTabs" }).props("modelValue")).toBe("overview");
    },
  );

  it("has one row of five tabs, with no Enrollment, and no sub-tabs", async () => {
    wrapper = await mountAt("fleets");
    const tabs = wrapper.findAll('[data-test^="fleet-manager-tab-"]').map((t) => t.text());
    expect(tabs).toEqual(["Overview", "Fleets", "Configurations", "Settings", "Audit"]);
    expect(wrapper.findAllComponents({ name: "OTabs" })).toHaveLength(1);
    expect(wrapper.find('[data-test="fleet-manager-subnav"]').exists()).toBe(false);
  });

  it("titles the page Fleet management", async () => {
    wrapper = await mountAt("fleets");
    expect(wrapper.text()).toContain("Fleet management");
  });

  it("shows the pipelines map on the Overview tab", async () => {
    wrapper = await mountAt("overview");
    expect(wrapper.find('[data-test="fleet-manager-overview"]').exists()).toBe(true);
  });

  it("switches tabs through ?tab= alone, keeping the org", async () => {
    await router.push({ name: "fleet", query: { org_identifier: "acme", tab: "overview" } });
    wrapper = mount(FleetManager, { global: { plugins: [i18n, router, store], stubs } });
    await flushPromises();
    wrapper.findComponent({ name: "OTabs" }).vm.$emit("change", "configurations");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      org_identifier: "acme",
      tab: "configurations",
    });
  });
});
