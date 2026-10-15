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
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive } from "vue";
import { createStore } from "vuex";
import { onBeforeRouteLeave } from "vue-router";
import { addPanel, getDashboard, getPanel } from "@/utils/commons";
import AddPanel from "./AddPanel.vue";

const drafts = vi.hoisted(() => ({
  store: new Map<string, any>(),
  available: true,
}));

vi.mock("@/composables/dashboard/usePanelDraft", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    isPanelDraftStorageAvailable: vi.fn(async () => drafts.available),
    prunePanelDrafts: vi.fn(async () => 0),
    savePanelDraft: vi.fn(async (input: any) => {
      const record = {
        ...JSON.parse(JSON.stringify(input)),
        key: actual.panelDraftKey(input),
        updatedAt: Date.now(),
      };
      drafts.store.set(record.key, record);
      return record;
    }),
    getPanelDraft: vi.fn(async (scope: any) => drafts.store.get(actual.panelDraftKey(scope))),
    deletePanelDraft: vi.fn(async (scope: any, draftId?: string) => {
      const key = actual.panelDraftKey(scope);
      if (draftId && drafts.store.get(key)?.draftId !== draftId) return;
      drafts.store.delete(key);
    }),
    newPanelDraftId: vi.fn(() => "draft-new"),
  };
});

vi.mock("@/utils/commons", () => ({
  addPanel: vi.fn(),
  checkIfVariablesAreLoaded: vi.fn(() => false),
  getDashboard: vi.fn(),
  getPanel: vi.fn(),
  updatePanel: vi.fn(),
  updateDashboard: vi.fn(),
}));

vi.mock("@/composables/dashboard/useDashboardPanel", async () => {
  const { reactive } = await import("vue");
  const fresh = () => ({
    id: "",
    title: "",
    type: "line",
    description: "",
    config: {},
    queryType: "sql",
    queries: [
      {
        query: "",
        customQuery: false,
        fields: {
          stream: "",
          stream_type: "logs",
          x: [],
          y: [],
          z: [],
          breakdown: [],
          filter: { conditions: [] },
        },
        config: {},
      },
    ],
  });
  const state = reactive({
    data: fresh(),
    layout: {
      currentQueryIndex: 0,
      vrlFunctionToggle: false,
      isConfigPanelOpen: false,
      showQueryBar: true,
      querySplitter: 41,
    },
    meta: { dateTime: null, stream: {} },
  });
  return {
    default: vi.fn(() => ({
      dashboardPanelData: state,
      resetDashboardPanelData: vi.fn(() => {
        state.data = fresh();
      }),
      resetDashboardPanelDataAndAddTimeField: vi.fn(() => {
        state.data = fresh();
      }),
      resetAggregationFunction: vi.fn(),
      validatePanel: vi.fn(),
      makeAutoSQLQuery: vi.fn(),
    })),
  };
});

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
    showPositiveNotification: vi.fn(),
    showConfictErrorNotificationWithRefreshBtn: vi.fn(),
  }),
}));
vi.mock("@/composables/useAiChat", () => ({
  default: () => ({ registerAiChatHandler: vi.fn(), removeAiChatHandler: vi.fn() }),
}));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStream: vi.fn() }) }));
vi.mock("@/composables/dashboard/useCancelQuery", () => ({
  default: () => ({ traceIdRef: { value: [] }, cancelQuery: vi.fn() }),
}));
vi.mock("@/aws-exports", () => ({ default: {} }));

const nav = vi.hoisted(() => ({
  route: null as any,
  push: null as any,
  replace: null as any,
}));

vi.mock("vue-router", async () => {
  const actual: any = await vi.importActual("vue-router");
  return {
    ...actual,
    onBeforeRouteLeave: vi.fn(),
    useRoute: () => nav.route,
    useRouter: () => ({ push: nav.push, replace: nav.replace }),
  };
});

const serverPanel = (title = "Server title") => ({
  id: "p1",
  title,
  type: "line",
  description: "",
  config: {},
  queryType: "sql",
  queries: [
    {
      query: "SELECT 1",
      customQuery: true,
      fields: {
        stream: "logs1",
        stream_type: "logs",
        x: [],
        y: [],
        z: [],
        breakdown: [],
        filter: { conditions: [] },
      },
      config: {},
    },
  ],
  layout: { x: 0, y: 0, w: 48, h: 9, i: 1 },
});

const PanelEditorStub = defineComponent({
  name: "PanelEditor",
  setup(_, { expose }) {
    expose({ initChartData: vi.fn(), runQuery: vi.fn(), reportValidationErrors: vi.fn() });
    return () => h("div");
  },
});

