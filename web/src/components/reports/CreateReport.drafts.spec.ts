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
import { h } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import reports from "@/services/reports";
import dashboardService from "@/services/dashboards";
import {
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { byTest, click, clickLeave, clickRestore, pressEscape } from "@/test/unit/helpers/draftDom";
import { fillField } from "@/test/unit/helpers/fillField";
import { createReportDefaults, type CreateReportForm } from "./CreateReport.schema";
import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";
import CreateReport from "./CreateReport.vue";

vi.mock("@/services/reports", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      getReport: vi.fn(),
      getReportById: vi.fn(),
      createReportV2: vi.fn(),
      updateReport: vi.fn(),
      updateReportById: vi.fn(),
    },
  });
});
vi.mock("@/services/dashboards", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list_Folders: vi.fn(), list: vi.fn() },
  });
});
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));
vi.mock("@/utils/commons", () => ({ getFoldersListByType: vi.fn(() => Promise.resolve()) }));
vi.mock("@/utils/date", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  convertDateToTimestamp: vi.fn(() => ({ timestamp: 1700000000, offset: 0 })),
}));

interface ReportDraft {
  values: CreateReportForm;
  step: number;
  folderId: string;
  showCustomDimensions: boolean;
}

const ORG = "test-org";
const EMAIL = "user@test.com";
const newScope: EditorDraftScope = { kind: "report", org: ORG, entityId: null, userEmail: EMAIL };
const editScope: EditorDraftScope = { ...newScope, entityId: "default/existing-report" };

const MOCK_REPORT = {
  report_id: "r1",
  name: "existing-report",
  description: "Existing description",
  dashboards: [
    {
      folder: "folder-1",
      dashboard: "dash-1",
      tabs: ["tab-1"],
      variables: [],
      timerange: { type: "relative", period: "30m", from: 0, to: 0 },
      report_type: "pdf",
    },
  ],
  destinations: [{ email: "dest@example.com" }],
  enabled: true,
  title: "Report Title",
  message: "Hello",
  start: 0,
  frequency: { interval: 1, type: "once", cron: "" },
  timezone: "UTC",
  last_triggered_at: 1792769881414719,
};

const validValues = (overrides: Partial<CreateReportForm> = {}): CreateReportForm => ({
  ...createReportDefaults(),
  name: "draft-report",
  title: "Weekly",
  emails: "team@example.com",
  dashboards: [
    {
      ...createReportDefaults().dashboards[0],
      folder: "folder-1",
      dashboard: "dash-1",
      tabs: "tab-1",
    },
  ],
  ...overrides,
});

let router: Router;
let wrapper: VueWrapper | null = null;

const mountEditor = async (path: string, { realFolderPicker = false } = {}) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/reports", name: "reports", component: { render: () => h("div") } },
      { path: "/reports/create", name: "createReport", component: CreateReport },
      { path: "/logs", name: "logs", component: { render: () => h("div") } },
    ],
  });
  await router.push(path);
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [router, store, i18n],
        provide: { store },
        stubs: {
          VariablesInput: { render: () => null },
          ...(realFolderPicker ? {} : { SelectFolderDropdown: { render: () => null } }),
        },
      },
    },
  );
  await flushPromises();
  return wrapper;
};

const editor = () => wrapper!.findComponent(CreateReport);
const form = () =>
  (
    editor().vm as unknown as {
      form: {
        setFieldValue: (k: string, v: unknown) => void;
        state: { values: CreateReportForm };
      };
    }
  ).form;
const vm = () =>
  editor().vm as unknown as {
    step: number;
    selectedReportFolderId: string;
    openCancelDialog: () => Promise<void>;
    reportDraft: { hasUnsavedChanges: () => boolean };
  };

const edit = async (fields: Partial<CreateReportForm>) => {
  window.dispatchEvent(new Event("pointerdown"));
  Object.entries(fields).forEach(([key, value]) => form().setFieldValue(key, value));
  await flushPromises();
};

