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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createStore } from "vuex";
import { raw } from "@/types/i18n";
import type { NavItem } from "./ONavbar.types";
import OSidebar from "./OSidebar.vue";
import config from "@/aws-exports";

vi.mock("@/composables/useTrialPaywall", () => ({
  useTrialPaywall: () => ({ isPaywalled: () => false }),
}));

const page = { template: "<div />" };
const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: page },
      { path: "/logs", name: "logs", component: page },
      { path: "/alerts", name: "alertList", component: page },
      { path: "/slos", name: "sloList", component: page },
      { path: "/settings", name: "settings", component: page },
      { path: "/alerts/destinations", name: "alertDestinations", component: page },
      { path: "/downtimes", name: "downtimes", component: page },
      { path: "/oncall/pages", name: "onCallResponses", component: page },
      { path: "/oncall/teams", name: "onCallTeams", component: page },
      { path: "/dashboards", name: "dashboards", component: page },
      { path: "/reports", name: "reports", component: page },
    ],
  });

const links: NavItem[] = [
  { title: raw("Home"), icon: "home", link: "/", name: "home" },
  { title: raw("Logs"), icon: "search", link: "/logs", name: "logs" },
  { title: raw("Alerts"), icon: "home", link: "/alerts", name: "alertList" },
  { title: raw("SLOs"), icon: "home", link: "/slos", name: "sloList" },
  { title: raw("Settings"), icon: "settings", link: "/settings", name: "settings" },
];

let wrapper: VueWrapper;

