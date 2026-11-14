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
import {
  computed,
  defineComponent,
  h,
  nextTick,
  ref,
  shallowRef,
  unref,
  type Component,
  type Ref,
} from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import { providePageHeaderStatus } from "@/lib/core/PageHeader/pageHeaderStatus";
import { providePageNavContext } from "@/lib/core/PageHeader/pageContext";
import { raw } from "@/types/i18n";
import OAccessHeaderChip from "@/components/access/OAccessHeaderChip.vue";
import { viewDenial } from "@/composables/useAccessStore";
import type { NavItem } from "@/lib/core/Navbar/ONavbar.types";

const lgUp = ref(true);
const smUp = ref(true);
vi.mock("@/composables/useBreakpoint", () => ({
  default: () => ({
    isMobile: computed(() => false),
    smUp: computed(() => smUp.value),
    lgUp: computed(() => lgUp.value),
  }),
}));

const entries = shallowRef([viewDenial("templates", "list", ["GET /api/default/templates"])]);
vi.mock("@/composables/useAccessStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useAccessStore")>();
  return { ...actual, useAccessBoundary: () => ({ sectionEntries: entries }) };
});

const Page = { render: () => null };
const ROUTES = [
  { path: "/", name: "home", component: Page },
  { path: "/logs", name: "logs", component: Page },
  { path: "/alerts", name: "alertList", component: Page },
  { path: "/alerts/destinations", name: "alertDestinations", component: Page },
  { path: "/alerts/detail/:id", name: "alertDetail", component: Page },
  { path: "/streams", name: "logstreams", component: Page },
  { path: "/pipelines", name: "pipelines", component: Page },
  { path: "/settings", name: "settings", component: Page },
  { path: "/settings/correlation/services", name: "correlationServices", component: Page },
  { path: "/iam", name: "iam", component: Page },
  { path: "/iam/users", name: "users", component: Page },
  { path: "/ai", name: "aiObservability", component: Page },
  { path: "/ai/model-pricing", name: "modelPricing", component: Page },
  { path: "/security/overview", name: "securityOverview", component: Page },
  { path: "/alert-destinations", name: "alertDestinationsShared", component: Page },
];

let wrapper: VueWrapper | null = null;
let resizeCallbacks: ResizeObserverCallback[] = [];
class MockResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    resizeCallbacks.push(cb);
  }
  observe = vi.fn();
  disconnect = vi.fn();
}

const makeRouter = () => createRouter({ history: createMemoryHistory(), routes: ROUTES });

async function mountAt(
  path: string,
  props: Record<string, unknown>,
  slots: Record<string, () => unknown> = {},
  links?: NavItem[] | Ref<NavItem[]>,
  flat = false,
): Promise<Router> {
  const router = makeRouter();
  await router.push(path);
  const Host = defineComponent({
    setup() {
      if (links)
        providePageNavContext({
          links: computed(() => unref(links)),
          flat: computed(() => flat),
        });
      return () => h(OPageHeader, props, slots);
    },
  });
  wrapper = mount(Host, { attachTo: document.body, global: { plugins: [i18n, router] } });
  await flushPromises();
  return router;
}

const byTest = (id: string) => wrapper!.find(`[data-test="${id}"]`);
const contextText = () => byTest("o-page-header-context").text();

// Every box from the header down to the <h1>, with its classes: identical chains give identical rects.
function titleChain(): string[] {
  const chain: string[] = [];
  let el: Element | null = wrapper!.find("h1").element;
  while (el && el !== wrapper!.element.parentElement) {
    const preceding = Array.from(el.parentElement?.children ?? [])
      .slice(0, Array.from(el.parentElement?.children ?? []).indexOf(el))
      .map((s) => s.className);
    chain.push(`${el.tagName}.${el.className} after [${preceding.join(" | ")}]`);
    if (el.classList.contains("app-page-header")) break;
    el = el.parentElement;
  }
  return chain;
}