const DatePickerStub = defineComponent({
  name: "DateTimePickerDashboard",
  setup(_, { expose }) {
    expose({
      getConsumableDateTime: () => ({ startTime: 0, endTime: 1 }),
      refresh: vi.fn(),
      setCustomDate: vi.fn(),
    });
    return () => h("div");
  },
});

const OPageHeaderStub = {
  name: "OPageHeader",
  template: "<div><slot name='title' /><slot name='actions' /></div>",
};

const scope = { userId: "me@x.io", org: "org1", dashboardId: "dash1" };

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

const mountEditor = async () => {
  const store = createStore({
    state: {
      selectedOrganization: { identifier: "org1" },
      userInfo: { email: "me@x.io" },
      zoConfig: {},
      theme: "light",
      isAiChatEnabled: false,
    },
  });
  const wrapper = mount(AddPanel, {
    attachTo: document.body,
    global: {
      plugins: [store],
      stubs: {
        OPageHeader: OPageHeaderStub,
        PanelEditor: PanelEditorStub,
        DateTimePickerDashboard: DatePickerStub,
        QueryInspector: true,
        AddSettingVariable: true,
      },
    },
  });
  await flush();
  return wrapper;
};

const userEdits = async (wrapper: any, title: string) => {
  window.dispatchEvent(new Event("pointerdown"));
  wrapper.vm.dashboardPanelData.data.title = title;
  await nextTick();
};

const leaveGuard = () => vi.mocked(onBeforeRouteLeave).mock.calls.at(-1)![0] as any;

const DRAFT_KEY = "me@x.io|org1|dash1";

const seedDraft = (overrides: Record<string, unknown> = {}) => {
  const record = {
    key: DRAFT_KEY,
    ...scope,
    folder: "default",
    tab: "t2",
    draftId: "draft-old",
    data: { ...serverPanel("Draft title"), id: "" },
    variables: [],
    variablesWithCurrentPanel: [],
    updatedAt: Date.now() - 2 * 60 * 60_000,
    ...overrides,
  };
  drafts.store.set(DRAFT_KEY, record);
  return record;
};

// A plain Event's returnValue is a legacy boolean, so give the handler a writable slot to fill.
const unloadEvent = () => {
  const event: any = new Event("beforeunload");
  Object.defineProperty(event, "returnValue", { value: undefined, writable: true });
  return event;
};

const dialogButton = (name: "primary" | "secondary" | "neutral") =>
  document.querySelector(
    `[data-test="dashboard-panel-leave-dialog"] [data-test="o-dialog-${name}-btn"]`,
  ) as HTMLButtonElement;