async function mountAt(
  path: string,
  zoConfig: Record<string, unknown> = {},
  collapsible = true,
  linksList: NavItem[] = links,
) {
  const router = makeRouter();
  await router.push(path);
  const store = createStore({
    state: { selectedOrganization: { identifier: "default" }, zoConfig, theme: "light" },
  });
  wrapper = mount(OSidebar, {
    props: { linksList, collapsible },
    attachTo: document.body,
    global: {
      plugins: [router, store],
    },
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  vi.useRealTimers();
  wrapper?.unmount();
  localStorage.clear();
});

describe("OSidebar", () => {
  it("renders a labelled nav landmark with the sections", async () => {
    await mountAt("/logs");
    const nav = wrapper.find("nav[data-test='sidebar']");
    expect(nav.attributes("aria-label")).toBeTruthy();
    expect(wrapper.find("[data-test='sidebar-group-top']").exists()).toBe(true);
    expect(wrapper.find("[data-test='sidebar-group-explore']").exists()).toBe(true);
    expect(wrapper.find("[data-test='sidebar-group-monitor']").exists()).toBe(true);
  });

  it("marks the active page with aria-current", async () => {
    await mountAt("/logs");
    expect(wrapper.find("[data-test='sidebar-item-logs']").attributes("aria-current")).toBe("page");
    expect(
      wrapper.find("[data-test='sidebar-item-home']").attributes("aria-current"),
    ).toBeUndefined();
  });

  it("auto-expands the group holding the current route", async () => {
    await mountAt("/slos");
    const group = wrapper.find("[data-test='sidebar-item-reliability']");
    expect(group.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find("[data-test='sidebar-item-sloList']").attributes("aria-current")).toBe(
      "page",
    );
  });

  it("keeps other groups closed and toggles them on click", async () => {
    await mountAt("/logs");
    const group = wrapper.find("[data-test='sidebar-item-reliability']");
    expect(group.attributes("aria-expanded")).toBe("false");
    await group.trigger("click");
    expect(wrapper.find("[data-test='sidebar-children-reliability']").exists()).toBe(true);
  });

  it("collapses to icons and remembers it", async () => {
    await mountAt("/logs");
    await wrapper.find("[data-test='sidebar-collapse-toggle']").trigger("click");
    expect(wrapper.find("nav").attributes("data-collapsed")).toBe("true");
    expect(localStorage.getItem("o2-sidebar-collapsed")).toBe("true");
  });

  it("tops the nav with a home logo and no org switcher, swapping to the mark when collapsed", async () => {
    await mountAt("/logs");
    const logo = () => wrapper.find("[data-test='sidebar-openobserve-logo']");
    expect(wrapper.find("[data-test='sidebar-logo']").attributes("href")).toContain("/");
    expect(logo().attributes("src")).toContain("openobserve_latest_light_2");
    expect(wrapper.find("[data-test='navbar-organizations-select']").exists()).toBe(false);
    await wrapper.find("[data-test='sidebar-collapse-toggle']").trigger("click");
    expect(logo().attributes("src")).toContain("openobserve_mark");
  });

  it("shows an enterprise custom logo in place of the wordmark, beside the mark unless hidden", async () => {
    const was = config.isEnterprise;
    (config as { isEnterprise: string }).isEnterprise = "true";
    try {
      await mountAt("/logs", { custom_logo_img: "AAAA", custom_hide_self_logo: false });
      expect(wrapper.find("[data-test='sidebar-custom-logo']").attributes("src")).toContain("AAAA");
      expect(wrapper.find("[data-test='sidebar-openobserve-logo']").attributes("src")).toContain(
        "openobserve_mark",
      );
      wrapper.unmount();
      await mountAt("/logs", { custom_logo_text: "Acme", custom_hide_self_logo: true });
      expect(wrapper.find("[data-test='sidebar-custom-logo-text']").text()).toBe("Acme");
      expect(wrapper.find("[data-test='sidebar-openobserve-logo']").exists()).toBe(false);
    } finally {
      (config as { isEnterprise: string }).isEnterprise = was;
    }
  });

  it("ends the bottom group with an always-visible Collapse row that turns icon-only", async () => {
    await mountAt("/logs");
    const nav = () => wrapper.find("nav").attributes("data-collapsed");
    const toggle = wrapper.find("[data-test='sidebar-collapse-toggle']");
    expect(toggle.element.parentElement?.lastElementChild).toBe(toggle.element);
    expect(toggle.classes()).not.toContain("opacity-0");
    expect(toggle.isVisible()).toBe(true);
    expect(toggle.text()).toContain("Collapse");
    expect(toggle.find("[data-test='o-shortcut']").exists()).toBe(false);
    expect(toggle.attributes("aria-label")).toBe("Collapse Sidebar");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    await toggle.trigger("click");
    expect(nav()).toBe("true");
    expect(toggle.attributes("aria-label")).toBe("Expand Sidebar");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(toggle.text()).not.toContain("Collapse");
    expect(toggle.find("[data-test='o-shortcut']").exists()).toBe(false);
    expect(wrapper.find("[data-test='sidebar-edge']").exists()).toBe(false);
  });

  it("toggles on [ but not while typing or with a modifier", async () => {
    await mountAt("/logs");
    const nav = () => wrapper.find("nav").attributes("data-collapsed");
    const press = async (target: EventTarget, init: KeyboardEventInit = {}) => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "[", bubbles: true, ...init }));
      await flushPromises();
    };
    await press(document.body);
    expect(nav()).toBe("true");
    await press(document.body, { metaKey: true });
    expect(nav()).toBe("true");
    const input = document.createElement("input");
    document.body.appendChild(input);
    await press(input);
    expect(nav()).toBe("true");
    const editor = document.createElement("div");
    editor.className = "monaco-editor";
    editor.appendChild(document.createElement("span"));
    document.body.appendChild(editor);
    await press(editor.firstChild!);
    expect(nav()).toBe("true");
    input.remove();
    editor.remove();
    await press(document.body);
    expect(nav()).toBeUndefined();
  });

  it("leaves the brand row to the mobile drawer's own header", async () => {
    await mountAt("/logs", {}, false);
    expect(wrapper.find("[data-test='sidebar-logo']").exists()).toBe(false);
    expect(wrapper.find("[data-test='sidebar-collapse-toggle']").exists()).toBe(false);
  });

  it("shows no page search or edition label", async () => {
    await mountAt("/logs");
    expect(wrapper.find("[data-test='sidebar-search']").exists()).toBe(false);
    expect(wrapper.find("[data-test='sidebar-edition']").exists()).toBe(false);
  });
});

