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
import { addPanel, getDashboard, getPanel, updatePanel } from "@/utils/commons";
import analytics from "@/services/product_analytics";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import {
  PANEL_DRAFT_VERSION,
  panelDraftKey,
  readPanelDraft,
  writePanelDraft,
} from "@/composables/dashboard/usePanelDraft";
import AddPanel from "./AddPanel.vue";

const conflict = vi.hoisted(() => ({ active: false, open: null as any }));

vi.mock("@/composables/dashboard/useDashboardSaveConflict", () => ({
  useDashboardSaveConflict: () => ({
    isConflict: () => conflict.active,
    openConflict: (args: any) => {
      conflict.open = args;
    },
  }),
}));

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

const toasts = vi.hoisted(() => ({
  positive: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: toasts.error,
    showPositiveNotification: toasts.positive,
    showInfoNotification: toasts.info,
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
vi.mock("@/lib/vue-shortcut-manager", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useShortcuts: vi.fn() };
});

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

const newScope = { userEmail: "me@x.io", org: "org1", dashboardId: "dash1" };
const editScope = { ...newScope, panelId: "p1" };

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

let store: any;

const mountEditor = async ({ settle = true } = {}) => {
  store = createStore({
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
  if (settle) await flush();
  return wrapper;
};

const userEdits = async (wrapper: any, title: string) => {
  window.dispatchEvent(new Event("pointerdown"));
  wrapper.vm.dashboardPanelData.data.title = title;
  await nextTick();
};

const leaveGuard = () => vi.mocked(onBeforeRouteLeave).mock.calls.at(-1)![0] as any;

const leave = (path = "/dashboards/view") => {
  const next = vi.fn();
  const done = leaveGuard()({ path }, { path: "/dashboards/add_panel" }, next);
  return { next, done };
};

const seedDraft = (scope: any, overrides: Record<string, unknown> = {}) =>
  writePanelDraft(scope, {
    tabId: "t2",
    data: { ...serverPanel("Draft title"), id: scope.panelId ?? "" },
    layout: { currentQueryIndex: 0, vrlFunctionToggle: false },
    sessionVariables: [],
    variablesWithCurrentPanel: [],
    ...overrides,
  } as any);

// A plain Event's returnValue is a legacy boolean, so give the handler a writable slot to fill.
const unloadEvent = () => {
  const event: any = new Event("beforeunload");
  Object.defineProperty(event, "returnValue", { value: undefined, writable: true });
  return event;
};

const q = (selector: string) => document.querySelector(selector) as HTMLElement | null;
const restoreDialog = () => q('[data-test="dashboard-panel-draft-restore-dialog"]');
const leaveDialog = () => q('[data-test="dashboard-panel-leave-dialog"]');
const restoreButton = (name: "continue" | "fresh") =>
  q(
    name === "continue"
      ? '[data-test="dashboard-panel-draft-continue"]'
      : '[data-test="dashboard-panel-draft-restore-dialog"] [data-test="o-dialog-secondary-btn"]',
  )!;
const leaveButton = (name: "save" | "keep" | "discard") =>
  q(
    {
      save: '[data-test="dashboard-panel-leave-save"]',
      keep: '[data-test="dashboard-panel-leave-dialog"] [data-test="o-dialog-secondary-btn"]',
      discard: '[data-test="dashboard-panel-leave-dialog"] [data-test="o-dialog-neutral-btn"]',
    }[name],
  )!;
const pressEscape = async () => {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await flush();
};

const routeWith = (query: Record<string, string>) =>
  reactive({
    path: "/dashboards/add_panel",
    query: { dashboard: "dash1", folder: "default", tab: "t1", ...query } as any,
    params: {},
  });

const dashboard = (variables: any[] = []) => ({
  title: "Dash",
  variables: { list: variables },
  tabs: [
    { tabId: "t1", panels: [serverPanel()] },
    { tabId: "t2", panels: [] },
  ],
});

describe("AddPanel drafts and Save and keep editing", () => {
  let wrapper: any;

  beforeEach(() => {
    localStorage.clear();
    conflict.active = false;
    conflict.open = null;
    nav.route = routeWith({});
    nav.push = vi.fn(async () => undefined);
    nav.replace = vi.fn(async ({ query }: any) => {
      nav.route.query = query;
    });
    vi.mocked(getDashboard).mockImplementation(async () => dashboard() as any);
    vi.mocked(getPanel).mockResolvedValue(serverPanel() as any);
    vi.mocked(addPanel).mockResolvedValue(undefined as any);
    vi.mocked(updatePanel).mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  describe("restore dialog", () => {
    it("does not ask when there is no draft", async () => {
      wrapper = await mountEditor();

      expect(restoreDialog()).toBeNull();
      expect(getDashboard).toHaveBeenCalled();
    });

    it("blocks the opening sequence until the user chooses", async () => {
      seedDraft(newScope);
      wrapper = await mountEditor();

      expect(restoreDialog()).not.toBeNull();
      expect(restoreDialog()!.textContent).toContain("You have unsaved changes from");
      expect(getDashboard).not.toHaveBeenCalled();
    });

    it("Continue applies the draft and counts it as unsaved straight away", async () => {
      seedDraft(newScope);
      wrapper = await mountEditor();

      restoreButton("continue").click();
      await flush();

      expect(restoreDialog()).toBeNull();
      expect(wrapper.vm.dashboardPanelData.data.title).toBe("Draft title");
      expect(wrapper.vm.form.state.values.title).toBe("Draft title");
      expect(getDashboard).toHaveBeenCalled();
      // The new-panel draft lands in the tab of the URL, not the one it was written in.
      expect(nav.route.query.tab).toBe("t1");
      const { next, done } = leave();
      await flush();
      expect(leaveDialog()).not.toBeNull();
      wrapper.vm.onLeaveChoice("stay");
      await done;
      expect(next).toHaveBeenCalledWith(false);
    });

    it("Continue adds back free session variables and reports the skipped ones once", async () => {
      vi.mocked(getDashboard).mockImplementation(
        async () => dashboard([{ name: "taken", type: "constant" }]) as any,
      );
      seedDraft(newScope, {
        sessionVariables: [
          { name: "taken", type: "constant", value: "draft" },
          { name: "fresh_var", type: "constant", value: "1", panels: ["current_panel"] },
        ],
        variablesWithCurrentPanel: ["taken", "fresh_var"],
      });
      wrapper = await mountEditor();

      restoreButton("continue").click();
      await flush();

      const names = wrapper.vm.currentDashboardData.data.variables.list.map((v: any) => v.name);
      expect(names).toEqual(["taken", "fresh_var"]);
      expect(toasts.info).toHaveBeenCalledTimes(1);
      expect(toasts.info.mock.calls[0][0]).toContain("1 variable");
    });

    it("Start fresh deletes the draft and keeps the blank panel", async () => {
      seedDraft(newScope);
      wrapper = await mountEditor();

      restoreButton("fresh").click();
      await flush();

      expect(readPanelDraft(newScope)).toBeNull();
      expect(wrapper.vm.dashboardPanelData.data.title).toBe("");
      expect(getDashboard).toHaveBeenCalled();
    });

    it("Escape starts fresh but keeps the draft until the first edit replaces it", async () => {
      seedDraft(newScope);
      wrapper = await mountEditor();

      await pressEscape();
      expect(restoreDialog()?.isConnected ?? false).toBe(false);
      expect(wrapper.vm.dashboardPanelData.data.title).toBe("");

      window.dispatchEvent(new Event("pointerdown"));
      window.dispatchEvent(new Event("pagehide"));
      expect(readPanelDraft(newScope)?.data.title).toBe("Draft title");

      await userEdits(wrapper, "New work");
      window.dispatchEvent(new Event("pagehide"));
      expect(readPanelDraft(newScope)?.data.title).toBe("New work");
    });

    it("draft=resume continues without the dialog and drops the flag from the URL", async () => {
      seedDraft(editScope);
      nav.route = routeWith({ panelId: "p1", draft: "resume" });
      wrapper = await mountEditor();

      expect(restoreDialog()).toBeNull();
      expect(wrapper.vm.dashboardPanelData.data.title).toBe("Draft title");
      expect(nav.route.query.draft).toBeUndefined();
      expect(nav.route.query.panelId).toBe("p1");
    });

    it("warns in the same dialog when the panel changed on the server after the draft", async () => {
      seedDraft(editScope, { basePanel: serverPanel("Older server title") });
      nav.route = routeWith({ panelId: "p1" });
      wrapper = await mountEditor();

      expect(
        document.querySelectorAll('[data-test="dashboard-panel-draft-restore-dialog"]'),
      ).toHaveLength(1);
      expect(q('[data-test="dashboard-panel-draft-changed-on-server"]')).not.toBeNull();
    });

    it("does not warn when the server panel is the one the draft started from", async () => {
      seedDraft(editScope, { basePanel: serverPanel() });
      nav.route = routeWith({ panelId: "p1" });
      wrapper = await mountEditor();

      expect(restoreDialog()).not.toBeNull();
      expect(q('[data-test="dashboard-panel-draft-changed-on-server"]')).toBeNull();
    });

    it("discards the draft of a panel that no longer exists, with a toast", async () => {
      seedDraft(editScope);
      vi.mocked(getPanel).mockResolvedValue(undefined as any);
      nav.route = routeWith({ panelId: "p1" });
      wrapper = await mountEditor();

      expect(restoreDialog()).toBeNull();
      expect(readPanelDraft(editScope)).toBeNull();
      expect(toasts.info).toHaveBeenCalledTimes(1);
    });
  });

  describe("autosave", () => {
    it("writes the draft with its layout and base panel, and deletes it once undone", async () => {
      nav.route = routeWith({ panelId: "p1" });
      wrapper = await mountEditor();

      await userEdits(wrapper, "Edited");
      window.dispatchEvent(new Event("pagehide"));
      const draft = readPanelDraft(editScope)!;
      expect(draft.v).toBe(PANEL_DRAFT_VERSION);
      expect(draft.data.title).toBe("Edited");
      expect(draft.basePanel.title).toBe("Server title");
      expect(draft.layout).toEqual({ currentQueryIndex: 0, vrlFunctionToggle: false });
      expect(draft).not.toHaveProperty("meta");

      wrapper.vm.dashboardPanelData.data.title = "Server title";
      await nextTick();
      window.dispatchEvent(new Event("pagehide"));
      expect(readPanelDraft(editScope)).toBeNull();
    });

    it("writes silently on beforeunload and still asks the browser to confirm", async () => {
      wrapper = await mountEditor();
      await userEdits(wrapper, "Unsaved");

      const event = unloadEvent();
      window.dispatchEvent(event);

      expect(readPanelDraft(newScope)?.data.title).toBe("Unsaved");
      expect(event.returnValue).toBeTruthy();
    });

    it("writes the draft under the old org before an org switch", async () => {
      wrapper = await mountEditor();
      await userEdits(wrapper, "Org one work");

      store.state.selectedOrganization = { identifier: "org2" };

      expect(readPanelDraft(newScope)?.data.title).toBe("Org one work");
    });
  });

  describe("leave dialog", () => {
    it("leaves without asking when nothing changed", async () => {
      wrapper = await mountEditor();

      const { next, done } = leave();
      await done;

      expect(leaveDialog()).toBeNull();
      expect(next).toHaveBeenCalledWith();
    });

    it("Escape keeps the user in the editor", async () => {
      wrapper = await mountEditor();
      await userEdits(wrapper, "Edited");

      const { next, done } = leave();
      await flush();
      expect(leaveDialog()).not.toBeNull();
      await pressEscape();
      await done;

      expect(next).toHaveBeenCalledWith(false);
    });

    it("Keep draft stores the edits, drops session variables and leaves", async () => {
      wrapper = await mountEditor();
      await userEdits(wrapper, "Keep me");
      wrapper.vm.currentDashboardData.data.variables.list.push({ name: "session_var" });
      await wrapper.vm.handleSaveVariable({ variableData: { name: "session_var2" } });

      const { next, done } = leave();
      await flush();
      leaveButton("keep").click();
      await done;

      expect(next).toHaveBeenCalledWith();
      const draft = readPanelDraft(newScope)!;
      expect(draft.data.title).toBe("Keep me");
      expect(draft.sessionVariables.map((v: any) => v.name)).toEqual(["session_var2"]);
      const names = wrapper.vm.currentDashboardData.data.variables.list.map((v: any) => v.name);
      expect(names).not.toContain("session_var2");
    });

    it("Discard deletes the draft and leaves", async () => {
      wrapper = await mountEditor();
      await userEdits(wrapper, "Throw away");
      window.dispatchEvent(new Event("pagehide"));
      expect(readPanelDraft(newScope)).not.toBeNull();

      const { next, done } = leave();
      await flush();
      leaveButton("discard").click();
      await done;

      expect(next).toHaveBeenCalledWith();
      expect(readPanelDraft(newScope)).toBeNull();
    });

    it("Save saves without opening the dashboard, deletes the draft and continues the navigation", async () => {
      nav.route = routeWith({ panelId: "p1" });
      wrapper = await mountEditor();
      await userEdits(wrapper, "Saved on leave");
      window.dispatchEvent(new Event("pagehide"));

      const { next, done } = leave("/logs");
      await flush();
      leaveButton("save").click();
      await done;

      expect(updatePanel).toHaveBeenCalledTimes(1);
      expect(nav.push).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
      expect(readPanelDraft(editScope)).toBeNull();
    });

    it("Save stays in the editor when validation fails", async () => {
      wrapper = await mountEditor();
      await userEdits(wrapper, "  ");

      const { next, done } = leave();
      await flush();
      leaveButton("save").click();
      await done;

      expect(addPanel).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(false);
    });

    it("Save hands over to the conflict dialog, whose resolution lands on the dashboard", async () => {
      nav.route = routeWith({ panelId: "p1" });
      vi.mocked(updatePanel).mockRejectedValue({ response: { status: 409 } });
      conflict.active = true;
      wrapper = await mountEditor();
      await userEdits(wrapper, "Conflicting");

      const { next, done } = leave("/logs");
      await flush();
      leaveButton("save").click();
      await done;
      expect(next).toHaveBeenCalledWith(false);
      expect(conflict.open).not.toBeNull();

      await conflict.open.onResolved("overwritten");
      expect(nav.push).toHaveBeenCalledWith(expect.objectContaining({ path: "/dashboards/view" }));
      expect(readPanelDraft(editScope)).toBeNull();
    });

    it("a conflict resolved with Reload deletes the draft", async () => {
      nav.route = routeWith({ panelId: "p1" });
      vi.mocked(updatePanel).mockRejectedValue({ response: { status: 409 } });
      conflict.active = true;
      wrapper = await mountEditor();
      await userEdits(wrapper, "Conflicting");
      window.dispatchEvent(new Event("pagehide"));

      await wrapper.vm.submitPanel("view");
      await conflict.open.onResolved("reloaded");

      expect(readPanelDraft(editScope)).toBeNull();
      expect(nav.push).toHaveBeenCalledWith(expect.objectContaining({ path: "/dashboards/view" }));
    });
  });

  describe("Save and keep editing", () => {
    it("edit mode: saves, stays, resets the snapshot and deletes the draft", async () => {
      nav.route = routeWith({ panelId: "p1" });
      wrapper = await mountEditor();
      await userEdits(wrapper, "Stay edit");
      window.dispatchEvent(new Event("pagehide"));
      vi.mocked(getDashboard).mockClear();

      await wrapper.vm.saveAndStay();
      await flush();

      expect(updatePanel).toHaveBeenCalledTimes(1);
      expect(nav.push).not.toHaveBeenCalled();
      expect(getDashboard).toHaveBeenCalled();
      expect(toasts.positive).toHaveBeenCalledTimes(1);
      expect(readPanelDraft(editScope)).toBeNull();
      expect(analytics.track).toHaveBeenCalledWith("dashboard_panel_saved", {
        chart_type: "line",
        is_new: false,
        stay: true,
      });
      const { next, done } = leave();
      await done;
      expect(next).toHaveBeenCalledWith();
    });

    it("new panel: adds it, switches the URL to its panelId and keeps editing", async () => {
      wrapper = await mountEditor();
      await userEdits(wrapper, "Brand new");
      window.dispatchEvent(new Event("pagehide"));
      expect(readPanelDraft(newScope)).not.toBeNull();

      await wrapper.vm.saveAndStay();
      await flush();

      expect(addPanel).toHaveBeenCalledTimes(1);
      const panelId = wrapper.vm.dashboardPanelData.data.id;
      expect(panelId).toMatch(/^Panel_ID/);
      expect(nav.replace).toHaveBeenCalledWith({
        query: expect.objectContaining({ panelId }),
      });
      expect(nav.route.query.panelId).toBe(panelId);
      expect(nav.push).not.toHaveBeenCalled();
      expect(wrapper.vm.editMode).toBe(true);
      expect(readPanelDraft(newScope)).toBeNull();

      await userEdits(wrapper, "Edited after save");
      window.dispatchEvent(new Event("pagehide"));
      expect(readPanelDraft({ ...newScope, panelId })?.data.title).toBe("Edited after save");
      expect(readPanelDraft(newScope)).toBeNull();
    });

    it("Ctrl+S saves and stays in the editor", async () => {
      nav.route = routeWith({ panelId: "p1" });
      wrapper = await mountEditor();
      await userEdits(wrapper, "Shortcut save");

      const shortcuts = vi.mocked(useShortcuts).mock.calls.at(-1)![0] as any[];
      await shortcuts.find((s) => s.id === "panelEditorSave").handler();
      await flush();

      expect(updatePanel).toHaveBeenCalledTimes(1);
      expect(nav.push).not.toHaveBeenCalled();
      expect(toasts.positive).toHaveBeenCalledTimes(1);
    });

    it("the header Save still opens the dashboard after saving", async () => {
      nav.route = routeWith({ panelId: "p1" });
      wrapper = await mountEditor();
      await userEdits(wrapper, "Plain save");

      await wrapper.vm.submitPanel("view");
      await flush();

      expect(nav.push).toHaveBeenCalledWith(expect.objectContaining({ path: "/dashboards/view" }));
      expect(analytics.track).toHaveBeenCalledWith("dashboard_panel_saved", {
        chart_type: "line",
        is_new: false,
      });
    });

    it("renders the split Save menu with Save and keep editing", async () => {
      wrapper = await mountEditor();

      expect(wrapper.find('[data-test="dashboard-panel-save"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-panel-save-options-btn"]').exists()).toBe(true);
    });
  });

  it("uses one storage key per user, org, dashboard and panel", () => {
    expect(panelDraftKey(editScope)).toBe("o2_panel_draft:me@x.io:org1:dash1:p1");
  });
});