describe("AddPanel new-panel drafts", () => {
  let wrapper: any;

  const routeWith = (query: Record<string, string>) =>
    reactive({
      path: "/dashboards/add_panel",
      query: { dashboard: "dash1", folder: "default", tab: "t1", ...query } as any,
      params: {},
    });

  beforeEach(() => {
    drafts.store.clear();
    drafts.available = true;
    nav.route = routeWith({});
    nav.push = vi.fn(async () => undefined);
    nav.replace = vi.fn(async ({ query }: any) => {
      nav.route.query = query;
    });
    vi.mocked(getDashboard).mockResolvedValue({
      title: "Dash",
      tabs: [
        { tabId: "t1", panels: [serverPanel()] },
        { tabId: "t2", panels: [] },
      ],
    } as any);
    vi.mocked(getPanel).mockResolvedValue(serverPanel() as any);
    vi.mocked(addPanel).mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("edit panel", () => {
    beforeEach(() => {
      nav.route = routeWith({ panelId: "p1" });
    });

    it("asks with the native confirm on route leave and writes no draft", async () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      wrapper = await mountEditor();
      await userEdits(wrapper, "Edited title");

      const next = vi.fn();
      await leaveGuard()({ path: "/logs" }, { path: "/dashboards/add_panel" }, next);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(false);
      expect(drafts.store.size).toBe(0);
      confirmSpy.mockRestore();
    });

    it("Discard navigates straight to the guard, without the leave dialog", async () => {
      wrapper = await mountEditor();
      await userEdits(wrapper, "Edited title");

      await wrapper.find('[data-test="dashboard-panel-discard"]').trigger("click");
      await flush();

      expect(document.querySelector('[data-test="dashboard-panel-leave-dialog"]')).toBeNull();
      expect(nav.push).toHaveBeenCalledWith(expect.objectContaining({ path: "/dashboards/view" }));
    });

    it("keeps the beforeunload prompt and never offers a draft", async () => {
      seedDraft();
      wrapper = await mountEditor();
      await userEdits(wrapper, "Edited title");

      const event = unloadEvent();
      window.dispatchEvent(event);

      expect(event.returnValue).toContain("unsaved changes");
      expect(wrapper.find('[data-test="dashboard-panel-draft-prompt"]').exists()).toBe(false);
      expect(drafts.store.get(DRAFT_KEY).draftId).toBe("draft-old");
    });
  });

  describe("add panel", () => {
    it("Discard with edits opens the leave dialog; Discard changes deletes the draft", async () => {
      wrapper = await mountEditor();
      await userEdits(wrapper, "Edited title");
      await wrapper.vm.flushDraft();
      expect(drafts.store.size).toBe(1);

      await wrapper.find('[data-test="dashboard-panel-discard"]').trigger("click");
      await flush();
      const dialog = document.querySelector('[data-test="dashboard-panel-leave-dialog"]');
      expect(dialog?.textContent).toContain("Leave panel editor?");

      dialogButton("secondary").click();
      await flush();

      expect(drafts.store.size).toBe(0);
      expect(nav.push).toHaveBeenCalledWith(expect.objectContaining({ path: "/dashboards/view" }));
    });

    it("Keep as draft stores the edits and leaves", async () => {
      wrapper = await mountEditor();
      await userEdits(wrapper, "Keep me");

      await wrapper.find('[data-test="dashboard-panel-discard"]').trigger("click");
      await flush();
      dialogButton("primary").click();
      await flush();

      const saved = drafts.store.get(DRAFT_KEY);
      expect(saved.data.title).toBe("Keep me");
      expect(saved.draftId).toBe("draft-new");
      expect(saved.tab).toBe("t1");
      expect(nav.push).toHaveBeenCalledTimes(1);
    });

    it("Keep editing closes the dialog and stays", async () => {
      wrapper = await mountEditor();
      await userEdits(wrapper, "Still here");

      await wrapper.find('[data-test="dashboard-panel-discard"]').trigger("click");
      await flush();
      dialogButton("neutral").click();
      await flush();

      expect(wrapper.vm.leaveDialogOpen).toBe(false);
      expect(nav.push).not.toHaveBeenCalled();
    });

    it("Discard without edits leaves straight away", async () => {
      wrapper = await mountEditor();

      await wrapper.find('[data-test="dashboard-panel-discard"]').trigger("click");
      await flush();

      expect(document.querySelector('[data-test="dashboard-panel-leave-dialog"]')).toBeNull();
      expect(nav.push).toHaveBeenCalledTimes(1);
    });

    it("autosaves after a pause and puts the draftId in the URL", async () => {
      wrapper = await mountEditor();
      vi.useFakeTimers();
      await userEdits(wrapper, "Autosaved");
      await vi.advanceTimersByTimeAsync(1100);
      vi.useRealTimers();
      await flush();

      expect(drafts.store.get(DRAFT_KEY).data.title).toBe("Autosaved");
      expect(nav.route.query.draftId).toBe("draft-new");
    });

    it("keeps the draft silently when the route leaves another way", async () => {
      const confirmSpy = vi.spyOn(window, "confirm");
      wrapper = await mountEditor();
      await userEdits(wrapper, "Left via nav");

      const next = vi.fn();
      await leaveGuard()({ path: "/logs" }, { path: "/dashboards/add_panel" }, next);

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
      expect(drafts.store.get(DRAFT_KEY).data.title).toBe("Left via nav");
      confirmSpy.mockRestore();
    });

    it("skips the beforeunload prompt", async () => {
      wrapper = await mountEditor();
      await userEdits(wrapper, "Refreshing");

      const event = unloadEvent();
      window.dispatchEvent(event);
      await flush();

      expect(event.returnValue).toBeFalsy();
      expect(drafts.store.get(DRAFT_KEY).data.title).toBe("Refreshing");
    });

    it("keeps the edits when an org switch unmounts the editor", async () => {
      wrapper = await mountEditor();
      await userEdits(wrapper, "Before org switch");
      nav.route.query = { org_identifier: "org2" };

      wrapper.unmount();
      wrapper = null;
      await flush();

      const saved = drafts.store.get(DRAFT_KEY);
      expect(saved.data.title).toBe("Before org switch");
      expect(saved.org).toBe("org1");
    });

    it("falls back to the native confirm when storage is unavailable", async () => {
      drafts.available = false;
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      wrapper = await mountEditor();
      await userEdits(wrapper, "Edited title");

      const next = vi.fn();
      await leaveGuard()({ path: "/logs" }, { path: "/dashboards/add_panel" }, next);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(false);
      confirmSpy.mockRestore();
    });

    it("prompts for a stored draft; Continue applies it in its tab", async () => {
      seedDraft();
      wrapper = await mountEditor();

      const prompt = wrapper.find('[data-test="dashboard-panel-draft-prompt"]');
      expect(prompt.text()).toContain("You have an unsaved panel from");

      await wrapper.find('[data-test="dashboard-panel-draft-continue"]').trigger("click");
      await flush();

      expect(wrapper.vm.dashboardPanelData.data.title).toBe("Draft title");
      expect(nav.route.query.tab).toBe("t2");
      expect(nav.route.query.draftId).toBe("draft-old");
      expect(wrapper.find('[data-test="dashboard-panel-draft-prompt"]').exists()).toBe(false);
    });

    it("Continue stays on the current tab when the draft's tab is gone", async () => {
      seedDraft({ tab: "deleted-tab" });
      wrapper = await mountEditor();

      await wrapper.find('[data-test="dashboard-panel-draft-continue"]').trigger("click");
      await flush();

      expect(nav.route.query.tab).toBe("t1");
      expect(wrapper.vm.dashboardPanelData.data.title).toBe("Draft title");
    });

    it("Start new deletes the stored draft", async () => {
      seedDraft();
      wrapper = await mountEditor();

      await wrapper.find('[data-test="dashboard-panel-draft-start-new"]').trigger("click");
      await flush();

      expect(drafts.store.size).toBe(0);
      expect(wrapper.vm.dashboardPanelData.data.title).not.toBe("Draft title");
    });

    it("does not overwrite a stored draft while its prompt is unanswered", async () => {
      seedDraft();
      wrapper = await mountEditor();
      await userEdits(wrapper, "Other panel");
      await wrapper.vm.flushDraft();

      expect(drafts.store.get(DRAFT_KEY).draftId).toBe("draft-old");
    });

    it("falls back to the native confirm while the prompt is unanswered", async () => {
      seedDraft();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      wrapper = await mountEditor();
      await userEdits(wrapper, "Other panel");

      await wrapper.find('[data-test="dashboard-panel-discard"]').trigger("click");
      await flush();
      expect(document.querySelector('[data-test="dashboard-panel-leave-dialog"]')).toBeNull();

      const event = unloadEvent();
      window.dispatchEvent(event);
      expect(event.returnValue).toContain("unsaved changes");

      const next = vi.fn();
      await leaveGuard()({ path: "/logs" }, { path: "/dashboards/add_panel" }, next);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(false);
      expect(drafts.store.get(DRAFT_KEY).draftId).toBe("draft-old");

      await wrapper.find('[data-test="dashboard-panel-draft-start-new"]').trigger("click");
      await flush();
      const nextAfter = vi.fn();
      await leaveGuard()({ path: "/logs" }, { path: "/dashboards/add_panel" }, nextAfter);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(nextAfter).toHaveBeenCalledWith();
      expect(drafts.store.get(DRAFT_KEY).data.title).toBe("Other panel");
      confirmSpy.mockRestore();
    });

    it("still prompts when the URL names a different draft", async () => {
      seedDraft();
      nav.route = routeWith({ draftId: "gone", tab: "t2" });
      wrapper = await mountEditor();

      expect(wrapper.find('[data-test="dashboard-panel-draft-prompt"]').exists()).toBe(true);
      expect(wrapper.vm.dashboardPanelData.data.title).not.toBe("Draft title");
    });

    it("reopens the draft named in the URL without prompting", async () => {
      seedDraft();
      nav.route = routeWith({ draftId: "draft-old" });
      wrapper = await mountEditor();

      expect(wrapper.find('[data-test="dashboard-panel-draft-prompt"]').exists()).toBe(false);
      expect(wrapper.vm.dashboardPanelData.data.title).toBe("Draft title");

      await wrapper.vm.flushDraft();
      expect(drafts.store.get(DRAFT_KEY).draftId).toBe("draft-old");
    });

    it("a successful save deletes the draft", async () => {
      seedDraft();
      nav.route = routeWith({ draftId: "draft-old" });
      wrapper = await mountEditor();

      await wrapper.vm.form.handleSubmit();
      await flush();

      expect(addPanel).toHaveBeenCalled();
      expect(drafts.store.size).toBe(0);
    });
  });
});