describe("OSidebar group flyouts", () => {
  const flyout = () =>
    document.querySelector<HTMLElement>("[data-test='sidebar-flyout-reliability']");
  const group = () => wrapper.find("[data-test='sidebar-item-reliability']");
  const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  it("opens on hover after the delay, titled with the group, and lists only reachable children", async () => {
    await mountAt("/logs");
    fakeTimers();
    await group().trigger("mouseenter");
    vi.advanceTimersByTime(119);
    await flushPromises();
    expect(flyout()).toBeNull();
    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(flyout()).not.toBeNull();
    expect(flyout()!.textContent).toContain(group().text());
    expect(flyout()!.querySelector("[data-test='sidebar-flyout-item-sloList']")).not.toBeNull();
  });

  it("closes after the pointer leaves both the row and the flyout", async () => {
    await mountAt("/logs");
    fakeTimers();
    await group().trigger("mouseenter");
    vi.advanceTimersByTime(120);
    await flushPromises();
    await group().trigger("mouseleave");
    flyout()!.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(400);
    await flushPromises();
    expect(flyout()).not.toBeNull();
    flyout()!.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(200);
    await flushPromises();
    expect(flyout()).toBeNull();
  });

  it("does not float a group that is already expanded inline", async () => {
    await mountAt("/slos");
    fakeTimers();
    await group().trigger("mouseenter");
    vi.advanceTimersByTime(500);
    await flushPromises();
    expect(flyout()).toBeNull();
  });

  it("opens from the collapsed rail in place of the tooltip", async () => {
    await mountAt("/slos");
    await wrapper.find("[data-test='sidebar-collapse-toggle']").trigger("click");
    fakeTimers();
    await group().trigger("mouseenter");
    vi.advanceTimersByTime(120);
    await flushPromises();
    expect(flyout()).not.toBeNull();
    const item = flyout()!.querySelector("[data-test='sidebar-flyout-item-sloList']");
    expect(item?.getAttribute("aria-current")).toBe("page");
  });

  it("opens with ArrowRight, focuses the first item, and Escape returns focus to the row", async () => {
    await mountAt("/logs");
    (group().element as HTMLElement).focus();
    await group().trigger("keydown", { key: "ArrowRight" });
    await flushPromises();
    const first = flyout()!.querySelector<HTMLElement>("[data-test^='sidebar-flyout-item-']");
    expect(document.activeElement).toBe(first);
    first!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(flyout()).toBeNull();
    expect(document.activeElement).toBe(group().element);
  });

  it("closes when the route changes", async () => {
    await mountAt("/logs");
    await group().trigger("keydown", { key: "ArrowRight" });
    await flushPromises();
    expect(flyout()).not.toBeNull();
    await wrapper.vm.$router.push("/alerts");
    await flushPromises();
    expect(flyout()).toBeNull();
  });

  it("never floats a menu in the mobile drawer", async () => {
    await mountAt("/logs", {}, false);
    fakeTimers();
    await group().trigger("mouseenter");
    vi.advanceTimersByTime(500);
    await group().trigger("keydown", { key: "ArrowRight" });
    await flushPromises();
    expect(flyout()).toBeNull();
  });
});

