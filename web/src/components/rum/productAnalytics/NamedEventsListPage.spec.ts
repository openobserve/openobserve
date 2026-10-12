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
import { createRouter, createWebHistory, type Router } from "vue-router";
import { createStore } from "vuex";

const { confirmMock, toastMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(async (_opts: Record<string, unknown>) => true),
  toastMock: vi.fn(),
}));
vi.mock("@/services/rumProductAnalytics", async () => ({
  default: (await import("@/utils/rum/__fixtures__/namedEventsApiMock")).rumPaApiMock.service,
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: toastMock,
}));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

import useProductAnalytics, { resetProductAnalytics } from "@/composables/rum/useProductAnalytics";
import useNamedEvents, {
  readNamedEventHandoff,
  resetNamedEvents,
} from "@/composables/rum/useNamedEvents";
import { resetSavedFunnels } from "@/composables/rum/useSavedFunnels";
import { MAX_EVENTS_PER_APP } from "@/utils/rum/productAnalyticsModel";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";
import { rumPaApiMock as api } from "@/utils/rum/__fixtures__/namedEventsApiMock";
import NamedEventsListPage from "./NamedEventsListPage.vue";
import OTable from "@/lib/core/Table/OTable.vue";

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org1" },
    zoConfig: {},
    timezone: "UTC",
    theme: "light",
    userInfo: { email: "me@x.com" },
  },
});

const Stub = { template: "<div />" };
const q = <T extends HTMLElement = HTMLElement>(dt: string) =>
  document.querySelector<T>(`[data-test="${dt}"]`);
// OTable holds its skeleton for 50 ms, so each settle outlasts it.
const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 20));
    await flushPromises();
  }
};

