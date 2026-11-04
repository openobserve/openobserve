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

vi.mock("@/services/rumProductAnalytics", async () => ({
  default: (await import("@/utils/rum/__fixtures__/namedEventsApiMock")).rumPaApiMock.service,
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
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";
import { rumPaApiMock as api } from "@/utils/rum/__fixtures__/namedEventsApiMock";
import {
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { fillField } from "@/test/unit/helpers/fillField";
import { byTest, click, clickLeave, clickRestore, pressEscape } from "@/test/unit/helpers/draftDom";
import NamedEventEditor from "./NamedEventEditor.vue";

interface EventDraft {
  name: string;
  rules: { value: string }[];
}

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
const newScope = (variant = "web"): EditorDraftScope => ({
  kind: "rum_named_event",
  org: "org1",
  entityId: null,
  userEmail: "me@x.com",
  variant,
});
const editScope = (id: string): EditorDraftScope => ({
  ...newScope(),
  entityId: id,
  variant: null,
});

const input = (dt: string) =>
  document.querySelector<HTMLInputElement>(`[data-test="${dt}"] input, input[data-test="${dt}"]`);

describe("NamedEventEditor drafts", () => {
  let wrapper: VueWrapper | null = null;
  let router: Router;

  const mountAt = async (
    name: string,
    params: Record<string, string> = {},
    state?: Record<string, unknown>,
  ) => {
    resetNamedEvents();
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
    await flushPromises();
  };

  const unmount = () => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  };

  const typeName = (value: string) => fillField("rum-analytics-named-events-name", value);

  beforeEach(() => {
    localStorage.clear();
    api.reset();
    resetNamedEvents();
    resetProductAnalytics();
    vi.mocked(searchService.search)
      .mockReset()
      .mockResolvedValue({ data: { hits: [{ e0_sessions: 4 }] } } as never);
    usePerformance().performanceState.data.streams._rumdata = { name: "_rumdata", schema: {} };
  });

  afterEach(unmount);

  it("keeps a new event's draft per app, typed with no key or pointer event", async () => {
    await mountAt(PA_ROUTES.eventNew);
    await typeName("Opened logs");
    window.dispatchEvent(new Event("pagehide"));

    expect(readEditorDraft<EventDraft>(newScope())?.data.name).toBe("Opened logs");
    expect(readEditorDraft(newScope("mobile"))).toBeNull();
  });

  it("a duplicate keeps its own slot, apart from a plain new event", async () => {
    const ev = api.seedEvent("web", "Checkout");
    const copy = namedEventHandoffState({
      draft: { name: "Copy of Checkout", rules: ev.rules as never },
      source: ev.id as string,
    });
    await mountAt(PA_ROUTES.eventNew, {}, copy);
    await typeName("Checkout copy");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<EventDraft>(newScope(`web~clone:${ev.id}`))?.data.name).toBe(
      "Checkout copy",
    );
    unmount();

    await mountAt(PA_ROUTES.eventNew);
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    unmount();

    await mountAt(PA_ROUTES.eventNew, {}, copy);
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
  });

  it("continues a draft, Start fresh drops it and Escape keeps it", async () => {
    writeEditorDraft(newScope(), {
      data: {
        name: "From draft",
        rules: [
          { t: "view", op: "eq", name: "", value: "/web/a", targets: [], onPage: "" },
          { t: "view", op: "prefix", name: "", value: "/web/b", targets: [], onPage: "" },
        ],
      },
    });
    await mountAt(PA_ROUTES.eventNew);
    expect(byTest("editor-draft-restore-message")?.textContent).toContain(
      "unsaved changes to this named event",
    );
    pressEscape();
    await flushPromises();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(input("rum-analytics-named-events-name")?.value).toBe("");
    expect(readEditorDraft(newScope())).not.toBeNull();
    unmount();

    await mountAt(PA_ROUTES.eventNew);
    click("editor-draft-continue");
    await flushPromises();
    expect(input("rum-analytics-named-events-name")?.value).toBe("From draft");
    expect(input("rum-analytics-named-events-rule-1-value")?.value).toBe("/web/b");
    unmount();

    await mountAt(PA_ROUTES.eventNew);
    clickRestore("o-dialog-secondary-btn");
    await flushPromises();
    expect(readEditorDraft(newScope())).toBeNull();
    expect(input("rum-analytics-named-events-name")?.value).toBe("");
  });

  it("keys an edit by the event's id and warns only when the event itself changed", async () => {
    const ev = api.seedEvent("web", "Checkout");
    const id = ev.id as string;
    await mountAt(PA_ROUTES.eventEdit, { id });
    await typeName("Checkout v2");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<EventDraft>(editScope(id))?.data.name).toBe("Checkout v2");
    unmount();

    await mountAt(PA_ROUTES.eventEdit, { id });
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
    expect(byTest("editor-draft-changed-on-server")).toBeNull();
    unmount();

    api.touch("events", id, { name: "Checkout (theirs)" });
    await mountAt(PA_ROUTES.eventEdit, { id });
    expect(byTest("editor-draft-changed-on-server")).not.toBeNull();
  });

  it("drops the draft of an event that no longer exists", async () => {
    api.seedEvent("web", "Other");
    writeEditorDraft(editScope("Missing00000000000000000001"), {
      data: { name: "Gone", rules: [] },
    });
    await mountAt(PA_ROUTES.eventEdit, { id: "Missing00000000000000000001" });

    expect(readEditorDraft(editScope("Missing00000000000000000001"))).toBeNull();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.events);
  });

  it("Cancel asks; Keep draft leaves with the draft", async () => {
    await mountAt(PA_ROUTES.eventNew);
    await typeName("Half done");
    click("rum-analytics-event-editor-cancel-btn");
    await flushPromises();
    clickLeave("o-dialog-secondary-btn");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe(PA_ROUTES.events);
    expect(readEditorDraft<EventDraft>(newScope())?.data.name).toBe("Half done");
  });

  it("Cancel asks; Discard leaves and drops the draft", async () => {
    await mountAt(PA_ROUTES.eventNew);
    await typeName("Not kept");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope())).not.toBeNull();

    click("rum-analytics-event-editor-cancel-btn");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("o-dialog-neutral-btn");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe(PA_ROUTES.events);
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(readEditorDraft(newScope())).toBeNull();
  });

  it("Save in the leave dialog creates the event and goes where the user was headed", async () => {
    await mountAt(PA_ROUTES.eventNew);
    await typeName("Opened logs");
    await fillField("rum-analytics-named-events-rule-0-value", "/web/logs");

    const navigation = router.push({ name: PA_ROUTES.overview, query: SCOPE });
    await flushPromises();
    clickLeave("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(api.bodies("createEvent").map((b) => b.name)).toEqual(["Opened logs"]);
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.overview);
    expect(readEditorDraft(newScope())).toBeNull();
  });

  it("Save in the leave dialog stays when the event is invalid", async () => {
    await mountAt(PA_ROUTES.eventNew);
    await typeName("No rule value");

    const navigation = router.push({ name: PA_ROUTES.overview, query: SCOPE });
    await flushPromises();
    clickLeave("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(api.service.createEvent).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.eventNew);
  });

  it("a normal save drops the draft and returns without asking", async () => {
    await mountAt(PA_ROUTES.eventNew);
    await typeName("Opened logs");
    await fillField("rum-analytics-named-events-rule-0-value", "/web/logs");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope())).not.toBeNull();

    byTest("rum-analytics-event-editor")!
      .closest("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe(PA_ROUTES.events));
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(readEditorDraft(newScope())).toBeNull();
  });
});
