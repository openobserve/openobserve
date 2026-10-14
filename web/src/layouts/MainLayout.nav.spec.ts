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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import router from "@/test/unit/helpers/router";
import { iconRegistry } from "@/lib/core/Icon/OIcon.icons";
import { groupNavLinks, NAV_GROUPS } from "@/lib/core/Navbar/navGroups";
import type { NavItem, RailEntry } from "@/lib/core/Navbar/ONavbar.types";

vi.mock("@/services/config", () => ({
  default: { get_config_full: vi.fn(() => new Promise(() => {})) },
}));

vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: { setUser: vi.fn(), startView: vi.fn() },
}));

import MainLayout from "./MainLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });
const NavbarStub = defineComponent({
  name: "ONavbar",
  props: { linksList: { type: Array, default: () => [] } },
  setup: () => () => h("div"),
});

describe("MainLayout — Product Analytics menu entry", () => {
  let wrapper: VueWrapper | undefined;

  const railItems = async (): Promise<NavItem[]> => {
    wrapper = mount(MainLayout, {
      global: {
        plugins: [store, i18n, router],
        stubs: {
          AppHeader: StubDiv,
          ONavbar: NavbarStub,
          O2AIChat: StubDiv,
          WebinarBanner: StubDiv,
          AnnouncementBanner: StubDiv,
          ShortcutCheatsheet: StubDiv,
          GetStarted: StubDiv,
          CommunitySlackInvite: StubDiv,
          ThemeSwitcher: StubDiv,
          PredefinedThemes: StubDiv,
          SlackIcon: StubDiv,
          ManagementIcon: StubDiv,
          ODialog: StubDiv,
          "router-view": StubDiv,
        },
      },
    });
    await flushPromises();
    return wrapper.findAllComponents(NavbarStub)[0].props("linksList") as NavItem[];
  };

  beforeEach(() => {
    store.state.zoConfig.product_analytics_enabled = true;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    store.state.zoConfig.custom_hide_menus = "";
    store.state.zoConfig.synthetics_enabled = false;
    store.state.zoConfig.product_analytics_enabled = false;
  });

  const rail = async (): Promise<RailEntry[]> => groupNavLinks(await railItems());
  const experienceChildren = (entries: RailEntry[]) => {
    const group = entries.find((e) => e.type === "linkGroup" && e.item.name === "experience");
    return group?.type === "linkGroup" ? group.children.map((c) => c.name) : undefined;
  };
  const tileNames = (entries: RailEntry[]) =>
    entries.map((e) => (e.type === "group" ? e.key : e.item.name));

  it("keeps its entry right after RUM, for Experience to absorb", async () => {
    const items = await railItems();
    const at = items.findIndex((l) => l.name === "rum");
    expect(items[at + 1]).toEqual({
      title: "Product Analytics",
      icon: "insights",
      link: "/product-analytics",
      name: "productAnalytics",
    });
  });

  it("keeps Reports right after Streams", async () => {
    const names = (await railItems()).map((l) => l.name);
    expect(names[names.indexOf("streams") + 1]).toBe("reports");
  });

  it("is hidden when product_analytics_enabled is absent from the config", async () => {
    delete store.state.zoConfig.product_analytics_enabled;
    const names = (await railItems()).map((l) => l.name);
    expect(names).toContain("rum");
    expect(names).not.toContain("productAnalytics");
  });

  it("is hidden when product_analytics_enabled is false", async () => {
    store.state.zoConfig.product_analytics_enabled = false;
    const names = (await railItems()).map((l) => l.name);
    expect(names).toContain("rum");
    expect(names).not.toContain("productAnalytics");
  });

  it("drops only the Product Analytics child from Experience when the flag is off", async () => {
    store.state.zoConfig.product_analytics_enabled = false;
    store.state.zoConfig.synthetics_enabled = true;
    expect(experienceChildren(await rail())).toEqual(["RUM", "synthetics"]);
  });

  it("appears once the flag arrives after mount, as when /config resolves late", async () => {
    delete store.state.zoConfig.product_analytics_enabled;
    store.state.zoConfig.synthetics_enabled = true;
    const navbar = () => wrapper!.findAllComponents(NavbarStub)[0];
    const names = () => (navbar().props("linksList") as NavItem[]).map((l) => l.name);
    await railItems();
    expect(names()).not.toContain("productAnalytics");

    store.state.zoConfig.product_analytics_enabled = true;
    await flushPromises();
    const items = navbar().props("linksList") as NavItem[];
    expect(items[items.findIndex((l) => l.name === "rum") + 1]?.name).toBe("productAnalytics");
    expect(experienceChildren(groupNavLinks(items))).toEqual([
      "RUM",
      "synthetics",
      "productAnalytics",
    ]);

    store.state.zoConfig.product_analytics_enabled = false;
    await flushPromises();
    expect(names()).not.toContain("productAnalytics");
  });

  it("stays hidden when the flag arrives late but custom_hide_menus names it", async () => {
    delete store.state.zoConfig.product_analytics_enabled;
    store.state.zoConfig.custom_hide_menus = "productAnalytics";
    await railItems();
    store.state.zoConfig.product_analytics_enabled = true;
    await flushPromises();
    const names = (wrapper!.findAllComponents(NavbarStub)[0].props("linksList") as NavItem[]).map(
      (l) => l.name,
    );
    expect(names).toContain("rum");
    expect(names).not.toContain("productAnalytics");
  });

  it("stays visible with the flag on and no custom_hide_menus", async () => {
    const names = (await railItems()).map((l) => l.name);
    expect(names).toContain("productAnalytics");
  });

  it("hides with custom_hide_menus like every other rail item", async () => {
    store.state.zoConfig.custom_hide_menus = "productAnalytics";
    const names = (await railItems()).map((l) => l.name);
    expect(names).toContain("rum");
    expect(names).not.toContain("productAnalytics");
  });

  it("hides together with RUM, whose data it reads and whose setup its empty state links to (F8)", async () => {
    store.state.zoConfig.custom_hide_menus = "logs,rum";
    const names = (await railItems()).map((l) => l.name);
    expect(names).toContain("metrics");
    expect(names).not.toContain("rum");
    expect(names).not.toContain("productAnalytics");
    expect([...(store.state.hiddenMenus as Set<string>)]).toContain("productAnalytics");
  });

  it("lists RUM, Synthetics and Product Analytics under Experience, with no tile of its own", async () => {
    store.state.zoConfig.synthetics_enabled = true;
    const entries = await rail();
    expect(experienceChildren(entries)).toEqual(["RUM", "synthetics", "productAnalytics"]);
    expect(tileNames(entries)).not.toContain("productAnalytics");
  });

  it("still groups RUM and Product Analytics under Experience when Synthetics is off", async () => {
    const entries = await rail();
    expect(experienceChildren(entries)).toEqual(["RUM", "productAnalytics"]);
    expect(tileNames(entries)).not.toContain("productAnalytics");
  });

  it("drops only the Product Analytics child when hidden by name", async () => {
    store.state.zoConfig.synthetics_enabled = true;
    store.state.zoConfig.custom_hide_menus = "productAnalytics";
    expect(experienceChildren(await rail())).toEqual(["RUM", "synthetics"]);
  });

  it("collapses to a plain RUM tile when Product Analytics is hidden and Synthetics is off", async () => {
    store.state.zoConfig.custom_hide_menus = "productAnalytics";
    const entries = await rail();
    expect(experienceChildren(entries)).toBeUndefined();
    expect(tileNames(entries)).toContain("rum");
  });

  it("takes Product Analytics out of Experience when RUM is hidden", async () => {
    store.state.zoConfig.synthetics_enabled = true;
    store.state.zoConfig.custom_hide_menus = "rum";
    const entries = await rail();
    expect(experienceChildren(entries)).toBeUndefined();
    expect(tileNames(entries)).toContain("synthetics");
    expect(tileNames(entries)).not.toContain("productAnalytics");
  });

  it("uses only registered icons on the Experience tile and its children", async () => {
    const experience = NAV_GROUPS.find((g) => g.key === "experience")!;
    for (const icon of [experience.icon, ...experience.children.map((c) => c.icon)]) {
      expect(Object.keys(iconRegistry)).toContain(icon);
    }
  });
});
