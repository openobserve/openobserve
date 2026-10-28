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
import { defineComponent, h, ref } from "vue";
import { createStore } from "vuex";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import {
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { addVariable, editTab, updateDashboard } from "@/utils/commons";
import { fillField } from "@/test/unit/helpers/fillField";
import { dashboardSettingsBase } from "@/components/dashboards/settings/dashboardSettingsDraft";
import type { DashboardSettingsDraft } from "@/components/dashboards/settings/dashboardSettingsDraft";
import DashboardSettings from "./DashboardSettings.vue";

interface FixtureTab {
  tabId: string;
  name: string;
  panels: unknown[];
}

interface FixtureDashboard {
  dashboardId: string;
  title: string;
  description: string;
  variables: { list: Record<string, unknown>[]; showDynamicFilters: boolean };
  tabs: FixtureTab[];
  defaultDatetimeDuration: { type: string; relativeTimePeriod: string };
}

const db = vi.hoisted(() => ({
  server: null as unknown as FixtureDashboard,
  gone: false,
}));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

vi.mock("@/utils/commons", () => ({
  getDashboard: vi.fn(async () => db.server),
  getLoadedDashboardVersion: vi.fn(() => (db.gone ? null : { snapshot: clone(db.server) })),
  updateDashboard: vi.fn(async (_s: unknown, _o: unknown, _id: unknown, data: FixtureDashboard) => {
    db.server = clone(data);
  }),
  addVariable: vi.fn(async (_t: unknown, _s: unknown, _id: unknown, variable: object) => {
    db.server = clone(db.server);
    db.server.variables.list.push(clone(variable) as Record<string, unknown>);
  }),
  updateVariable: vi.fn(async () => undefined),
  deleteVariable: vi.fn(async () => undefined),
  editTab: vi.fn(async (_s: unknown, _d: unknown, _f: unknown, tabId: string, tab: FixtureTab) => {
    db.server = clone(db.server);
    db.server.tabs = db.server.tabs.map((t) => (t.tabId === tabId ? { ...t, name: tab.name } : t));
  }),
  deleteTab: vi.fn(async () => undefined),
  addTab: vi.fn(async () => undefined),
}));
vi.mock("@/composables/dashboard/useDashboardSaveConflict", () => ({
  useDashboardSaveConflict: () => ({ isConflict: () => false, openConflict: vi.fn() }),
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn(async () => ({ list: [] })),
    getStream: vi.fn(async () => ({ schema: [] })),
  }),
}));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/components/dashboards/settings/AnnotationSettings.vue", () => ({
  default: { name: "AnnotationSettings", template: "<div />" },
}));

const scope: EditorDraftScope = {
  kind: "dashboard_settings",
  org: "test-org",
  entityId: "dash1",
  userEmail: "me@x.io",
};

const makeDashboard = (): FixtureDashboard => ({
  dashboardId: "dash1",
  title: "Ops overview",
  description: "",
  variables: {
    list: [{ name: "region", type: "constant", value: "eu", tabs: [], panels: [] }],
    showDynamicFilters: false,
  },
  tabs: [
    { tabId: "t1", name: "Overview", panels: [] },
    { tabId: "t2", name: "Errors", panels: [] },
  ],
  defaultDatetimeDuration: { type: "relative", relativeTimePeriod: "15m" },
});

const generalDraft = (title: string): DashboardSettingsDraft => ({
  tab: "generalSettings",
  general: {
    values: {
      name: title,
      description: "",
      showDynamicFilters: false,
      defaultRefreshInterval: 0,
    },
    dateTime: { valueType: "relative", relativeTimePeriod: "15m" },
  },
  variable: null,
  tabRename: null,
});

const store = createStore({
  state: {
    theme: "light",
    printMode: false,
    savedViewFlag: false,
    timezone: "UTC",
    selectedOrganization: { identifier: "test-org" },
    userInfo: { email: "me@x.io" },
    zoConfig: { min_auto_refresh_interval: 5 },
    organizationData: { allDashboardData: {} },
  },
});

const open = ref(true);
let router: Router;
let wrapper: VueWrapper | null = null;

const Host = defineComponent({
  setup() {
    return () =>
      h(DashboardSettings, {
        open: open.value,
        "onUpdate:open": (value: boolean) => (open.value = value),
        onClose: () => (open.value = false),
      });
  },
});

