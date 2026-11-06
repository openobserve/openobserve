// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import { queryClient } from "@/composables/query/queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";
import config from "@/aws-exports";
import { raw } from "@/types/i18n";
import { normalizePrefill } from "@/utils/alerts/alertPrefill";
import { writeAlertPrefill } from "@/utils/alerts/alertPrefillStorage";
import { noDataAlert, type AutoObserveAlertOptions } from "@/utils/alerts/prefill/fromAutoObserve";
import { destinationHandoff } from "@/components/autoobserve/insight/targets/editTargets";
import { byTest } from "@/test/unit/helpers/draftDom";
import AddAlert from "./AddAlert.vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = (await importOriginal<{ default: Record<string, unknown> }>()).default;
  return { default: { ...actual, isEnterprise: "true" } };
});
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn(() => Promise.resolve({ schema: [{ name: "service_name", type: "Utf8" }] })),
    getStreams: vi.fn(() => Promise.resolve({ list: [{ name: "default" }, { name: "ingest_b" }] })),
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
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: vi.fn(() => () => {}),
}));
vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      update_by_alert_id: vi.fn(() => Promise.resolve({ data: { code: 200 } })),
      get_by_alert_id: vi.fn(),
      listByFolderId: vi.fn(() => Promise.resolve({ data: { list: [] } })),
    },
  });
});
vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(() => Promise.resolve({ data: [{ name: "ops-webhook" }, { name: "ops-mail" }] })),
    },
  });
});
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));

interface AddAlertVm {
  formData: Record<string, any>;
}

// Shape of GET /api/v2/{org}/alerts/{id}, with neutral names.
const savedAlert = {
  id: "a1",
  name: "svc_c_errors",
  org_id: "default",
  stream_type: "logs",
  stream_name: "default",
  is_real_time: false,
  query_condition: {
    type: "sql",
    conditions: null,
    sql: "SELECT * FROM default",
    promql: null,
    promql_condition: null,
    aggregation: null,
    vrl_function: null,
    multi_time_range: [],
  },
  trigger_condition: {
    period: 10,
    operator: ">=",
    threshold: 1,
    frequency: 10,
    cron: "",
    frequency_type: "minutes",
    silence: 10,
    timezone: "UTC",
  },
  destinations: [] as string[],
  context_attributes: {},
  row_template: "",
  row_template_type: "String",
  description: "",
  enabled: true,
  tz_offset: 0,
  owner: "root@example.com",
  last_edited_by: "root@example.com",
  pending_period_sec: 60,
  keep_firing_for: 0,
  recovery_destinations: [],
};

const options: AutoObserveAlertOptions = {
  team: { name: "ops", folderId: "ops", folderName: "ops", source: "folder", reason: raw("") },
  notify: { destinations: ["ops-webhook"], reason: raw("") },
  now: 1_793_966_400_000_000,
};

const stubs = {
  QueryConfig: true,
  AlertSettings: true,
  CompareWithPast: true,
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
  CompositeAlertForm: true,
};

let wrapper: VueWrapper | null = null;
let editorProps: Record<string, unknown> = {};

const EditorRoute = defineComponent({
  setup() {
    return () => h(AddAlert, { ...editorProps });
  },
});

const mountAt = async (path: string, props: Record<string, unknown>) => {
  editorProps = props;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/alerts/edit/:alert_id", name: "editAlert", component: EditorRoute },
      { path: "/alerts/add", name: "addAlert", component: EditorRoute },
    ],
  });
  await router.push(path);
  wrapper = mount(
    { render: () => h(RouterView) },
    { attachTo: document.body, global: { plugins: [i18n, router], provide: { store }, stubs } },
  );
  await flushPromises();
  await flushPromises();
};

const vm = () => wrapper!.findComponent(AddAlert).vm as unknown as AddAlertVm;
const bannerText = () => byTest("add-alert-calibration-banner")?.textContent?.trim() ?? "";
const toastMessages = () =>
  vi.mocked(toast).mock.calls.map(([arg]) => (arg as { message: string }).message);

const openNoDataPrefill = async (build: "enterprise" | "oss" = "enterprise") => {
  const prefill = noDataAlert(
    {
      service: "svc-ingest-b",
      cluster: null,
      namespace: null,
      stream: { type: "logs", name: "ingest_b" },
      schema: ["service_name"],
    },
    options,
  )!;
  writeAlertPrefill(normalizePrefill(prefill));
  // An OSS build never writes this prefill, so the OSS case seeds the enterprise one, as the Playwright case does.
  if (build === "oss") config.isEnterprise = "false";
  await mountAt("/alerts/add?prefill=autoobserve&folder=ops", {
    modelValue: {},
    isUpdated: false,
    destinations: [],
  });
};

describe("AddAlert with an AutoObserve prefill", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    queryClient.clear();
    vi.mocked(toast).mockClear();
    vi.mocked(alertsService.get_by_alert_id).mockImplementation(
      async () => ({ data: structuredClone(savedAlert) }) as any,
    );
    vi.mocked(destinationService.list).mockImplementation((() =>
      Promise.resolve({ data: [{ name: "ops-webhook" }, { name: "ops-mail" }] })) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    wrapper?.unmount();
    wrapper = null;
    config.isEnterprise = "true";
  });

  it("opens the create form with the query, the origin line and the destination, and says where it came from", async () => {
    await openNoDataPrefill();

    expect(vm().formData.stream_name).toBe("ingest_b");
    expect(vm().formData.query_condition.sql).toBe(
      'SELECT count(*) AS row_count FROM "ingest_b" WHERE "service_name" = \'svc-ingest-b\' HAVING count(*) = 0',
    );
    expect(vm().formData.description).toBe(
      "Created from an AutoObserve suggestion for svc-ingest-b on Nov 6.",
    );
    expect(vm().formData.destinations).toEqual(["ops-webhook"]);
    expect(toastMessages()).toContain(
      "Suggested by AutoObserve for svc-ingest-b. Nothing is saved until you save.",
    );
  });

  it("on an OSS build the same stash shows no AutoObserve wording and sets no description or destination", async () => {
    await openNoDataPrefill("oss");

    expect(toastMessages()).toContain("Query imported into the alert form");
    expect(toastMessages().join(" ")).not.toContain("AutoObserve");
    expect(vm().formData.description).toBe("");
    expect(vm().formData.destinations).toEqual([]);
  });

  it("the edit route with prefill=autoobserve applies Choose who gets notified and keeps the saved query", async () => {
    await destinationHandoff("a1", ["ops-webhook"]);
    await mountAt("/alerts/edit/a1?prefill=autoobserve", {
      modelValue: structuredClone(savedAlert),
      isUpdated: true,
    });

    expect(vm().formData.query_condition.type).toBe("sql");
    expect(vm().formData.query_condition.sql).toBe("SELECT * FROM default");
    expect(vm().formData.destinations).toEqual(["ops-webhook"]);
    expect(bannerText()).toContain("Suggested by AutoObserve");
    expect(bannerText()).toContain("ops-webhook");
    expect(bannerText()).not.toContain("Alert Calibration");
  });
});