beforeEach(() => {
  resizeCallbacks = [];
  lgUp.value = true;
  smUp.value = true;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

describe("OPageHeader anatomy (H1)", () => {
  it("stacks a 16 px context line over a 24 px title in a fixed 56 px band", async () => {
    await mountAt("/logs", { title: raw("Logs") });
    expect(byTest("o-page-header-band").classes()).toContain("h-14");
    expect(byTest("o-page-header-context").classes()).toContain("h-4");
    expect(byTest("o-page-header-title-row").classes()).toContain("h-6");
    const title = wrapper!.find("h1");
    expect(title.text()).toBe("Logs");
    expect(title.classes()).toEqual(expect.arrayContaining(["text-base", "font-semibold"]));
  });

  it("renders no icon tile and no subtitle paragraph (H2)", async () => {
    await mountAt("/logs", { title: raw("Logs"), icon: "search", subtitle: raw("Explore logs") });
    expect(wrapper!.text()).not.toContain("Explore logs");
    expect(wrapper!.findAll("svg").length).toBe(0);
  });

  it("puts help behind an About button beside the title (H2)", async () => {
    await mountAt("/logs", { title: raw("Logs"), about: raw("Search every log line.") });
    const about = byTest("o-page-header-about");
    expect(about.exists()).toBe(true);
    expect(about.attributes("aria-label")).toBe("About this page");
    expect(byTest("o-page-header-title-row").element.contains(about.element)).toBe(true);
  });

  it("shows the status after the title (H5)", async () => {
    await mountAt(
      "/alerts",
      { title: raw("Alerts") },
      { status: () => h("span", { "data-test": "firing" }, "3 firing") },
    );
    const row = byTest("o-page-header-title-row").element;
    const status = byTest("firing").element;
    expect(row.contains(status)).toBe(true);
    expect(wrapper!.find("h1").element.compareDocumentPosition(status)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe("OPageHeader context line (H4)", () => {
  const links: NavItem[] = [
    { title: raw("Logs"), icon: "search", link: "/logs", name: "logs" },
    { title: raw("Alerts"), icon: "alert", link: "/alerts", name: "alertList" },
    { title: raw("Incidents"), icon: "alert", link: "/incidents", name: "incidentList" },
    { title: raw("Streams"), icon: "db", link: "/streams", name: "streams" },
    { title: raw("Pipelines"), icon: "db", link: "/pipelines", name: "pipeline" },
  ];

  it("names the rail group of a grouped page, from the nav model", async () => {
    await mountAt("/alerts/destinations", { title: raw("Alerts") }, {}, links);
    expect(contextText()).toBe("Reliability");
  });

  it("names the group of a drill-down by its deepest section", async () => {
    await mountAt("/pipelines", { title: raw("Pipelines") }, {}, links);
    expect(contextText()).toBe("Data");
  });

  it("names the org on an ungrouped page", async () => {
    await mountAt("/logs", { title: raw("Logs") }, {}, links);
    expect(contextText()).toBe("");
    expect(byTest("o-page-header-context-label").exists()).toBe(true);
  });

  it("names the org when the rail does not emit the group", async () => {
    const lone: NavItem[] = [{ title: raw("Alerts"), icon: "a", link: "/alerts", name: "logs" }];
    await mountAt("/alerts", { title: raw("Alerts") }, {}, lone);
    expect(contextText()).not.toBe("Reliability");
  });

  it("takes an explicit context over the derived one", async () => {
    await mountAt("/alerts", { title: raw("Alerts"), context: raw("Playground") }, {}, links);
    expect(contextText()).toBe("Playground");
  });

  const securityLinks: NavItem[] = [
    { title: raw("Overview"), icon: "chart", link: "/security/overview", name: "securityOverview" },
  ];

  it.each([
    ["/settings/correlation/services", "Settings"],
    ["/iam/users", "IAM"],
    ["/ai/model-pricing", "AI observability"],
  ])("names the module whose section rail holds %s, in either solution", async (path, label) => {
    await mountAt(path, { title: raw("Page") }, {}, links);
    expect(contextText()).toBe(label);
    wrapper!.unmount();
    await mountAt(path, { title: raw("Page") }, {}, securityLinks, true);
    expect(contextText()).toBe(label);
  });

  it("names the Security solution on a page of its flat rail", async () => {
    await mountAt("/security/overview", { title: raw("Overview") }, {}, securityLinks, true);
    expect(contextText()).toBe("Security");
  });

  it("names the org on a shared page the flat rail does not hold", async () => {
    await mountAt("/alert-destinations", { title: raw("Destinations") }, {}, securityLinks, true);
    expect(contextText()).toBe("");
  });

  it.each([
    ["/iam/users", "IAM", false],
    ["/security/overview", "Security", true],
  ])("keeps %s on its label while the rail's links load", async (path, label, flat) => {
    const pending = ref<NavItem[]>([]);
    await mountAt(path, { title: raw("Page") }, {}, pending, flat);
    expect(contextText()).toBe(label);
    pending.value = flat ? securityLinks : links;
    await flushPromises();
    expect(contextText()).toBe(label);
  });

  it("turns into a real ‹ Parent link on a detail page", async () => {
    await mountAt("/alerts/detail/1", {
      title: raw("payments-5xx-rate"),
      back: { label: raw("Alerts"), to: { name: "alertList" } },
    });
    const link = byTest("app-page-header-back");
    expect(link.element.tagName).toBe("A");
    expect(link.attributes("href")).toBe("/alerts");
    expect(link.text()).toBe("Alerts");
    expect(link.attributes("aria-label")).toBe("Back to Alerts");
  });

  it("goes to the parent on a deep link with no history (N3)", async () => {
    const router = await mountAt("/alerts/detail/1", {
      title: raw("payments-5xx-rate"),
      back: { label: raw("Alerts"), to: { name: "alertList" } },
    });
    const back = vi.spyOn(router, "back");
    await byTest("app-page-header-back").trigger("click");
    await flushPromises();
    expect(back).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe("alertList");
  });

  it("returns through history when there is a previous entry (N3)", async () => {
    window.history.replaceState({ back: "/alerts" }, "");
    const router = await mountAt("/alerts/detail/1", {
      title: raw("payments-5xx-rate"),
      back: { label: raw("Alerts"), to: { name: "alertList" } },
    });
    const back = vi.spyOn(router, "back").mockImplementation(() => undefined);
    await byTest("app-page-header-back").trigger("click");
    expect(back).toHaveBeenCalledOnce();
    window.history.replaceState(null, "");
  });

  it("lets a modified click open the parent in a new tab", async () => {
    const onClick = vi.fn();
    await mountAt("/alerts/detail/1", {
      title: raw("x"),
      back: { label: raw("Alerts"), to: { name: "alertList" }, onClick },
    });
    await byTest("app-page-header-back").trigger("click", { ctrlKey: true });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("runs onClick for an in-page parent with no route", async () => {
    const onClick = vi.fn();
    await mountAt("/alerts", { title: raw("Edit"), back: { label: raw("Roles"), onClick } });
    const link = byTest("app-page-header-back");
    expect(link.element.tagName).toBe("BUTTON");
    await link.trigger("click");
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("OPageHeader actions (H3, R2)", () => {
  const slots = {
    actions: () => h("button", { "data-test": "primary" }, "New alert"),
    "actions-overflow": () => h("button", { "data-test": "secondary" }, "Import"),
  };

  it("orders secondary, then primary", async () => {
    await mountAt("/alerts", { title: raw("Alerts") }, slots);
    const secondary = byTest("secondary").element;
    const primary = byTest("primary").element;
    expect(secondary.compareDocumentPosition(primary)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(byTest("app-page-header-more-btn").exists()).toBe(false);
  });

  it("folds the secondaries into ⋯ More, after the primary, under 640 px", async () => {
    smUp.value = false;
    await mountAt("/alerts", { title: raw("Alerts") }, slots);
    expect(byTest("secondary").exists()).toBe(false);
    const more = byTest("app-page-header-more-btn").element;
    expect(byTest("primary").element.compareDocumentPosition(more)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe("OPageHeader stability (H1, H8, header-spec test)", () => {
  const Tabs = defineComponent({
    props: { active: { type: String, required: true } },
    setup: (props) => () =>
      h("div", { role: "tablist" }, [
        h("button", { role: "tab", "aria-selected": props.active === "a" }, "All alerts"),
        h("button", { role: "tab", "aria-selected": props.active === "b" }, "Destinations"),
      ]),
  });

  it("keeps the title box and the band height across a tab switch", async () => {
    const active = ref("a");
    const router = makeRouter();
    await router.push("/alerts");
    wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(
            OPageHeader,
            { title: raw("Alerts") },
            {
              actions: () => h("button", active.value === "a" ? "New alert" : "New destination"),
              tabs: () => h(Tabs, { active: active.value }),
            },
          ),
      }),
      { attachTo: document.body, global: { plugins: [i18n, router] } },
    );
    await flushPromises();
    const title = wrapper.find("h1").element;
    const before = titleChain();
    active.value = "b";
    await nextTick();
    expect(wrapper.find("h1").element).toBe(title);
    expect(wrapper.find("h1").text()).toBe("Alerts");
    expect(titleChain()).toEqual(before);
    // The tab row is a sibling after the band, never inside the title's line.
    const band = byTest("o-page-header-band").element;
    const tabRow = byTest("o-page-header-tabs").element;
    expect(band.contains(tabRow)).toBe(false);
    expect(band.compareDocumentPosition(tabRow)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(tabRow.className).toContain("h-10");
    // A fixed track bottom-aligns the taller strip, so the underline sits on the row's divider.
    expect(tabRow.className).toContain("grid-rows-[minmax(0,1fr)]");
    expect(tabRow.className).toContain("pb-px");
  });

  it("puts the title in the same box with a context label, a back link or tabs", async () => {
    await mountAt("/alerts", { title: raw("Alerts") });
    const plain = titleChain();
    wrapper!.unmount();
    await mountAt("/alerts/detail/1", {
      title: raw("payments-5xx-rate"),
      back: { label: raw("Alerts"), to: { name: "alertList" } },
    });
    expect(titleChain()).toEqual(plain);
    wrapper!.unmount();
    await mountAt("/alerts", { title: raw("Alerts") }, { tabs: () => h(Tabs, { active: "a" }) });
    expect(titleChain()).toEqual(plain);
  });

  it("never sizes a box above the title by its content", async () => {
    await mountAt(
      "/alerts",
      { title: raw("A very long alert name that keeps going and going") },
      {
        actions: () => h("button", "New alert"),
        status: () => h("span", "Firing"),
      },
    );
    const contentSized = /\b(h-auto|min-h-|flex-wrap|max-lg:h-|@max-4xl\/page:h-)/;
    for (const box of titleChain()) expect(box).not.toMatch(contentSized);
    expect(byTest("o-page-header-band").classes()).toEqual(
      expect.arrayContaining(["grid", "h-14", "grid-cols-[minmax(0,1fr)_auto]"]),
    );
  });
});

describe("OPageHeader with a provided status", () => {
  const Status = defineComponent({
    props: { compact: Boolean },
    setup: (props) => () =>
      h("button", { "data-test": "status", "data-compact": String(props.compact) }),
  });

  async function mountWithStatus(status: Component, pageWidth?: number) {
    const router = makeRouter();
    await router.push("/alerts");
    const setWidth = (el: unknown) => {
      if (el instanceof HTMLElement)
        Object.defineProperty(el, "clientWidth", { configurable: true, value: pageWidth });
    };
    wrapper = mount(
      defineComponent({
        setup() {
          providePageHeaderStatus(
            () => status,
            () => "/",
          );
          return () => {
            const header = h(OPageHeader, { title: raw("Alerts") });
            return pageWidth === undefined
              ? header
              : h("div", { class: "@container/page", ref: setWidth }, [header]);
          };
        },
      }),
      { attachTo: document.body, global: { plugins: [i18n, router] } },
    );
    await flushPromises();
  }

  it("shows the status once, after the title", async () => {
    await mountWithStatus(Status);
    const status = wrapper!.findAll('[data-test="status"]');
    expect(status).toHaveLength(1);
    expect(byTest("o-page-header-title-row").element.contains(status[0].element)).toBe(true);
    expect(status[0].attributes("data-compact")).toBe("false");
  });

  it("compacts the status in a narrow page container on a wide window", async () => {
    await mountWithStatus(Status, 700);
    expect(byTest("status").attributes("data-compact")).toBe("true");
  });

  it("sizes the access chip by the page width and keeps it after the title", async () => {
    await mountWithStatus(OAccessHeaderChip, 700);
    const chip = () => document.querySelector<HTMLElement>('[data-test="access-header-chip"]')!;
    expect(chip().className).toContain("h-control-xs");
    const page = wrapper!.element as HTMLElement;
    Object.defineProperty(page, "clientWidth", { configurable: true, value: 1200 });
    for (const cb of resizeCallbacks) cb([], {} as ResizeObserver);
    await flushPromises();
    expect(chip().className).not.toContain("h-control-xs");
    expect(byTest("o-page-header-title-row").element.contains(chip())).toBe(true);
  });
});