describe("OSidebar child sections", () => {
  const flyout = () =>
    document.querySelector<HTMLElement>("[data-test='sidebar-flyout-reliability']");
  const openFlyout = async (name = "reliability") => {
    await wrapper.find(`[data-test='sidebar-item-${name}']`).trigger("keydown", {
      key: "ArrowRight",
    });
    await flushPromises();
  };
  const sectionLabels = (root: ParentNode, prefix: string) =>
    Array.from(root.querySelectorAll(`[data-test^='${prefix}-label-']`)).map((el) =>
      el.textContent?.replace("Beta", "").trim(),
    );

  it("heads each Reliability section in the flyout and in the inline expand", async () => {
    await mountAt("/logs");
    await openFlyout();
    expect(sectionLabels(flyout()!, "sidebar-flyout-section")).toEqual([
      "Alerts",
      "Response",
      "On-Call",
    ]);
    const alerts = flyout()!.querySelector("[data-test='sidebar-flyout-section-alerts']")!;
    expect(alerts.getAttribute("role")).toBe("group");
    const heading = alerts.querySelector("[role='presentation']")!;
    expect(alerts.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(
      alerts.querySelector("[data-test='sidebar-flyout-item-alertDestinations']"),
    ).not.toBeNull();

    await wrapper.find("[data-test='sidebar-item-reliability']").trigger("click");
    const inline = wrapper.find("[data-test='sidebar-children-reliability']").element;
    expect(sectionLabels(inline, "sidebar-section")).toEqual(["Alerts", "Response", "On-Call"]);
  });

  it("leaves a group without sections as a flat list", async () => {
    const withDashboards: NavItem[] = [
      ...links,
      { title: raw("Dashboards"), icon: "home", link: "/dashboards", name: "dashboards" },
      { title: raw("Reports"), icon: "home", link: "/reports", name: "reports" },
    ];
    await mountAt("/logs", {}, true, withDashboards);
    await openFlyout("dashboards");
    const panel = document.querySelector("[data-test='sidebar-flyout-dashboards']")!;
    expect(panel.querySelectorAll("[data-test^='sidebar-flyout-section']")).toHaveLength(0);
    expect(panel.querySelectorAll("[role='group']")).toHaveLength(0);
    expect(panel.querySelectorAll("[data-test^='sidebar-flyout-item-']")).toHaveLength(2);
  });

  it("moves the Beta badge to the heading when the whole section is beta", async () => {
    await mountAt("/logs");
    await openFlyout();
    const onCall = flyout()!.querySelector("[data-test='sidebar-flyout-section-onCall']")!;
    expect(
      onCall.querySelector(
        "[data-test='sidebar-flyout-section-label-onCall'] [data-test='beta-badge']",
      ),
    ).not.toBeNull();
    expect(onCall.querySelectorAll("[data-test='beta-badge']")).toHaveLength(1);
  });

  it("keeps per-row Beta badges in a mixed section", async () => {
    const was = config.isEnterprise;
    (config as { isEnterprise: string }).isEnterprise = "true";
    try {
      const withDowntimes: NavItem[] = [
        ...links,
        { title: raw("Downtimes"), icon: "home", link: "/downtimes", name: "downtimes" },
      ];
      await mountAt("/logs", { downtimes_enabled: true }, true, withDowntimes);
      await openFlyout();
      const response = flyout()!.querySelector("[data-test='sidebar-flyout-section-response']")!;
      const badgeIn = (sel: string) => response.querySelector(`${sel} [data-test='beta-badge']`);
      expect(badgeIn("[data-test='sidebar-flyout-section-label-response']")).toBeNull();
      expect(badgeIn("[data-test='sidebar-flyout-item-downtimes']")).not.toBeNull();
      expect(badgeIn("[data-test='sidebar-flyout-item-sloList']")).toBeNull();
    } finally {
      (config as { isEnterprise: string }).isEnterprise = was;
    }
  });

  it("moves arrow-key focus across sections without stopping on a heading", async () => {
    await mountAt("/logs");
    await openFlyout();
    const item = (name: string) =>
      flyout()!.querySelector<HTMLElement>(`[data-test='sidebar-flyout-item-${name}']`)!;
    item("alertDestinations").focus();
    item("alertDestinations").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(document.activeElement).toBe(item("sloList"));
    item("sloList").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(item("alertDestinations"));
    for (const heading of flyout()!.querySelectorAll<HTMLElement>("[role='presentation']")) {
      expect(heading.tabIndex).toBe(-1);
    }
  });
});