const mountSettings = async (realPicker = false) => {
  open.value = true;
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/dashboards/view", component: Host },
      { path: "/logs", component: { render: () => h("div") } },
    ],
  });
  await router.push("/dashboards/view?dashboard=dash1&folder=default");
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [router, store],
        stubs: {
          ...(realPicker
            ? {}
            : { DateTimePickerDashboard: { props: ["modelValue"], template: "<div />" } }),
          AutoRefreshInterval: { template: "<div />" },
          VariablesDependenciesGraph: true,
        },
      },
    },
  );
  await settle();
};

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const reopen = async () => {
  open.value = false;
  await settle();
  open.value = true;
  await settle();
};

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const inDialog = (dialog: string, id: string) =>
  document.body.querySelector<HTMLElement>(`[data-test="${dialog}"] [data-test="${id}"]`);
const fieldValue = (id: string) =>
  (byTest(id)?.querySelector("input, textarea") as HTMLInputElement | null)?.value ??
  (byTest(id) as HTMLInputElement | null)?.value;

const click = async (el: HTMLElement | null, what = "element") => {
  if (!el) throw new Error(`${what} not found`);
  el.click();
  await settle();
};

const closeDrawer = () => click(inDialog("dashboard-settings-drawer", "o-drawer-close-btn"));
const leave = (id: string) => click(inDialog("editor-draft-leave-dialog", id));
const restore = (id: string) => click(inDialog("editor-draft-restore-dialog", id));
// Reka tab triggers activate on mousedown.
const openTab = async (id: string) => {
  const tab = byTest(id);
  if (!tab) throw new Error(`${id} not found`);
  tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  await settle();
};

const draftData = () => readEditorDraft<DashboardSettingsDraft>(scope)?.data;

