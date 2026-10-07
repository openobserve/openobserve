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

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/services/rumProductAnalytics", async () => ({
  default: (await import("@/utils/rum/__fixtures__/namedEventsApiMock")).rumPaApiMock.service,
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: toastMock,
}));
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { search: vi.fn() } });
});

import searchService from "@/services/search";
import usePerformance from "@/composables/rum/usePerformance";
import { resetProductAnalytics } from "@/composables/rum/useProductAnalytics";
import useNamedEvents, {
  namedEventHandoffState,
  resetNamedEvents,
} from "@/composables/rum/useNamedEvents";
import { MAX_EVENTS_PER_APP, MAX_KEY_LENGTH } from "@/utils/rum/productAnalyticsModel";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";
import { rumPaApiMock as api } from "@/utils/rum/__fixtures__/namedEventsApiMock";
import NamedEventEditor from "./NamedEventEditor.vue";

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org1" },
    zoConfig: {},
    timezone: "UTC",
    theme: "light",
    userInfo: { email: "me@x.com" },
  },
});

const SCOPE = { org_identifier: "org1", app: "web", period: "7d" };
const Stub = { template: "<div data-test='stub-page' />" };

const q = <T extends HTMLElement = HTMLElement>(dt: string) =>
  document.querySelector<T>(`[data-test="${dt}"]`);
const input = (dt: string) =>
  document.querySelector<HTMLInputElement>(`[data-test="${dt}"] input, input[data-test="${dt}"]`);
const settle = async (n = 4) => {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setTimeout(r, 20));
    await flushPromises();
  }
};
const setValue = async (dt: string, value: string) => {
  const el = input(dt)!;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await flushPromises();
};
const dispatchSubmit = () =>
  q("rum-analytics-event-editor")!
    .closest("form")!
    .dispatchEvent(new Event("submit", { cancelable: true }));
const submitForm = async () => {
  dispatchSubmit();
  await settle();
};
const editorOpen = () => q("rum-analytics-event-editor") !== null;
const saveBtn = () => q<HTMLButtonElement>("rum-analytics-event-editor-save-btn")!;

