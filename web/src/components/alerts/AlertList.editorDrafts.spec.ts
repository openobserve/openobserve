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
import { h, nextTick } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import alertsService from "@/services/alerts";
import templateService from "@/services/alert_templates";
import destinationService from "@/services/alert_destination";
import { queryClient } from "@/composables/query/queryClient";
import { readEditorDraft, type EditorDraftScope } from "@/utils/drafts/editorDraftStore";
import AlertList from "./AlertList.vue";
import AddAlert from "./AddAlert.vue";

vi.mock("@/aws-exports", () => ({ default: { isCloud: "false", isEnterprise: "false" } }));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn(() => Promise.resolve({ schema: [{ name: "status", type: "Int64" }] })),
    getStreams: vi.fn(() => Promise.resolve({ list: [{ name: "default" }] })),
  }),
}));
vi.mock("@/composables/useFunctions", () => ({
  default: () => ({ getAllFunctions: vi.fn().mockResolvedValue({ functions: [] }) }),
}));
vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: async () => ({
      astify: vi.fn(() => ({ columns: [] })),
      parse: vi.fn(),
      sqlify: vi.fn(),
    }),
  }),
}));
vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/zincutils")>()),
  getTimezonesByOffset: vi.fn(() => Promise.resolve(["UTC"])),
}));
vi.mock("@/services/oncall", () => ({
  default: { listTeams: vi.fn().mockResolvedValue({ data: [] }) },
}));
vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      listByFolderId: vi.fn(),
      get_by_alert_id: vi.fn(),
      getCompositeReferences: vi.fn(() =>
        Promise.resolve({ data: { references: [], hidden_reference_count: 0 } }),
      ),
    },
  });
});
vi.mock("@/services/alert_templates", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { list: vi.fn() } });
});
vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { list: vi.fn() } });
});
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));

vi.setConfig({ testTimeout: 20000 });

interface AlertForm {
  setFieldValue: (path: string, value: unknown) => void;
}

const ALERT_ID = "3HGifdlCfgrm1thif69NRJig9E5";

const savedAlert = {
  id: ALERT_ID,
  alert_id: ALERT_ID,
  name: "Memory_Utilization",
  org_id: "default",
  folder_id: "default",
  stream_type: "metrics",
  stream_name: "default",
  is_real_time: false,
  query_condition: {
    type: "custom",
    conditions: {
      version: 2,
      conditions: { filterType: "group", logicalOperator: "AND", conditions: [] },
    },
    sql: "",
    promql: null,
    promql_condition: null,
    aggregation: null,
    vrl_function: null,
    multi_time_range: [],
  },
  condition: { type: "sql" },
  trigger_condition: {
    period: 10,
    operator: ">=",
    threshold: 2500000000,
    frequency: 10,
    cron: "",
    frequency_type: "minutes",
    silence: 10,
    timezone: "UTC",
  },
  destinations: ["EndpointTest"],
  context_attributes: {},
  row_template: "",
  row_template_type: "String",
  description: "",
  enabled: true,
  tz_offset: 0,
  owner: "example@gmail.com",
  last_edited_by: "example@gmail.com",
  workflows: [],
  pending_period_sec: 0,
  recovery_destinations: [],
};

const editScope: EditorDraftScope = {
  kind: "alert",
  org: "default",
  entityId: ALERT_ID,
  userEmail: "example@gmail.com",
};

const stubs = {
  FolderList: { template: '<div data-test="stub-folder-list" />' },
  AlertHistoryDrawer: true,
  ImportAlert: true,
  QueryConfig: true,
  AlertSettings: true,
  CompareWithPast: true,
  Deduplication: true,
  Advanced: true,
  PreviewAlert: true,
  AlertSummary: true,
  AnomalyDetectionConfig: true,
  AnomalyAlerting: true,
  AnomalySummary: true,
  AnomalyDataPreview: true,
  JsonEditor: true,
  InlineSelectFolderDropdown: true,
  OPageHeader: true,
};

let router: Router;
let wrapper: VueWrapper | null = null;

const listQuery = { org_identifier: "default", folder: "default" };

const mountApp = async (query: Record<string, string>) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/alerts", name: "alertList", component: AlertList },
      { path: "/logs", name: "logs", component: { render: () => h("div") } },
    ],
  });
  await router.push({ name: "alertList", query: { ...listQuery, ...query } });
  await router.isReady();
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: { plugins: [i18n, store, router], stubs },
    },
  );
  await flushPromises();
};

const editor = () => wrapper!.findComponent(AddAlert);
const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const leaveButton = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-leave-dialog"] [data-test="${id}"]`,
  );

describe("AlertList with the real editor: Discard on leave", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    store.state.selectedOrganization = {
      ...store.state.selectedOrganization,
      identifier: "default",
    };
    Object.assign(store.state.organizationData, {
      foldersByType: [{ type: "alerts", folders: [{ id: "default", name: "Default" }] }],
      allAlertsListByFolderId: {},
    });
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({
      data: { list: [savedAlert] },
    } as never);
    vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({
      data: { ...savedAlert },
    } as never);
    vi.mocked(templateService.list).mockResolvedValue({ data: [{ name: "t1" }] } as never);
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [{ name: "EndpointTest", type: "http" }],
    } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    localStorage.clear();
  });

  it("removes the edit's autosaved draft and its list dot", async () => {
    await mountApp({ action: "update", alert_id: ALERT_ID, name: savedAlert.name });
    await vi.waitFor(() => expect(editor().exists()).toBe(true), { timeout: 5000 });
    await flushPromises();

    window.dispatchEvent(new Event("pointerdown"));
    (editor().vm as unknown as { form: AlertForm }).form.setFieldValue(
      "trigger_condition.threshold",
      9999999999,
    );
    await nextTick();
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(editScope)).not.toBeNull();

    const navigation = router.push("/logs");
    await vi.waitFor(() => expect(byTest("editor-draft-leave-dialog")).not.toBeNull());
    leaveButton("o-dialog-neutral-btn")!.click();
    await navigation;
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/logs");
    expect(readEditorDraft(editScope)).toBeNull();

    await router.push({ name: "alertList", query: listQuery });
    await vi.waitFor(() =>
      expect(wrapper!.find('[data-test="alert-list-Memory_Utilization-draft-dot"]').exists()).toBe(
        false,
      ),
    );
    expect(readEditorDraft(editScope)).toBeNull();
  });
});