describe("CreateReport drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    store.state.selectedOrganization = { identifier: ORG, name: "Test Org" } as never;
    store.state.userInfo = { email: EMAIL } as never;
    vi.mocked(dashboardService.list_Folders).mockResolvedValue({
      data: { list: [{ name: "Default", folderId: "folder-1" }] },
    } as never);
    vi.mocked(dashboardService.list).mockResolvedValue({
      data: {
        dashboards: [
          {
            v1: {
              title: "My Dashboard",
              dashboardId: "dash-1",
              tabs: [{ name: "Tab 1", tabId: "tab-1" }],
              version: 1,
            },
          },
        ],
      },
    } as never);
    vi.mocked(reports.createReportV2)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(reports.updateReportById)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(reports.getReportById).mockResolvedValue({ data: { ...MOCK_REPORT } } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("writes a new report's form values, step and folder when the page hides", async () => {
    await mountEditor("/reports/create?folder=default");
    await edit({ name: "weekly-report", title: "Weekly" });
    vm().step = 2;
    await flushPromises();
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<ReportDraft>(newScope);
    expect(draft?.data.values).toMatchObject({ name: "weekly-report", title: "Weekly" });
    expect(draft?.data.step).toBe(2);
    expect(draft?.data.folderId).toBe("default");
  });

  it("continues a draft: values, step and the dashboard options of its folder", async () => {
    writeEditorDraft(newScope, {
      data: { values: validValues(), step: 3, folderId: "default", showCustomDimensions: true },
    });
    await mountEditor("/reports/create");

    expect(byTest("editor-draft-restore-message")?.textContent).toContain(
      "unsaved changes to this report",
    );
    vi.mocked(dashboardService.list).mockClear();
    click("editor-draft-continue");
    await flushPromises();

    expect(form().state.values).toMatchObject({ name: "draft-report", emails: "team@example.com" });
    expect(form().state.values.dashboards[0]).toMatchObject({ dashboard: "dash-1", tabs: "tab-1" });
    expect(dashboardService.list).toHaveBeenCalled();
    expect(vm().step).toBe(3);
    expect(vm().reportDraft.hasUnsavedChanges()).toBe(true);
  });

  describe("with the real report folder picker", () => {
    const folderPicker = () =>
      editor().findComponent(SelectFolderDropDown).vm as unknown as { selectedFolder: string };
    beforeEach(() => {
      store.state.organizationData.foldersByType = {
        reports: [
          { folderId: "default", name: "default" },
          { folderId: "folder-b", name: "Folder B" },
        ],
      } as never;
    });

    it("switching the folder mid-way keeps the name and the step", async () => {
      await mountEditor("/reports/create?folder=default", { realFolderPicker: true });
      await edit({ name: "weekly-report" });
      vm().step = 2;
      await flushPromises();

      folderPicker().selectedFolder = "folder-b";
      await flushPromises();

      expect(vm().selectedReportFolderId).toBe("folder-b");
      expect(form().state.values.name).toBe("weekly-report");
      expect(vm().step).toBe(2);
      expect(router.currentRoute.value.fullPath).toBe("/reports/create?folder=default");
    });

    it("a folder-only change is unsaved, so Cancel asks", async () => {
      await mountEditor("/reports/create?folder=default", { realFolderPicker: true });
      expect(vm().reportDraft.hasUnsavedChanges()).toBe(false);

      window.dispatchEvent(new Event("pointerdown"));
      folderPicker().selectedFolder = "folder-b";
      await flushPromises();

      expect(vm().selectedReportFolderId).toBe("folder-b");
      expect(vm().reportDraft.hasUnsavedChanges()).toBe(true);
      click("add-report-cancel-btn");
      await flushPromises();
      expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
      expect(router.currentRoute.value.name).toBe("createReport");
    });

    it("continuing a draft shows the draft's folder in the picker", async () => {
      writeEditorDraft(newScope, {
        data: { values: validValues(), step: 2, folderId: "folder-b", showCustomDimensions: false },
      });
      await mountEditor("/reports/create?folder=default", { realFolderPicker: true });
      click("editor-draft-continue");
      await flushPromises();

      expect(vm().selectedReportFolderId).toBe("folder-b");
      expect(folderPicker().selectedFolder).toBe("folder-b");
      expect(form().state.values.name).toBe("draft-report");
    });
  });

  it("keys an edited report's draft by folder and name and ignores run counters in the base", async () => {
    await mountEditor("/reports/create?report_id=r1&name=existing-report");
    await edit({ description: "Changed" });
    window.dispatchEvent(new Event("pagehide"));
    const first = readEditorDraft<ReportDraft>(editScope);
    expect(first?.data.values.description).toBe("Changed");
    expect(readEditorDraft(newScope)).toBeNull();
    wrapper?.unmount();

    vi.mocked(reports.getReportById).mockResolvedValue({
      data: { ...MOCK_REPORT, last_triggered_at: 1792769999999999 },
    } as never);
    await mountEditor("/reports/create?report_id=r1&name=existing-report");
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
    expect(byTest("editor-draft-changed-on-server")).toBeNull();
  });

  it("drafts and guards an edited report filled with no key or pointer event (autofill, fill())", async () => {
    await mountEditor("/reports/create?report_id=r1&name=existing-report");
    await fillField("add-report-description-input", "Filled description");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<ReportDraft>(editScope)?.data.values.description).toBe(
      "Filled description",
    );

    const navigation = router.push("/logs");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("o-dialog-close-btn");
    await navigation;
    expect(router.currentRoute.value.name).toBe("createReport");
  });

  it("does not offer a same-named report's draft from another folder", async () => {
    const otherFolder = { ...editScope, entityId: "folder-a/existing-report" };
    writeEditorDraft(otherFolder, {
      data: { values: validValues(), step: 1, folderId: "folder-a", showCustomDimensions: false },
    });
    await mountEditor("/reports/create?report_id=r1&name=existing-report&folder=folder-b");
    expect(byTest("editor-draft-restore-dialog")).toBeNull();

    await edit({ description: "Changed in B" });
    window.dispatchEvent(new Event("pagehide"));
    const own = { ...editScope, entityId: "folder-b/existing-report" };
    expect(readEditorDraft<ReportDraft>(own)?.data.values.description).toBe("Changed in B");
    expect(readEditorDraft<ReportDraft>(otherFolder)?.data.values.name).toBe("draft-report");
  });

  it("drops only this folder's draft when the report is gone", async () => {
    const gone = { ...editScope, entityId: "folder-b/existing-report" };
    const sibling = { ...editScope, entityId: "folder-a/existing-report" };
    writeEditorDraft(gone, { data: {} });
    writeEditorDraft(sibling, { data: {} });
    vi.mocked(reports.getReportById).mockRejectedValueOnce({ response: { status: 404 } });
    await mountEditor("/reports/create?report_id=r1&name=existing-report&folder=folder-b");

    expect(readEditorDraft(gone)).toBeNull();
    expect(readEditorDraft(sibling)).not.toBeNull();
  });

  it("does not warn when an untouched report with a relative time range is reopened later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
      await mountEditor("/reports/create?report_id=r1&name=existing-report");
      expect(form().state.values.dashboards[0].timerange.from).toBeGreaterThan(0);
      await edit({ description: "Changed" });
      window.dispatchEvent(new Event("pagehide"));
      expect(readEditorDraft(editScope)).not.toBeNull();
      wrapper?.unmount();

      vi.setSystemTime(new Date("2026-10-28T10:07:00Z"));
      await mountEditor("/reports/create?report_id=r1&name=existing-report");
      expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
      expect(byTest("editor-draft-changed-on-server")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("warns when the report was really changed on the server after the draft", async () => {
    await mountEditor("/reports/create?report_id=r1&name=existing-report");
    await edit({ description: "Changed" });
    window.dispatchEvent(new Event("pagehide"));
    wrapper?.unmount();

    vi.mocked(reports.getReportById).mockResolvedValue({
      data: { ...MOCK_REPORT, title: "Retitled by a teammate" },
    } as never);
    await mountEditor("/reports/create?report_id=r1&name=existing-report");
    expect(byTest("editor-draft-changed-on-server")).not.toBeNull();
  });

  it("warns when the report's editable fields changed on the server", async () => {
    writeEditorDraft(editScope, {
      data: { values: validValues(), step: 1, folderId: "default", showCustomDimensions: false },
      baseHash: "00000000",
    });
    await mountEditor("/reports/create?report_id=r1&name=existing-report");

    expect(byTest("editor-draft-changed-on-server")).not.toBeNull();
  });

  it("Escape on the restore dialog keeps the draft, Start fresh drops it", async () => {
    await mountEditor("/reports/create");
    await edit({ name: "from-draft" });
    window.dispatchEvent(new Event("pagehide"));
    wrapper!.unmount();

    await mountEditor("/reports/create");
    pressEscape();
    await flushPromises();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(form().state.values.name).toBe("");
    expect(readEditorDraft(newScope)).not.toBeNull();
    wrapper!.unmount();

    await mountEditor("/reports/create");
    clickRestore("o-dialog-secondary-btn");
    await flushPromises();
    expect(form().state.values.name).toBe("");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Keep draft leaves and offers the work on the next visit", async () => {
    await mountEditor("/reports/create");
    await edit({ name: "kept-report" });

    const navigation = router.push("/logs");
    await flushPromises();
    clickLeave("o-dialog-secondary-btn");
    await navigation;
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft<ReportDraft>(newScope)?.data.values.name).toBe("kept-report");
    wrapper!.unmount();

    await mountEditor("/reports/create");
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
  });

  it("Cancel asks when the name was typed while the folders were still loading", async () => {
    let release!: () => void;
    vi.mocked(dashboardService.list_Folders).mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ data: { list: [{ name: "Default", folderId: "folder-1" }] } });
      }) as never,
    );
    await mountEditor("/reports/create");
    await fillField("add-report-name-input", "typed-early");
    release();
    await flushPromises();

    expect(form().state.values.name).toBe("typed-early");
    expect(vm().reportDraft.hasUnsavedChanges()).toBe(true);
    click("add-report-cancel-btn");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
  });

  it("Cancel with unsaved changes asks, and Discard drops the draft and leaves", async () => {
    await mountEditor("/reports/create");
    await edit({ name: "to-discard" });
    window.dispatchEvent(new Event("pagehide"));

    click("add-report-cancel-btn");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();

    clickLeave("o-dialog-neutral-btn");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("reports");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Save in the leave dialog saves without going to the list, then continues", async () => {
    await mountEditor("/reports/create");
    await edit(validValues());

    const navigation = router.push("/logs");
    await flushPromises();
    clickLeave("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(reports.createReportV2).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Save in the leave dialog keeps the user in the editor when the form is invalid", async () => {
    await mountEditor("/reports/create");
    await edit({ name: "only-a-name" });

    const navigation = router.push("/logs");
    await flushPromises();
    clickLeave("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(reports.createReportV2).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe("createReport");
    expect(vm().reportDraft.hasUnsavedChanges()).toBe(true);
  });

  it("a normal save drops the draft and leaves without asking", async () => {
    await mountEditor("/reports/create");
    await edit(validValues());
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope)).not.toBeNull();

    click("add-report-save-btn");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("reports"));

    expect(reports.createReportV2).toHaveBeenCalledTimes(1);
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(readEditorDraft(newScope)).toBeNull();
  });
});
