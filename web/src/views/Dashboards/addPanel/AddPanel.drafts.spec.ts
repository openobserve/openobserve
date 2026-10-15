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
import AddPanel from "./AddPanel.vue";
import { takeKeptDraftAnnouncement } from "@/composables/dashboard/usePanelDraft";

const drafts = vi.hoisted(() => ({
  store: new Map<string, any>(),
  available: true,
}));

vi.mock("@/composables/dashboard/usePanelDraft", async (importOriginal) => {
  const actual: any = await importOriginal();
  const key = (scope: any, target: any) => actual.panelDraftKey(scope, target);
  return {
    ...actual,
    isPanelDraftStorageAvailable: vi.fn(async () => drafts.available),
    savePanelDraft: vi.fn(async (input: any) => {
      const panelId = input.panelId || null;
      const record = {
        ...JSON.parse(JSON.stringify(input)),
        key: key(input, { panelId, draftId: input.draftId }),
        panelId,
        draftId: input.draftId || null,
        isNew: !panelId,
        updatedAt: Date.now(),
      };
      drafts.store.set(record.key, record);
      return record;
    }),
    getPanelDraft: vi.fn(async (scope: any, target: any) => drafts.store.get(key(scope, target))),
    deletePanelDraft: vi.fn(async (scope: any, target: any) => {
      drafts.store.delete(key(scope, target));
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

const seedDraft = (overrides: Record<string, unknown> = {}) => {
  const record = {
    key: "me@x.io|org1|dash1|p:p1",
    ...scope,
    folder: "default",
    tab: "t1",
    panelId: "p1",
    draftId: null,
    isNew: false,
    base: serverPanel(),
    data: serverPanel("Draft title"),
    variables: [],
    variablesWithCurrentPanel: [],
    updatedAt: Date.now() - 5 * 60_000,
    ...overrides,
  };
  drafts.store.set(record.key, record);
  return record;
};

describe("AddPanel panel drafts", () => {
  let wrapper: any;

  const editRoute = () =>
    reactive({
      path: "/dashboards/add_panel",
      query: { dashboard: "dash1", folder: "default", tab: "t1", panelId: "p1" } as any,
      params: {},
    });

  beforeEach(() => {
    drafts.store.clear();
    drafts.available = true;
    nav.route = editRoute();
    nav.push = vi.fn(async () => undefined);
    nav.replace = vi.fn(async ({ query }: any) => {
      nav.route.query = query;
    });
    vi.mocked(getDashboard).mockResolvedValue({
      title: "Dash",
      tabs: [{ tabId: "t1", panels: [serverPanel()] }],
    } as any);
    vi.mocked(getPanel).mockResolvedValue(serverPanel() as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("offers to restore a saved draft and restores it on click", async () => {
    seedDraft();
    wrapper = await mountEditor();

    const banner = wrapper.find('[data-test="dashboard-panel-draft-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("Unsaved draft from");
    expect(banner.text()).not.toContain("changed by someone else");

    await wrapper.find('[data-test="dashboard-panel-draft-restore"]').trigger("click");
    await flush();

    expect(wrapper.vm.dashboardPanelData.data.title).toBe("Draft title");
    expect(wrapper.find('[data-test="dashboard-panel-draft-banner"]').exists()).toBe(false);
  });

  it("warns when the panel changed on the server since the draft", async () => {
    seedDraft({ base: serverPanel("Older title") });
    wrapper = await mountEditor();

    expect(wrapper.find('[data-test="dashboard-panel-draft-banner"]').text()).toContain(
      "This panel was changed by someone else since your draft.",
    );
  });

  it("offers save-as-new when the panel no longer exists", async () => {
    seedDraft();
    vi.mocked(getDashboard).mockResolvedValue({
      title: "Dash",
      tabs: [{ tabId: "t1", panels: [] }],
    } as any);
    vi.mocked(getPanel).mockResolvedValue(undefined as any);
    wrapper = await mountEditor();

    const banner = wrapper.find('[data-test="dashboard-panel-draft-banner-deleted"]');
    expect(banner.text()).toContain("This panel no longer exists");
    expect(banner.text()).toMatch(/started this draft at \d\d:\d\d \(5 minutes ago\)\./);
    expect(banner.text()).not.toContain("))");

    await wrapper.find('[data-test="dashboard-panel-draft-save-as-new"]').trigger("click");
    await flush();

    expect(drafts.store.has("me@x.io|org1|dash1|p:p1")).toBe(false);
    expect(nav.route.query.panelId).toBeUndefined();
    expect(nav.route.query.draftId).toBe("draft-new");
    expect(addPanel).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addPanel).mock.calls[0][2].title).toBe("Draft title");
  });

  it("discarding the stored draft deletes it and keeps the server version", async () => {
    seedDraft();
    wrapper = await mountEditor();

    await wrapper.find('[data-test="dashboard-panel-draft-discard"]').trigger("click");
    await flush();

    expect(drafts.store.size).toBe(0);
    expect(wrapper.vm.dashboardPanelData.data.title).toBe("Server title");
  });

  it("saves a draft instead of prompting when the route leaves with edits", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    wrapper = await mountEditor();
    await userEdits(wrapper, "Edited title");

    const next = vi.fn();
    await leaveGuard()({ path: "/logs" }, { path: "/dashboards/add_panel" }, next);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
    const saved = drafts.store.get("me@x.io|org1|dash1|p:p1");
    expect(saved.data.title).toBe("Edited title");
    expect(saved.base.title).toBe("Server title");
    confirmSpy.mockRestore();
  });

  it("falls back to the confirm prompt when storage is unavailable", async () => {
    drafts.available = false;
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

  it("Discard with edits opens the leave dialog; Discard changes deletes the draft", async () => {
    wrapper = await mountEditor();
    await userEdits(wrapper, "Edited title");
    await wrapper.vm.flushDraft();
    expect(drafts.store.size).toBe(1);

    await wrapper.find('[data-test="dashboard-panel-discard"]').trigger("click");
    await flush();
    const dialog = document.querySelector('[data-test="dashboard-panel-leave-dialog"]');
    expect(dialog?.textContent).toContain("Leave panel editor?");

    (dialog!.querySelector('[data-test="o-dialog-secondary-btn"]') as HTMLButtonElement).click();
    await flush();

    expect(drafts.store.size).toBe(0);
    expect(nav.push).toHaveBeenCalledWith(expect.objectContaining({ path: "/dashboards/view" }));
  });

  it("Keep as draft stores the edits and leaves", async () => {
    wrapper = await mountEditor();
    await userEdits(wrapper, "Keep me");

    await wrapper.find('[data-test="dashboard-panel-discard"]').trigger("click");
    await flush();
    (
      document.querySelector(
        '[data-test="dashboard-panel-leave-dialog"] [data-test="o-dialog-primary-btn"]',
      ) as HTMLButtonElement
    ).click();
    await flush();

    expect(drafts.store.get("me@x.io|org1|dash1|p:p1").data.title).toBe("Keep me");
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it("Discard without edits leaves straight away", async () => {
    wrapper = await mountEditor();

    await wrapper.find('[data-test="dashboard-panel-discard"]').trigger("click");
    await flush();

    expect(document.querySelector('[data-test="dashboard-panel-leave-dialog"]')).toBeNull();
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it("a successful save deletes the draft", async () => {
    wrapper = await mountEditor();
    await userEdits(wrapper, "Saved title");
    await wrapper.vm.flushDraft();
    expect(drafts.store.size).toBe(1);

    await wrapper.vm.form.handleSubmit();
    await flush();

    expect(updatePanel).toHaveBeenCalled();
    expect(drafts.store.size).toBe(0);
  });

  it("mints a draftId into the URL for a new panel", async () => {
    nav.route = reactive({
      path: "/dashboards/add_panel",
      query: { dashboard: "dash1", folder: "default", tab: "t1" },
      params: {},
    });
    wrapper = await mountEditor();
    await userEdits(wrapper, "Brand new");
    await wrapper.vm.flushDraft();

    expect(nav.route.query.draftId).toBe("draft-new");
    const saved = drafts.store.get("me@x.io|org1|dash1|d:draft-new");
    expect(saved.isNew).toBe(true);
    expect(saved.data.title).toBe("Brand new");
  });

  it("keeps the edits when an org switch unmounts the editor", async () => {
    wrapper = await mountEditor();
    await userEdits(wrapper, "Before org switch");
    nav.route.query = { org_identifier: "org2" };

    wrapper.unmount();
    wrapper = null;
    await flush();

    const saved = drafts.store.get("me@x.io|org1|dash1|p:p1");
    expect(saved.data.title).toBe("Before org switch");
    expect(saved.org).toBe("org1");
  });
  it("applies the draft directly when opened from the drafts tray, and can revert", async () => {
    seedDraft();
    nav.route.query = { ...nav.route.query, restoreDraft: "1" };
    wrapper = await mountEditor();

    expect(wrapper.vm.dashboardPanelData.data.title).toBe("Draft title");
    expect(nav.route.query.restoreDraft).toBeUndefined();
    const banner = wrapper.find('[data-test="dashboard-panel-draft-banner-restored"]');
    expect(banner.text()).toContain("Restored your draft from");
    expect(banner.text()).toContain("5 minutes ago");

    await wrapper.find('[data-test="dashboard-panel-draft-revert"]').trigger("click");
    await flush();

    expect(wrapper.vm.dashboardPanelData.data.title).toBe("Server title");
    expect(drafts.store.size).toBe(0);
    expect(wrapper.find('[data-test="dashboard-panel-draft-banner-restored"]').exists()).toBe(
      false,
    );
  });

  it("still asks before restoring a stale draft opened from the tray", async () => {
    seedDraft({ base: serverPanel("Older title") });
    nav.route.query = { ...nav.route.query, restoreDraft: "1" };
    wrapper = await mountEditor();

    expect(wrapper.vm.dashboardPanelData.data.title).toBe("Server title");
    expect(wrapper.find('[data-test="dashboard-panel-draft-restore"]').exists()).toBe(true);
  });

  it("keeps another session's draft when this session saves without restoring it", async () => {
    seedDraft();
    wrapper = await mountEditor();
    await userEdits(wrapper, "Saved in tab two");

    await wrapper.vm.form.handleSubmit();
    await flush();

    expect(updatePanel).toHaveBeenCalled();
    expect(drafts.store.get("me@x.io|org1|dash1|p:p1").data.title).toBe("Draft title");
  });

  it("keeps edits made beside an unresolved draft as a separate draft", async () => {
    seedDraft();
    wrapper = await mountEditor();
    await userEdits(wrapper, "Second session");
    await wrapper.vm.flushDraft();

    expect(drafts.store.get("me@x.io|org1|dash1|p:p1").data.title).toBe("Draft title");
    const fork = drafts.store.get("me@x.io|org1|dash1|d:draft-new");
    expect(fork.panelId).toBe("p1");
    expect(fork.data.title).toBe("Second session");
    expect(nav.route.query.draftId).toBe("draft-new");

    await wrapper.find('[data-test="dashboard-panel-draft-restore"]').trigger("click");
    await flush();
    expect(drafts.store.has("me@x.io|org1|dash1|d:draft-new")).toBe(false);
    expect(wrapper.vm.dashboardPanelData.data.title).toBe("Draft title");
  });

  it("hands one kept-draft announcement to the dashboard, whichever way the editor is left", async () => {
    sessionStorage.clear();
    wrapper = await mountEditor();
    await userEdits(wrapper, "Kept");

    await leaveGuard()({ path: "/logs" }, { path: "/dashboards/add_panel" }, vi.fn());
    expect(takeKeptDraftAnnouncement("other-dash")).toBe(false);
    expect(takeKeptDraftAnnouncement("dash1")).toBe(true);
    expect(takeKeptDraftAnnouncement("dash1")).toBe(false);
    wrapper.unmount();

    // Continuing the same draft and leaving again (here by unmount, as an org switch does) does not repeat it.
    nav.route.query = { ...nav.route.query, restoreDraft: "1" };
    wrapper = await mountEditor();
    await userEdits(wrapper, "Kept again");
    wrapper.unmount();
    wrapper = null;
    await flush();
    expect(drafts.store.get("me@x.io|org1|dash1|p:p1").data.title).toBe("Kept again");
    expect(takeKeptDraftAnnouncement("dash1")).toBe(false);
  });

  it("tells the user an autosaved draft already exists when asking to leave", async () => {
    wrapper = await mountEditor();
    await userEdits(wrapper, "Autosaved");
    await wrapper.vm.flushDraft();

    await wrapper.find('[data-test="dashboard-panel-discard"]').trigger("click");
    await flush();
    const text = document.querySelector('[data-test="dashboard-panel-leave-dialog"]')?.textContent;
    expect(text).toContain("They're saved as a draft on this browser.");
    expect(text).toContain("Discard changes deletes them permanently.");
  });
});