describe("NamedEventsListPage (AC-44)", () => {
  let wrapper: VueWrapper | null = null;
  let router: Router;

  const mountList = async () => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/pa/overview", name: PA_ROUTES.overview, component: Stub },
        { path: "/pa/events", name: PA_ROUTES.events, component: NamedEventsListPage },
        { path: "/pa/events/new", name: PA_ROUTES.eventNew, component: Stub },
        { path: "/pa/events/:id/edit", name: PA_ROUTES.eventEdit, component: Stub, props: true },
      ],
    });
    useProductAnalytics().initFromRoute({ app: "web", period: "7d" });
    await router.push({ name: PA_ROUTES.events, query: { app: "web", period: "7d" } });
    wrapper = mount(
      { template: "<router-view />" },
      { global: { plugins: [router, store] }, attachTo: document.body },
    );
    await settle();
  };

  const seed = (n: number) =>
    Array.from({ length: n }, (_, i) => api.seedEvent("web", `Event ${i}`));
  const rowText = () =>
    [...document.querySelectorAll('[data-test^="rum-analytics-named-events-row-"]')]
      .filter((el) => /row-\d+$/.test(el.getAttribute("data-test") ?? ""))
      .map((el) => el.textContent?.trim());
  const selectRow = async (i: number) => {
    q(`o2-table-row-${i}`)!
      .querySelector<HTMLElement>('[data-test="o2-table-select-cell"]')!
      .click();
    await flushPromises();
  };

  beforeEach(() => {
    api.reset();
    confirmMock.mockReset().mockResolvedValue(true);
    toastMock.mockReset();
    resetNamedEvents();
    resetSavedFunnels();
    resetProductAnalytics();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("lists the app's events with a rule summary, the funnels using each, and the cap usage", async () => {
    const [a] = seed(2);
    api.seedEvent("shop", "Other app");
    api.seedFunnel("web", "Signup", {
      s: [
        ["p", "/"],
        ["e", a.id],
      ],
      u: "sessions",
      w: "session",
    });
    await mountList();
    expect(rowText()).toEqual(["Event 0", "Event 1"]);
    expect(q("rum-analytics-named-events-row-0-rules")?.textContent).toContain("Page = /web/logs");
    expect(q("rum-analytics-named-events-row-0-used-by")?.textContent).toContain("1 funnel");
    expect(q("rum-analytics-named-events-row-1-used-by")?.textContent?.trim()).toBe("—");
    expect(q("rum-analytics-named-events-cap")?.textContent).toContain(
      `2 of ${MAX_EVENTS_PER_APP} named events`,
    );
  });

  it("search narrows the rows, and the filtered empty state clears the search", async () => {
    seed(3);
    await mountList();
    const search = document.querySelector<HTMLInputElement>(
      '[data-test="rum-analytics-named-events-search"] input, input[data-test="rum-analytics-named-events-search"]',
    )!;
    search.value = "event 2";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(rowText()).toEqual(["Event 2"]);
    search.value = "nothing";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(rowText()).toEqual([]);
    const empty = q("rum-analytics-named-events-empty")!;
    expect(empty.textContent).toContain("No named events found");
    empty.querySelector<HTMLElement>("button")!.click();
    await settle();
    expect(rowText()).toEqual(["Event 0", "Event 1", "Event 2"]);
  });

  it("a row click and Edit open the editor route, carrying the scope query", async () => {
    const [a, b] = seed(2);
    await mountList();
    q("o2-table-row-1")!.querySelector<HTMLElement>('[data-test="o2-table-cell-rules"]')!.click();
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.eventEdit);
    expect(router.currentRoute.value.params.id).toBe(b.id);
    expect(router.currentRoute.value.query).toMatchObject({ app: "web", period: "7d" });
    await router.push({ name: PA_ROUTES.events, query: { app: "web", period: "7d" } });
    await settle();
    q("rum-analytics-named-events-row-0-edit-btn")!.click();
    await settle();
    expect(router.currentRoute.value.params.id).toBe(a.id);
  });

  it("Duplicate opens a new event pre-filled as a copy, and the row stays put", async () => {
    seed(1);
    await mountList();
    q("rum-analytics-named-events-row-0-duplicate-btn")!.click();
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.eventNew);
    expect(router.currentRoute.value.query.app).toBe("web");
    expect(readNamedEventHandoff(router.options.history.state)).toEqual({
      draft: { name: "Copy of Event 0", rules: [{ t: "view", op: "eq", value: "/web/logs" }] },
      pageHints: [],
      from: null,
    });
    expect(api.service.createEvent).not.toHaveBeenCalled();
  });

  it("deletes an unused event after the plain confirmation, without force", async () => {
    const [ev] = seed(1);
    await mountList();
    q("rum-analytics-named-events-row-0-delete-btn")!.click();
    await settle();
    expect(confirmMock.mock.calls[0][0].message).toBe(
      'Delete "Event 0"? Funnels that use it will show a deleted-step tag.',
    );
    expect(api.service.deleteEvent.mock.calls).toEqual([["org1", "web", ev.id, false]]);
    expect(rowText()).toEqual([]);
  });

  it("an event a saved funnel uses gets one confirm naming the funnel, then deletes with force (CR-16, AC-69)", async () => {
    const [ev] = seed(1);
    api.seedFunnel("web", "Signup", {
      s: [
        ["p", "/"],
        ["e", ev.id],
      ],
      u: "sessions",
      w: "session",
    });
    await mountList();
    q("rum-analytics-named-events-row-0-delete-btn")!.click();
    await settle();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock.mock.calls[0][0].message).toBe(
      'Delete "Event 0"? It is used by 1 saved funnel: Signup. That funnel will show a Deleted event step.',
    );
    expect(api.service.deleteEvent.mock.calls).toEqual([["org1", "web", ev.id, true]]);
    expect(api.events.has(ev.id)).toBe(false);
  });

  it("a funnel that starts using the event after the check re-opens the confirm, and nothing is deleted on cancel", async () => {
    const [ev] = seed(1);
    await mountList();
    api.service.eventUsages.mockImplementationOnce(async () => {
      api.seedFunnel("web", "Late", {
        s: [
          ["p", "/"],
          ["e", ev.id],
        ],
        u: "sessions",
        w: "session",
      });
      return { data: { list: [] } };
    });
    confirmMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    q("rum-analytics-named-events-row-0-delete-btn")!.click();
    await settle();
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(confirmMock.mock.calls[1][0].message).toContain("1 saved funnel: Late");
    expect(api.service.deleteEvent.mock.calls).toEqual([["org1", "web", ev.id, false]]);
    expect(api.events.has(ev.id)).toBe(true);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("a cancelled or failed row delete keeps that row selected (W34)", async () => {
    seed(2);
    await mountList();
    await selectRow(0);
    const bulk = () => q("rum-analytics-named-events-bulk-delete-btn");
    expect(bulk()).not.toBeNull();
    confirmMock.mockResolvedValueOnce(false);
    q("rum-analytics-named-events-row-0-delete-btn")!.click();
    await settle();
    expect(bulk()).not.toBeNull();
    api.failNext("deleteEvent", 503);
    q("rum-analytics-named-events-row-0-delete-btn")!.click();
    await settle();
    expect(bulk()).not.toBeNull();
    q("rum-analytics-named-events-row-0-delete-btn")!.click();
    await settle();
    expect(bulk()).toBeNull();
  });

  it("bulk delete asks once, names the funnels in use, and forces only the events they use", async () => {
    const [a, b, c] = seed(3);
    api.seedFunnel("web", "Signup", {
      s: [
        ["p", "/"],
        ["e", b.id],
      ],
      u: "sessions",
      w: "session",
    });
    await mountList();
    await selectRow(0);
    await selectRow(1);
    q("rum-analytics-named-events-bulk-delete-btn")!.click();
    await settle();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock.mock.calls[0][0].message).toBe(
      "Delete 2 named events? Saved funnels will show a Deleted event step for: Event 1 (Signup).",
    );
    expect(api.service.deleteEvent.mock.calls).toEqual([
      ["org1", "web", a.id, false],
      ["org1", "web", b.id, true],
    ]);
    expect(rowText()).toEqual(["Event 2"]);
    expect(api.events.has(c.id)).toBe(true);
  });

  it("bulk delete tries every event, reloads once, and keeps only the failed ones selected (F2)", async () => {
    const [a, b, c] = seed(3);
    await mountList();
    for (const i of [0, 1, 2]) await selectRow(i);
    api.service.listEvents.mockClear();
    api.failNext("deleteEvent", 503);
    q("rum-analytics-named-events-bulk-delete-btn")!.click();
    await settle();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(api.service.deleteEvent).toHaveBeenCalledTimes(3);
    expect(api.events.has(a.id)).toBe(true);
    expect(api.events.has(b.id) || api.events.has(c.id)).toBe(false);
    expect(api.service.listEvents).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(rowText()).toEqual(["Event 0"]);
    expect(wrapper!.findComponent(OTable).props("selectedIds")).toEqual([a.id]);
  });

  it("bulk delete asks once more, naming every event a funnel started using after the check, then forces them (F2)", async () => {
    const [a, , c] = seed(3);
    await mountList();
    for (const i of [0, 1, 2]) await selectRow(i);
    const late = (id: string, name: string) =>
      api.seedFunnel("web", name, {
        s: [
          ["p", "/"],
          ["e", id],
        ],
        u: "sessions",
        w: "session",
      });
    api.service.eventUsages.mockImplementation(async () => ({ data: { list: [] } }));
    confirmMock.mockImplementationOnce(async () => {
      late(a.id, "Late A");
      late(c.id, "Late C");
      return true;
    });
    q("rum-analytics-named-events-bulk-delete-btn")!.click();
    await settle();
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(confirmMock.mock.calls[1][0].message).toBe(
      "Delete 2 named events? Saved funnels will show a Deleted event step for: Event 0 (Late A); Event 2 (Late C).",
    );
    expect(api.service.deleteEvent.mock.calls.slice(3)).toEqual([
      ["org1", "web", a.id, true],
      ["org1", "web", c.id, true],
    ]);
    expect(api.events.size).toBe(0);
    expect(wrapper!.findComponent(OTable).props("selectedIds")).toEqual([]);
  });

  it("declining the late re-confirm keeps those events and their selection (F2)", async () => {
    const [a, b] = seed(2);
    await mountList();
    for (const i of [0, 1]) await selectRow(i);
    api.service.eventUsages.mockImplementation(async () => ({ data: { list: [] } }));
    confirmMock
      .mockImplementationOnce(async () => {
        api.seedFunnel("web", "Late", {
          s: [
            ["p", "/"],
            ["e", a.id],
          ],
          u: "sessions",
          w: "session",
        });
        return true;
      })
      .mockResolvedValueOnce(false);
    q("rum-analytics-named-events-bulk-delete-btn")!.click();
    await settle();
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(api.events.has(a.id)).toBe(true);
    expect(api.events.has(b.id)).toBe(false);
    expect(wrapper!.findComponent(OTable).props("selectedIds")).toEqual([a.id]);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("bulk delete cancelled deletes nothing", async () => {
    seed(2);
    confirmMock.mockResolvedValueOnce(false);
    await mountList();
    await selectRow(0);
    q("rum-analytics-named-events-bulk-delete-btn")!.click();
    await settle();
    expect(confirmMock.mock.calls[0][0].message).toBe(
      "Delete 1 named event? Funnels that use it will show a deleted-step tag.",
    );
    expect(api.service.deleteEvent).not.toHaveBeenCalled();
  });

  it("with no events the empty state offers to create one", async () => {
    await mountList();
    const empty = q("rum-analytics-named-events-empty")!;
    expect(empty.textContent).toContain("No named events yet");
    empty.querySelector<HTMLElement>("button")!.click();
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.eventNew);
    expect(router.currentRoute.value.query.app).toBe("web");
  });

  it("a 403 on its own load shows the table's no-access state, not the first-run copy", async () => {
    api.failNext("listEvents", 403);
    await mountList();
    expect(q("o2-table-forbidden")).not.toBeNull();
    expect(q("rum-analytics-named-events-empty")).toBeNull();
  });

  it("a load failure offers a retry that reloads the list", async () => {
    api.failNext("listEvents", 503);
    seed(1);
    await mountList();
    const failed = q("rum-analytics-named-events-load-error")!;
    expect(failed).not.toBeNull();
    failed.querySelector<HTMLElement>("button")!.click();
    await settle();
    expect(rowText()).toEqual(["Event 0"]);
  });

  it("read-only after a refused write: the actions are disabled and the banner says why", async () => {
    seed(1);
    api.failNext("deleteEvent", 403);
    await mountList();
    q("rum-analytics-named-events-row-0-delete-btn")!.click();
    await settle();
    expect(useNamedEvents().permission.value).toBe("read");
    expect(q("rum-analytics-named-events-read-only")?.textContent).toContain(
      "can view but not change",
    );
    for (const action of ["edit", "duplicate", "delete"])
      expect(q<HTMLButtonElement>(`rum-analytics-named-events-row-0-${action}-btn`)!.disabled).toBe(
        true,
      );
  });

  it("names its icon-only row actions and keeps their tooltips outside the disabled buttons (W20, W29)", async () => {
    seed(1);
    await mountList();
    for (const [action, name] of [
      ["edit", "Edit"],
      ["duplicate", "Duplicate"],
      ["delete", "Delete"],
    ]) {
      const btn = q<HTMLButtonElement>(`rum-analytics-named-events-row-0-${action}-btn`)!;
      expect(btn.getAttribute("aria-label")).toBe(name);
      expect(btn.parentElement?.tagName).toBe("SPAN");
    }
  });

  it("at the cap Duplicate is disabled and the usage line reads full", async () => {
    seed(MAX_EVENTS_PER_APP);
    await mountList();
    expect(q<HTMLButtonElement>("rum-analytics-named-events-row-0-duplicate-btn")!.disabled).toBe(
      true,
    );
    expect(q("rum-analytics-named-events-cap")?.textContent).toContain(
      `${MAX_EVENTS_PER_APP} of ${MAX_EVENTS_PER_APP}`,
    );
  });

  it("Refresh reloads the events and the funnels that use them", async () => {
    seed(1);
    await mountList();
    const lists = api.service.listEvents.mock.calls.length;
    const funnels = api.service.listFunnels.mock.calls.length;
    api.seedEvent("web", "Added elsewhere");
    q("rum-analytics-named-events-refresh-btn")!.click();
    await settle();
    expect(api.service.listEvents.mock.calls.length).toBe(lists + 1);
    expect(api.service.listFunnels.mock.calls.length).toBe(funnels + 1);
    expect(rowText()).toEqual(["Added elsewhere", "Event 0"]);
  });
});
