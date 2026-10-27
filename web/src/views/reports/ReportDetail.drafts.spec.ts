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
import { queryClient } from "@/composables/query/queryClient";
import { writeEditorDraft, type EditorDraftScope } from "@/utils/drafts/editorDraftStore";
import { createReportDefaults } from "@/components/reports/CreateReport.schema";
import { reportDraftId } from "@/components/reports/reportDraft";
import CreateReport from "@/components/reports/CreateReport.vue";
import ReportDetail from "./ReportDetail.vue";

vi.mock("@/services/reports", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { getReport: vi.fn(), getReportById: vi.fn() },
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

const ORG = "test-org";
const EMAIL = "user@test.com";
const REPORT = {
  report_id: "r1",
  name: "weekly",
  description: "On the server",
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
  title: "Weekly",
  message: "",
  start: 0,
  frequency: { interval: 1, type: "once", cron: "" },
  timezone: "UTC",
};
const scope = (folder: string): EditorDraftScope => ({
  kind: "report",
  org: ORG,
  entityId: reportDraftId(folder, REPORT.name),
  userEmail: EMAIL,
});
const seedDraft = (folder: string) =>
  writeEditorDraft(scope(folder), {
    data: {
      values: { ...createReportDefaults(), name: REPORT.name, description: `Draft in ${folder}` },
      step: 1,
      folderId: folder,
      showCustomDimensions: false,
    },
  });

let router: Router;
let wrapper: VueWrapper | null = null;

const mountApp = async (path: string) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/reports", name: "reports", component: { render: () => h("div") } },
      { path: "/reports/detail/:report_id", name: "reportDetail", component: ReportDetail },
      { path: "/reports/create", name: "createReport", component: CreateReport },
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
          ReportRunHistory: { render: () => null },
          ReportRunNowDialog: { render: () => null },
          VariablesInput: { render: () => null },
          SelectFolderDropdown: { render: () => null },
        },
      },
    },
  );
  await flushPromises();
};

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);

const clickEdit = async () => {
  byTest("reports-reportdetail-edit")?.click();
  await flushPromises();
  await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("createReport"));
  await flushPromises();
};

describe("ReportDetail -> CreateReport drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    store.state.selectedOrganization = { identifier: ORG, name: "Test Org" } as never;
    store.state.userInfo = { email: EMAIL } as never;
    vi.mocked(dashboardService.list_Folders).mockResolvedValue({
      data: { list: [{ name: "Default", folderId: "folder-1" }] },
    } as never);
    vi.mocked(dashboardService.list).mockResolvedValue({ data: { dashboards: [] } } as never);
    vi.mocked(reports.getReportById).mockResolvedValue({ data: { ...REPORT } } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("Edit on a report in a non-default folder offers that folder's draft", async () => {
    seedDraft("folder-b");
    seedDraft("default");
    await mountApp(`/reports/detail/r1?org_identifier=${ORG}&folder=folder-b`);
    await clickEdit();

    expect(router.currentRoute.value.query.folder).toBe("folder-b");
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    const form = (
      wrapper!.findComponent(CreateReport).vm as unknown as {
        form: { state: { values: { description: string } } };
      }
    ).form;
    expect(form.state.values.description).toBe("Draft in folder-b");
  });

  it("the detail page the editor returns to keeps the folder for the next Edit", async () => {
    await mountApp(`/reports/detail/r1?org_identifier=${ORG}&folder=folder-b`);
    await clickEdit();
    const returnTo = String(router.currentRoute.value.query.returnTo);
    wrapper?.unmount();
    document.body.innerHTML = "";

    seedDraft("folder-b");
    await mountApp(returnTo);
    expect(router.currentRoute.value.query.folder).toBe("folder-b");
    await clickEdit();

    expect(router.currentRoute.value.query.folder).toBe("folder-b");
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
  });
});