describe("NamedEventEditor (AC-44)", () => {
  let wrapper: VueWrapper | null = null;
  let router: Router;

  const mountAt = async (
    name: string,
    params: Record<string, string> = {},
    state?: Record<string, unknown>,
  ) => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/pa/overview", name: PA_ROUTES.overview, component: Stub },
        { path: "/pa/events", name: PA_ROUTES.events, component: Stub },
        { path: "/pa/events/new", name: PA_ROUTES.eventNew, component: NamedEventEditor },
        {
          path: "/pa/events/:id/edit",
          name: PA_ROUTES.eventEdit,
          component: NamedEventEditor,
          props: true,
        },
      ],
    });
    await router.push({ name: PA_ROUTES.events, query: SCOPE });
    await router.push({ name, params, query: SCOPE, state });
    wrapper = mount(
      { template: "<router-view />" },
      { global: { plugins: [router, store] }, attachTo: document.body },
    );
    await vi.waitFor(() => expect(useNamedEvents().loading.value).toBe(false));
    await settle();
  };
  const fillNew = async (name: string, page: string) => {
    await setValue("rum-analytics-named-events-name", name);
    await setValue("rum-analytics-named-events-rule-0-value", page);
  };
  const seed = (n: number) =>
    Array.from({ length: n }, (_, i) => api.seedEvent("web", `Event ${i}`));
  const created = () => api.bodies("createEvent").map((b) => b.name);

  beforeEach(() => {
    api.reset();
    toastMock.mockReset();
    resetNamedEvents();
    resetProductAnalytics();
    vi.mocked(searchService.search)
      .mockReset()
      .mockResolvedValue({ data: { hits: [{ e0_sessions: 42 }] } } as never);
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = { name: "_rumdata", schema: {} };
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("creates an event with only its name and rules, then returns to the list with the scope", async () => {
    await mountAt(PA_ROUTES.eventNew);
    expect(q("rum-analytics-event-editor")?.textContent).toContain("Create named event");
    await fillNew("Opened logs", "/web/logs");
    await submitForm();
    expect(api.bodies("createEvent")).toEqual([
      { name: "Opened logs", rules: [{ t: "view", op: "eq", value: "/web/logs" }] },
    ]);
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.events);
    expect(router.currentRoute.value.query).toEqual(SCOPE);
    expect(useNamedEvents().events.value.map((e) => e.name)).toEqual(["Opened logs"]);
  });

  it("creates two events in one visit: New again opens an idle editor after the first save", async () => {
    await mountAt(PA_ROUTES.eventNew);
    await fillNew("Opened logs", "/web/logs");
    await submitForm();
    await router.push({ name: PA_ROUTES.eventNew, query: SCOPE });
    await settle();
    expect(saveBtn().disabled).toBe(false);
    expect(saveBtn().getAttribute("aria-busy")).not.toBe("true");
    expect(input("rum-analytics-named-events-name")?.value).toBe("");
    await fillNew("Opened traces", "/web/traces");
    await submitForm();
    expect(created()).toEqual(["Opened logs", "Opened traces"]);
  });

  it("edits load the event, send the opened version, and a conflict reloads, toasts and keeps the editor; saving again conflicts again", async () => {
    const [ev] = seed(1);
    await mountAt(PA_ROUTES.eventEdit, { id: ev.id });
    expect(q("rum-analytics-event-editor")?.textContent).toContain("Edit named event");
    expect(input("rum-analytics-named-events-name")?.value).toBe("Event 0");
    api.touch("events", ev.id, { name: "Event 0 (theirs)" });
    await setValue("rum-analytics-named-events-name", "Event 0 (mine)");
    await submitForm();
    expect(toastMock).toHaveBeenLastCalledWith({
      variant: "error",
      message: "Someone else changed this named event; it was reloaded",
    });
    expect(editorOpen()).toBe(true);
    toastMock.mockClear();
    await submitForm();
    expect(toastMock).toHaveBeenLastCalledWith({
      variant: "error",
      message: "Someone else changed this named event; it was reloaded",
    });
    expect(editorOpen()).toBe(true);
    expect(input("rum-analytics-named-events-name")?.value).toBe("Event 0 (mine)");
    expect(api.bodies("updateEvent").map((b) => [b.name, b.version])).toEqual([
      ["Event 0 (mine)", 1],
      ["Event 0 (mine)", 1],
    ]);
    expect(useNamedEvents().events.value.map((e) => e.name)).toEqual(["Event 0 (theirs)"]);
  });

  it("an id this app does not have toasts and returns to the list", async () => {
    seed(1);
    await mountAt(PA_ROUTES.eventEdit, { id: "Missing00000000000000000001" });
    expect(toastMock).toHaveBeenCalledWith({
      variant: "error",
      message: "This named event no longer exists",
    });
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.events);
  });

  it("a duplicate opens pre-filled as a copy and saves as a new event", async () => {
    const [ev] = seed(1);
    await mountAt(
      PA_ROUTES.eventNew,
      {},
      namedEventHandoffState({ draft: { name: "Copy of Event 0", rules: ev.rules as never } }),
    );
    expect(input("rum-analytics-named-events-name")?.value).toBe("Copy of Event 0");
    expect(input("rum-analytics-named-events-rule-0-value")?.value).toBe("/web/logs");
    await submitForm();
    expect(created()).toEqual(["Copy of Event 0"]);
    expect(api.service.updateEvent).not.toHaveBeenCalled();
  });

  it("Define as event pre-fills the click with its top page, and Back and Save return to Overview (AC-45)", async () => {
    await mountAt(
      PA_ROUTES.eventNew,
      {},
      namedEventHandoffState({
        draft: {
          name: "save-btn",
          rules: [{ t: "action", targets: ["save-btn"], onPage: "/web/a" }],
        },
        pageHints: ["/web/a", "/web/b"],
        from: "overview",
      }),
    );
    expect(input("rum-analytics-named-events-name")?.value).toBe("save-btn");
    expect(q("rum-analytics-named-events-rule-0")?.textContent).toContain("save-btn");
    expect(
      q("rum-analytics-named-events-rule-0-on-page-trigger")?.getAttribute(
        "data-test-selected-value",
      ),
    ).toBe("/web/a");
    q("rum-analytics-event-editor-back-btn")!.click();
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.overview);
    expect(router.currentRoute.value.query).toEqual(SCOPE);
    router.back();
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.eventNew);
    await submitForm();
    expect(created()).toEqual(["save-btn"]);
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.overview);
  });

  it("Back without a hand-off returns to the list with the scope", async () => {
    await mountAt(PA_ROUTES.eventNew);
    q("rum-analytics-event-editor-back-btn")!.click();
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.events);
    expect(router.currentRoute.value.query).toEqual(SCOPE);
  });

  it("leaving with unsaved changes asks first; Stay keeps the edits and Discard leaves", async () => {
    await mountAt(PA_ROUTES.eventNew);
    await setValue("rum-analytics-named-events-name", "Half done");
    q("rum-analytics-event-editor-cancel-btn")!.click();
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.eventNew);
    const dialog = () => q("rum-analytics-event-editor-discard-dialog");
    expect(dialog()?.textContent).toContain("unsaved changes");
    dialog()!.querySelector<HTMLButtonElement>('[data-test="o-dialog-secondary-btn"]')!.click();
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.eventNew);
    expect(input("rum-analytics-named-events-name")?.value).toBe("Half done");
    await router.push({ name: PA_ROUTES.overview, query: SCOPE });
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.eventNew);
    dialog()!.querySelector<HTMLButtonElement>('[data-test="o-dialog-primary-btn"]')!.click();
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.overview);
    expect(api.service.createEvent).not.toHaveBeenCalled();
  });

  it("a name taken in this app, ignoring case, is an inline error before and after the server says so", async () => {
    seed(1);
    await mountAt(PA_ROUTES.eventNew);
    await fillNew(" EVENT 0 ", "/web/logs");
    await submitForm();
    expect(api.service.createEvent).not.toHaveBeenCalled();
    expect(q("rum-analytics-event-editor")?.textContent).toContain(
      "A named event with this name already exists",
    );
    await setValue("rum-analytics-named-events-name", "Event 1");
    api.failNext("createEvent", 409, "duplicate_name");
    await submitForm();
    expect(api.service.createEvent).toHaveBeenCalledTimes(1);
    expect(toastMock).not.toHaveBeenCalled();
    expect(editorOpen()).toBe(true);
    expect(q("rum-analytics-event-editor")?.textContent).toContain(
      "A named event with this name already exists",
    );
    await setValue("rum-analytics-named-events-name", "Event 2");
    await submitForm();
    expect(created()).toEqual(["Event 1", "Event 2"]);
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.events);
  });

  it("a name too long once lowercased is an inline error, as the server's name key bound (F52); 64 dotted I save", async () => {
    await mountAt(PA_ROUTES.eventNew);
    await fillNew("İ".repeat(65), "/web/logs");
    await submitForm();
    expect(api.service.createEvent).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
    expect(q("rum-analytics-event-editor")?.textContent).toContain(
      "This name is too long once lowercased (at most 128 characters)",
    );
    await setValue("rum-analytics-named-events-name", "İ".repeat(64));
    await submitForm();
    expect(created()).toEqual(["İ".repeat(64)]);
  });

  it("rejects a pattern with a backreference inline and saves nothing", async () => {
    await mountAt(PA_ROUTES.eventNew);
    await setValue("rum-analytics-named-events-name", "Bad");
    (
      wrapper!.findComponent(NamedEventEditor).vm as unknown as {
        setRuleOp: (i: number, op: string) => void;
      }
    ).setRuleOp(0, "regex");
    await flushPromises();
    await setValue("rum-analytics-named-events-rule-0-value", "(a)\\1");
    await submitForm();
    expect(api.service.createEvent).not.toHaveBeenCalled();
    expect(q("rum-analytics-event-editor")?.textContent).toContain("Not a valid pattern");
  });

  it("an over-long On page is an inline field error, not a toast, and saves once the rule is removed (F46)", async () => {
    await mountAt(
      PA_ROUTES.eventNew,
      {},
      namedEventHandoffState({
        draft: {
          name: "Clicked save",
          rules: [
            { t: "view", op: "eq", value: "/web/logs" },
            { t: "action", targets: ["save-btn"], onPage: `/${"a".repeat(MAX_KEY_LENGTH)}` },
          ],
        },
      }),
    );
    await submitForm();
    expect({
      fieldError: q("rum-analytics-named-events-rule-1")?.textContent?.includes(
        "This page is too long (at most 1,024 characters)",
      ),
      toasts: toastMock.mock.calls.length,
      editorOpen: editorOpen(),
      saveBusy: saveBtn().getAttribute("aria-busy") === "true",
      creates: api.service.createEvent.mock.calls.length,
    }).toEqual({ fieldError: true, toasts: 0, editorOpen: true, saveBusy: false, creates: 0 });
    q<HTMLButtonElement>("rum-analytics-named-events-rule-1-remove")!.click();
    await flushPromises();
    await submitForm();
    expect(api.bodies("createEvent")).toEqual([
      { name: "Clicked save", rules: [{ t: "view", op: "eq", value: "/web/logs" }] },
    ]);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("a save refused at the cap toasts why, leaves the editor open and idle, and saves on retry once a slot frees (F44)", async () => {
    const seeded = seed(MAX_EVENTS_PER_APP);
    await mountAt(PA_ROUTES.eventNew);
    await fillNew("Opened traces", "/web/traces");
    await submitForm();
    expect(toastMock.mock.calls).toEqual([
      [
        {
          variant: "error",
          message: expect.stringContaining(`${MAX_EVENTS_PER_APP} named events`),
        },
      ],
    ]);
    expect({
      editorOpen: editorOpen(),
      name: input("rum-analytics-named-events-name")?.value,
      saveDisabled: saveBtn().disabled,
      saveBusy: saveBtn().getAttribute("aria-busy") === "true",
      cancelDisabled: q<HTMLButtonElement>("rum-analytics-event-editor-cancel-btn")!.disabled,
      sets: api.service.createEvent.mock.calls.length,
    }).toEqual({
      editorOpen: true,
      name: "Opened traces",
      saveDisabled: false,
      saveBusy: false,
      cancelDisabled: false,
      sets: 0,
    });
    api.events.delete(seeded[0].id);
    await useNamedEvents().load("org1", "web", true);
    await submitForm();
    expect(created()).toEqual(["Opened traces"]);
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("Cancel is disabled while a save is in flight, and the save lands once (was the drawer's Back)", async () => {
    const release = api.gate("createEvent");
    await mountAt(PA_ROUTES.eventNew);
    await fillNew("Opened logs", "/web/logs");
    await submitForm();
    expect(q<HTMLButtonElement>("rum-analytics-event-editor-cancel-btn")!.disabled).toBe(true);
    expect(saveBtn().getAttribute("aria-busy")).toBe("true");
    release();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe(PA_ROUTES.events));
    expect(api.service.createEvent).toHaveBeenCalledTimes(1);
  });

  it("leaving mid-save needs no discard prompt; the save lands without pulling the user back, and a new editor is idle (F37, F43)", async () => {
    const release = api.gate("createEvent");
    seed(1);
    await mountAt(PA_ROUTES.eventNew);
    await fillNew("Opened logs", "/web/logs");
    dispatchSubmit();
    await settle();
    await router.push({ name: PA_ROUTES.overview, query: SCOPE });
    await settle();
    expect(q("rum-analytics-event-editor-discard-dialog")).toBeNull();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.overview);
    await router.push({ name: PA_ROUTES.eventNew, query: SCOPE });
    await settle();
    expect(saveBtn().disabled).toBe(false);
    expect(saveBtn().getAttribute("aria-busy")).not.toBe("true");
    await setValue("rum-analytics-named-events-name", "Opened traces");
    release();
    await vi.waitFor(() =>
      expect(useNamedEvents().events.value.map((e) => e.name)).toEqual(["Event 0", "Opened logs"]),
    );
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.eventNew);
    expect(q("rum-analytics-event-editor-discard-dialog")).toBeNull();
    expect(input("rum-analytics-named-events-name")?.value).toBe("Opened traces");
    expect(toastMock).not.toHaveBeenCalled();
    await setValue("rum-analytics-named-events-rule-0-value", "/web/traces");
    await submitForm();
    expect(created()).toEqual(["Opened logs", "Opened traces"]);
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.events);
  });

  it("a second Save after the save landed, while the return is still pending, sends nothing more (F41)", async () => {
    const [ev] = seed(1);
    await mountAt(PA_ROUTES.eventEdit, { id: ev.id });
    let releaseNav!: () => void;
    const navHeld = new Promise<void>((r) => (releaseNav = r));
    router.beforeEach(async (to) => {
      if (to.name === PA_ROUTES.events) await navHeld;
    });
    await setValue("rum-analytics-named-events-name", "Renamed");
    await submitForm();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.eventEdit);
    expect(saveBtn().getAttribute("aria-busy")).not.toBe("true");
    await submitForm();
    releaseNav();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe(PA_ROUTES.events));
    expect(api.bodies("updateEvent").map((b) => [b.name, b.version])).toEqual([["Renamed", 1]]);
    expect(useNamedEvents().events.value.map((e) => e.name)).toEqual(["Renamed"]);
  });

  it("a refused write says the role is read-only and keeps the draft in the editor, with Save off", async () => {
    api.failNext("createEvent", 403);
    await mountAt(PA_ROUTES.eventNew);
    await fillNew("X", "/a");
    await submitForm();
    expect(useNamedEvents().permission.value).toBe("read");
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Your role can view but not change named events (RUM Product Analytics permission)",
      }),
    );
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.eventNew);
    expect(
      q<HTMLInputElement>("rum-analytics-named-events-name")?.querySelector("input")?.value,
    ).toBe("X");
    expect(saveBtn().disabled).toBe(true);
  });

  it("shows no-access without RUM data read", async () => {
    api.failNext("listEvents", 403);
    await mountAt(PA_ROUTES.eventNew);
    expect(q("rum-analytics-event-editor-no-access")).not.toBeNull();
  });

  it("previews the sessions the draft matches", async () => {
    await mountAt(
      PA_ROUTES.eventNew,
      {},
      namedEventHandoffState({
        draft: { name: "Logs", rules: [{ t: "view", op: "eq", value: "/web/logs" }] },
      }),
    );
    await new Promise((r) => setTimeout(r, 450));
    await flushPromises();
    expect(q("rum-analytics-named-events-preview")?.textContent).toContain("42");
    const sql = vi.mocked(searchService.search).mock.calls.at(-1)![0].query.query.sql as string;
    expect(sql).toContain("e0_sessions");
  });

  it("previews a single matching session in the singular", async () => {
    vi.mocked(searchService.search).mockResolvedValue({
      data: { hits: [{ e0_sessions: 1 }] },
    } as never);
    await mountAt(
      PA_ROUTES.eventNew,
      {},
      namedEventHandoffState({
        draft: { name: "Logs", rules: [{ t: "view", op: "eq", value: "/web/logs" }] },
      }),
    );
    await new Promise((r) => setTimeout(r, 450));
    await flushPromises();
    expect(q("rum-analytics-named-events-preview")?.textContent).toBe("Matched 1 session in range");
  });
});