describe("DashboardSettings drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    db.server = makeDashboard();
    db.gone = false;
    vi.mocked(updateDashboard).mockClear();
    vi.mocked(addVariable).mockClear();
    vi.mocked(editTab).mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("drafts a general change typed with no key or pointer event and keeps it across tabs", async () => {
    await mountSettings();
    expect(fieldValue("dashboard-general-setting-name")).toBe("Ops overview");

    await fillField("dashboard-general-setting-name", "Ops night shift");
    window.dispatchEvent(new Event("pagehide"));
    expect(draftData()).toMatchObject({
      tab: "generalSettings",
      general: { values: { name: "Ops night shift" } },
      variable: null,
      tabRename: null,
    });
    expect(readEditorDraft(scope)?.baseHash).toBe(
      hashDraftValue(dashboardSettingsBase(undefined, "dash1")),
    );

    await openTab("dashboard-settings-tab-tab");
    await openTab("dashboard-settings-general-tab");
    expect(fieldValue("dashboard-general-setting-name")).toBe("Ops night shift");
  });

  it("keeps a General title edit across tab switches and through Keep and Continue, with the real time picker", async () => {
    await mountSettings(true);
    expect(byTest("dashboard-general-setting-datetime-picker")).not.toBeNull();
    await fillField("dashboard-general-setting-name", "Ops night shift");

    await openTab("dashboard-settings-variable-tab");
    await openTab("dashboard-settings-general-tab");
    expect(fieldValue("dashboard-general-setting-name")).toBe("Ops night shift");

    await closeDrawer();
    await leave("o-dialog-secondary-btn");
    expect(draftData()?.general?.values.name).toBe("Ops night shift");
    await reopen();
    await click(byTest("editor-draft-continue"));
    expect(fieldValue("dashboard-general-setting-name")).toBe("Ops night shift");
    await openTab("dashboard-settings-variable-tab");
    await openTab("dashboard-settings-general-tab");
    expect(fieldValue("dashboard-general-setting-name")).toBe("Ops night shift");
  });

  it("guards the drawer close: Discard drops the draft and closes", async () => {
    await mountSettings();
    await fillField("dashboard-general-setting-name", "Changed");

    await closeDrawer();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    expect(open.value).toBe(true);

    await leave("o-dialog-neutral-btn");
    expect(open.value).toBe(false);
    expect(readEditorDraft(scope)).toBeNull();
    expect(updateDashboard).not.toHaveBeenCalled();
  });

  it("guards the General Cancel button and closes without asking once clean", async () => {
    await mountSettings();
    await click(byTest("dashboard-general-setting-cancel-btn"));
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(open.value).toBe(false);

    await reopen();
    await fillField("dashboard-general-setting-name", "Changed");
    await click(byTest("dashboard-general-setting-cancel-btn"));
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    // Escape on the leave dialog stays.
    await leave("o-dialog-close-btn");
    expect(open.value).toBe(true);
    expect(fieldValue("dashboard-general-setting-name")).toBe("Changed");
  });

  it("Keep draft stores it, closes, and the next open offers it: Continue restores it", async () => {
    await mountSettings();
    await fillField("dashboard-general-setting-name", "Kept title");
    await closeDrawer();
    await leave("o-dialog-secondary-btn");
    expect(open.value).toBe(false);
    expect(draftData()?.general?.values.name).toBe("Kept title");

    open.value = true;
    await settle();
    expect(byTest("editor-draft-restore-dialog")?.textContent).toContain(
      "unsaved changes to this dashboard settings",
    );
    expect(byTest("editor-draft-changed-on-server")).toBeNull();
    await click(byTest("editor-draft-continue"));
    expect(fieldValue("dashboard-general-setting-name")).toBe("Kept title");

    await closeDrawer();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
  });

  it("Start fresh deletes the draft and shows the saved settings", async () => {
    writeEditorDraft(scope, { data: generalDraft("Draft title") });
    await mountSettings();
    await restore("o-dialog-secondary-btn");
    expect(readEditorDraft(scope)).toBeNull();
    expect(fieldValue("dashboard-general-setting-name")).toBe("Ops overview");
  });

  it("Escape keeps the draft and shows the saved settings", async () => {
    writeEditorDraft(scope, { data: generalDraft("Draft title") });
    await mountSettings();
    await restore("o-dialog-close-btn");
    expect(readEditorDraft(scope)?.data).toMatchObject({
      general: { values: { name: "Draft title" } },
    });
    expect(fieldValue("dashboard-general-setting-name")).toBe("Ops overview");
  });

  it("warns when the settings changed on the server since the draft", async () => {
    writeEditorDraft(scope, {
      data: generalDraft("Draft title"),
      baseHash: hashDraftValue(dashboardSettingsBase(undefined, "dash1")),
    });
    db.server.title = "Renamed by a teammate";
    await mountSettings();
    expect(byTest("editor-draft-changed-on-server")).not.toBeNull();
  });

  it("drops the draft of a deleted dashboard with an info toast", async () => {
    writeEditorDraft(scope, { data: generalDraft("Draft title") });
    db.gone = true;
    await mountSettings();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(readEditorDraft(scope)).toBeNull();
  });

  it("leave Save saves the settings without navigating, then closes", async () => {
    await mountSettings();
    await fillField("dashboard-general-setting-name", "Saved from the dialog");
    await closeDrawer();
    await leave("editor-draft-leave-save");

    expect(updateDashboard).toHaveBeenCalledTimes(1);
    expect(db.server.title).toBe("Saved from the dialog");
    expect(open.value).toBe(false);
    expect(router.currentRoute.value.path).toBe("/dashboards/view");
    expect(readEditorDraft(scope)).toBeNull();
  });

  it("leave Save with an invalid form stays and shows the field error", async () => {
    await mountSettings();
    await fillField("dashboard-general-setting-name", " ");
    await closeDrawer();
    await leave("editor-draft-leave-save");

    expect(updateDashboard).not.toHaveBeenCalled();
    expect(open.value).toBe(true);
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
  });

  it("a normal Save leaves no draft and closes without asking", async () => {
    await mountSettings();
    await fillField("dashboard-general-setting-name", "Saved normally");
    await click(byTest("dashboard-general-setting-save-btn"));
    expect(db.server.title).toBe("Saved normally");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(scope)).toBeNull();

    await closeDrawer();
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(open.value).toBe(false);
  });

  it("guards a route leave: Stay keeps the route, Keep draft navigates", async () => {
    await mountSettings();
    await fillField("dashboard-general-setting-name", "Route leave");

    const first = router.push("/logs");
    await settle();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    await leave("o-dialog-close-btn");
    await first;
    expect(router.currentRoute.value.path).toBe("/dashboards/view");

    const second = router.push("/logs");
    await settle();
    await leave("o-dialog-secondary-btn");
    await second;
    expect(router.currentRoute.value.path).toBe("/logs");
    expect(draftData()?.general?.values.name).toBe("Route leave");
  });

  it("does not treat a time-range change on the same dashboard as a leave", async () => {
    await mountSettings();
    await fillField("dashboard-general-setting-name", "Still here");
    await router.replace("/dashboards/view?dashboard=dash1&folder=default&period=1h");
    await settle();
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
  });

  it("drafts a new variable and reopens its form on Continue", async () => {
    await mountSettings();
    await openTab("dashboard-settings-variable-tab");
    await click(byTest("dashboard-add-variable-btn"));
    await fillField("dashboard-variable-name", "env");
    window.dispatchEvent(new Event("pagehide"));
    expect(draftData()).toMatchObject({
      tab: "variableSettings",
      variable: { variableName: null, values: { name: "env" } },
    });

    await closeDrawer();
    await leave("o-dialog-secondary-btn");
    await reopen();
    await click(byTest("editor-draft-continue"));

    expect(byTest("dashboard-variable-name")).not.toBeNull();
    expect(fieldValue("dashboard-variable-name")).toBe("env");
  });

  it("the variable form's own Cancel drops only that form's changes", async () => {
    await mountSettings();
    await fillField("dashboard-general-setting-name", "General kept");
    await openTab("dashboard-settings-variable-tab");
    await click(byTest("dashboard-add-variable-btn"));
    await fillField("dashboard-variable-name", "env");

    await click(byTest("dashboard-variable-cancel-btn"));
    window.dispatchEvent(new Event("pagehide"));
    expect(draftData()).toMatchObject({
      variable: null,
      general: { values: { name: "General kept" } },
    });
  });

  it("drops a continued edit of a variable deleted since the draft", async () => {
    writeEditorDraft(scope, {
      data: {
        tab: "variableSettings",
        general: null,
        tabRename: null,
        variable: { variableName: "gone", values: { name: "gone", type: "constant" } },
      },
    });
    await mountSettings();
    await click(byTest("editor-draft-continue"));

    expect(byTest("dashboard-variable-name")).toBeNull();
    expect(byTest("dashboard-add-variable-btn")).not.toBeNull();
    await closeDrawer();
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
  });

  it("drafts a tab rename and restores the open rename on Continue", async () => {
    await mountSettings();
    await openTab("dashboard-settings-tab-tab");
    const editButtons = document.body.querySelectorAll<HTMLElement>(
      '[data-test="dashboard-tab-settings-tab-edit-btn"]',
    );
    await click(editButtons[1]);
    await fillField("dashboard-tab-settings-tab-name-edit", "Failures");
    window.dispatchEvent(new Event("pagehide"));
    expect(draftData()).toMatchObject({
      tab: "tabSettings",
      tabRename: { tabId: "t2", name: "Failures" },
    });

    await closeDrawer();
    await leave("o-dialog-secondary-btn");
    await reopen();
    await click(byTest("editor-draft-continue"));
    expect(fieldValue("dashboard-tab-settings-tab-name-edit")).toBe("Failures");
  });

  it("leave Save saves every changed tab of the drawer in turn", async () => {
    await mountSettings();
    await fillField("dashboard-general-setting-name", "Both saved");
    await openTab("dashboard-settings-tab-tab");
    const editButtons = document.body.querySelectorAll<HTMLElement>(
      '[data-test="dashboard-tab-settings-tab-edit-btn"]',
    );
    await click(editButtons[0]);
    await fillField("dashboard-tab-settings-tab-name-edit", "Home");

    await closeDrawer();
    await leave("editor-draft-leave-save");

    expect(db.server.title).toBe("Both saved");
    expect(editTab).toHaveBeenCalledTimes(1);
    expect(db.server.tabs[0].name).toBe("Home");
    expect(open.value).toBe(false);
    expect(readEditorDraft(scope)).toBeNull();
  });

  it("leave Save opens the variable form and stays when it does not validate", async () => {
    await mountSettings();
    await openTab("dashboard-settings-variable-tab");
    await click(byTest("dashboard-add-variable-btn"));
    // A query variable needs a stream and field, so the name alone does not validate.
    await fillField("dashboard-variable-name", "env");
    await openTab("dashboard-settings-general-tab");

    await closeDrawer();
    await leave("editor-draft-leave-save");

    expect(addVariable).not.toHaveBeenCalled();
    expect(open.value).toBe(true);
    expect(fieldValue("dashboard-variable-name")).toBe("env");
  });

  it("leave Save of a continued variable draft adds it to the dashboard", async () => {
    writeEditorDraft(scope, {
      data: {
        tab: "generalSettings",
        general: null,
        tabRename: null,
        variable: {
          variableName: null,
          values: {
            scope: "global",
            selectedTabs: [],
            selectedPanels: [],
            type: "constant",
            name: "env",
            label: "",
            query_data: {
              stream_type: "",
              stream: "",
              field: "",
              max_record_size: null,
              filter: [],
            },
            value: "prod",
            options: [{ label: "", value: "", selected: true }],
            multiSelect: false,
            hideOnDashboard: false,
            selectAllValueForMultiSelect: "first",
            customMultiSelectValue: [],
            escapeSingleQuotes: true,
          },
        },
      },
    });
    await mountSettings();
    await click(byTest("editor-draft-continue"));

    await closeDrawer();
    await leave("editor-draft-leave-save");

    expect(addVariable).toHaveBeenCalledTimes(1);
    expect(db.server.variables.list.map((v) => v.name)).toContain("env");
    expect(open.value).toBe(false);
    expect(readEditorDraft(scope)).toBeNull();
  });
});
