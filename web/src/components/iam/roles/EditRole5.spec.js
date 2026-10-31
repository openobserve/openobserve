import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { queryClient } from "@/composables/query/queryClient";

// Every test here mounts the whole role editor, which runs ~5x slower on CI than locally — the 5s default times out.
vi.setConfig({ testTimeout: 20000 });

// Mock toast so we can assert notification calls
const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args) => mockToast(...args),
}));

// Avoid waiting for router readiness / guards to hang
// @ts-ignore
router.isReady = () => Promise.resolve();

// Mock routeGuard to always continue
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    routeGuard: vi.fn((_to, _from, next) => next()),
  };
});

// Mock config flags to enable enterprise routes if needed
vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "true" },
}));

// Mocked so these specs stay independent of the real DBM catalogs' contents.
vi.mock("@/components/iam/roles/dbmViewerPreset", () => ({
  DBM_VIEWER_STREAMS: ["postgresql_backends", "mysql_threads", "dbm_absent_stream"],
  DBM_VIEWER_STREAM_ROW_PERMS: ["AllowGet"],
  DBM_VIEWER_TYPE_NODE_PERMS: ["AllowList"],
  DBM_MODULE_RESOURCE: "db_monitoring",
}));

// Mocked so these specs stay independent of the real curated set's contents.
vi.mock("@/components/iam/roles/k8sViewerPreset", () => ({
  K8S_VIEWER_STREAMS: ["k8s_pod_cpu", "k8s_node_memory", "k8s_absent_stream"],
  K8S_VIEWER_STREAM_ROW_PERMS: ["AllowGet"],
  K8S_VIEWER_TYPE_NODE_PERMS: ["AllowList"],
}));

// Shared mutable state for the hoisted service mocks.
const ctl = vi.hoisted(() => ({
  callOrder: [],
  rolePermissions: [],
  resourcesError: null,
  resources: null,
  // Mutable so a spec can shrink the org's metric streams (the zero-match case).
  metricStreams: null,
  logStreams: null,
  // Every stream list the page reads, in order, so a test can tell an eager load from a lazy one.
  streamCalls: [],
  // Set to a pending promise to hold every stream list, so a test can act while a preset is still staging.
  streamGate: null,
  // Stream types whose list read fails, as a 403 or a dropped request would.
  failStreamTypes: [],
}));

// Mock composable useStreams
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn(async (type) => {
      ctl.streamCalls.push(type);
      await ctl.streamGate;
      if (ctl.failStreamTypes.includes(type)) throw new Error("403");
      const map = {
        logs: { list: ctl.logStreams ?? [{ name: "app" }, { name: "sys" }] },
        metrics: {
          list: ctl.metricStreams ?? [
            { name: "cpu" },
            { name: "mem" },
            { name: "postgresql_backends" },
            { name: "mysql_threads" },
          ],
        },
        traces: { list: [{ name: "svc-a" }] },
        profiles: { list: [{ name: "cpu-prof" }, { name: "mem-prof" }] },
        index: { list: [{ name: "users" }] },
        enrichment_tables: { list: [{ name: "geo" }] },
        metadata: { list: [{ name: "meta" }] },
      };
      return map[type] || { list: [] };
    }),
  }),
}));

// Mock all external services used inside EditRole.vue
vi.mock("@/services/iam", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  const getResources = vi.fn(async () => {
    ctl.callOrder.push("getResources");
    if (ctl.resourcesError) throw ctl.resourcesError;
    return { data: structuredClone(ctl.resources) };
  });
  const getAllRolePermissions = vi.fn(async () => {
    ctl.callOrder.push("getAllRolePermissions");
    return { data: ctl.rolePermissions.map((p) => ({ ...p })) };
  });
  return overlayServiceMock(await importOriginal(), {
    getResources,
    getResourcePermission: vi.fn(async () => ({ data: [] })),
    getAllRolePermissions,
    getRoleUsers: vi.fn(async () => {
      ctl.callOrder.push("getRoleUsers");
      return { data: ["u1@example.com", "u2@example.com"] };
    }),
    updateRole: vi.fn(async () => ({ data: { code: 200 } })),
    getGroups: vi.fn(async () => ({ data: [] })),
    getRoles: vi.fn(async () => ({ data: [] })),
  });
});

vi.mock("@/services/stream", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/services/pipelines", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      getPipelines: vi.fn(async () => ({ data: { list: [{ pipeline_id: "p1", name: "P1" }] } })),
    },
  });
});
vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      listByFolderId: vi.fn(async () => ({ data: { list: [{ alertId: "a1", name: "A1" }] } })),
    },
  });
});
vi.mock("@/services/synthetics", () => ({
  default: {
    listEnvironments: vi.fn(async () => ({
      data: [
        { id: "org/staging", name: "staging", is_global: false },
        { id: "global_org", name: "global", is_global: true },
      ],
    })),
  },
}));
vi.mock("@/services/reports", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(async () => ({ data: [{ name: "r1" }] })),
      listByFolderId: vi.fn(async () => ({
        data: { list: [{ report_id: "rep1", name: "Report One" }] },
      })),
    },
  });
});
vi.mock("@/services/alert_templates", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn(async () => ({ data: [{ name: "t1" }] })) },
  });
});
vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn(async () => ({ data: [{ name: "dest1" }] })) },
  });
});
vi.mock("@/services/jstransform", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn(async () => ({ data: { list: [{ name: "f1" }] } })) },
  });
});
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(async () => ({
        data: { data: [{ identifier: "org1" }, { identifier: "org2" }] },
      })),
    },
  });
});
vi.mock("@/services/saved_views", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get: vi.fn(async () => ({ data: { views: [{ view_id: "v1", view_name: "V1" }] } })),
    },
  });
});
vi.mock("@/services/dashboards", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(async () => ({ data: { dashboards: [{ dashboardId: "d1", title: "D1" }] } })),
      list_Folders: vi.fn(async () => ({
        data: { list: [{ folderId: "default", name: "default" }] },
      })),
    },
  });
});
vi.mock("@/services/service_accounts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn(async () => ({ data: { data: ["svc1@example.com"] } })) },
  });
});
vi.mock("@/services/cipher_keys", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn(async () => ({ data: { keys: [{ name: "key1" }] } })) },
  });
});
vi.mock("@/services/common", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list_Folders: vi.fn(async () => ({
        data: { list: [{ folderId: "default", name: "default" }] },
      })),
    },
  });
});
vi.mock("@/services/online-evals.service", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      providers: {
        list: vi.fn(async () => [{ id: "openai", name: "OpenAI" }]),
      },
      scoreConfigs: {
        list: vi.fn(async () => [{ entity_id: "quality-score", name: "Quality Score" }]),
      },
      scorers: {
        list: vi.fn(async () => [{ entityId: "llm-judge", name: "LLM Judge" }]),
      },
      jobs: {
        list: vi.fn(async () => [{ id: "daily-eval", name: "Daily Eval" }]),
      },
    },
  });
});
vi.mock("@/services/llm-queues.service", () => ({
  default: {
    list: vi.fn(async () => [{ id: "review-queue", name: "Review Queue" }]),
  },
}));
vi.mock("@/services/llm-datasets.service", () => ({
  default: {
    list: vi.fn(async () => [{ id: "golden-set", name: "Golden Set" }]),
  },
}));

// Target component
import EditRole from "@/components/iam/roles/EditRole.vue";
import onlineEvalsService from "@/services/online-evals.service";
import llmQueuesService from "@/services/llm-queues.service";
import llmDatasetsService from "@/services/llm-datasets.service";
import syntheticsService from "@/services/synthetics";
import dashboardService from "@/services/dashboards";
import alertService from "@/services/alerts";

const RESOURCE_CATALOG = [
  {
    key: "stream",
    display_name: "Streams",
    has_entities: true,
    top_level: true,
    visible: true,
    parent: "",
    order: 1,
  },
  {
    key: "logs",
    display_name: "Logs",
    has_entities: true,
    parent: "stream",
    top_level: false,
    visible: true,
    order: 2,
  },
  {
    key: "metrics",
    display_name: "Metrics",
    has_entities: true,
    parent: "stream",
    top_level: false,
    visible: true,
    order: 3,
  },
  {
    key: "dfolder",
    display_name: "Dash Folders",
    has_entities: true,
    top_level: true,
    visible: true,
    parent: "",
    order: 4,
  },
  {
    key: "dashboard",
    display_name: "Dashboards",
    has_entities: true,
    parent: "dfolder",
    top_level: false,
    visible: true,
    order: 5,
  },
  {
    key: "afolder",
    display_name: "Alert Folders",
    has_entities: true,
    top_level: true,
    visible: true,
    parent: "",
    order: 6,
  },
  {
    key: "alert",
    display_name: "Alerts",
    has_entities: true,
    parent: "afolder",
    top_level: false,
    visible: true,
    order: 7,
  },
  {
    key: "service_accounts",
    display_name: "Service Accounts",
    has_entities: false,
    top_level: true,
    visible: true,
    parent: "",
    order: 8,
  },
  {
    key: "role",
    display_name: "Roles",
    has_entities: false,
    top_level: true,
    visible: true,
    parent: "",
    order: 9,
  },
  {
    key: "group",
    display_name: "Groups",
    has_entities: false,
    top_level: true,
    visible: true,
    parent: "",
    order: 10,
  },
  {
    key: "provider",
    display_name: "LLM Providers",
    has_entities: true,
    top_level: true,
    visible: true,
    parent: "",
    order: 11,
  },
  {
    key: "score_config",
    display_name: "Score Configs",
    has_entities: true,
    top_level: true,
    visible: true,
    parent: "",
    order: 12,
  },
  {
    key: "scorer",
    display_name: "Scorers",
    has_entities: true,
    top_level: true,
    visible: true,
    parent: "",
    order: 13,
  },
  {
    key: "eval_job",
    display_name: "Online Eval Jobs",
    has_entities: true,
    top_level: true,
    visible: true,
    parent: "",
    order: 14,
  },
  {
    key: "annotation_queue",
    display_name: "Annotation Queues",
    has_entities: true,
    top_level: true,
    visible: true,
    parent: "",
    order: 15,
  },
  {
    key: "dataset",
    display_name: "Datasets",
    has_entities: true,
    top_level: true,
    visible: true,
    parent: "",
    order: 16,
  },
  {
    key: "db_monitoring",
    display_name: "Database Monitoring",
    has_entities: false,
    top_level: true,
    visible: true,
    parent: "",
    order: 17,
  },
  {
    key: "synthetic_environment",
    display_name: "Synthetic Environments",
    has_entities: true,
    top_level: true,
    visible: true,
    parent: "",
    order: 18,
  },
];

// The navigation suite pins exact rail and module expectations against this trimmed catalogue.
const NAVIGATION_RESOURCE_CATALOG = RESOURCE_CATALOG.slice(0, 11);

const RUM_RESOURCE_CATALOG = [
  ...RESOURCE_CATALOG,
  {
    key: "sourcemaps",
    display_name: "Source Maps",
    has_entities: false,
    top_level: true,
    visible: true,
    parent: "",
    order: 19,
  },
  {
    key: "rum_analytics",
    display_name: "RUM Product Analytics",
    has_entities: false,
    top_level: true,
    visible: true,
    parent: "",
    order: 20,
  },
];

const SAVED_GRANTS_RESOURCE_CATALOG = [
  { key: "stream", display_name: "Streams", has_entities: true, top_level: true, order: 1 },
  {
    key: "logs",
    display_name: "Logs",
    has_entities: true,
    parent: "stream",
    top_level: false,
    order: 2,
  },
  {
    key: "metrics",
    display_name: "Metrics",
    has_entities: true,
    parent: "stream",
    top_level: false,
    order: 3,
  },
  {
    key: "profiles",
    display_name: "Profiles",
    has_entities: true,
    parent: "stream",
    top_level: false,
    order: 80,
  },
  { key: "dfolder", display_name: "Dash Folders", has_entities: true, top_level: true, order: 4 },
  {
    key: "dashboard",
    display_name: "Dashboards",
    has_entities: true,
    parent: "dfolder",
    top_level: false,
    order: 5,
  },
  { key: "afolder", display_name: "Alert Folders", has_entities: true, top_level: true, order: 6 },
  {
    key: "alert",
    display_name: "Alerts",
    has_entities: true,
    parent: "afolder",
    top_level: false,
    order: 7,
  },
  { key: "rfolder", display_name: "Report Folders", has_entities: true, top_level: true, order: 8 },
  {
    key: "report",
    display_name: "Reports",
    has_entities: true,
    parent: "rfolder",
    top_level: false,
    order: 9,
  },
  { key: "role", display_name: "Roles", has_entities: false, top_level: true, order: 10 },
  {
    key: "db_monitoring",
    display_name: "Database Monitoring",
    has_entities: false,
    top_level: true,
    order: 11,
  },
  // Pinned so the `visible: false` filter in getRoleDetails has something to drop.
  { key: "hidden_thing", display_name: "Hidden", has_entities: false, top_level: true, order: 12 },
].map((r) => ({
  parent: "",
  visible: r.key !== "hidden_thing",
  ...r,
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const ORG = store.state.selectedOrganization.identifier;
const ALL = `_all_${ORG}`;

const editorStub = defineComponent({
  name: "QueryEditorStub",
  props: {
    modelValue: { type: String, default: "" },
    query: { type: String, default: "" },
  },
  emits: ["update:query"],
  setup(_props, { expose }) {
    expose({
      setValue: vi.fn(),
      formatDocument: vi.fn(),
      resetEditorLayout: vi.fn(),
    });
    return () => null;
  },
});

async function mountEditRole(customStubs = {}) {
  // preset current route for onBeforeMount usage
  router.currentRoute.value.name = "editRole";
  router.currentRoute.value.params = { role_name: "Admin" };

  const wrapper = mount(EditRole, {
    attachTo: node,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        AppTabs: {
          props: ["tabs", "activeTab"],
          emits: ["update:active-tab"],
          template: `<div data-test="app-tabs-stub">
            <button class="tab-permissions" @click="$emit('update:active-tab','permissions')">Permissions</button>
            <button class="tab-users" @click="$emit('update:active-tab','users')">Users</button>
            <button class="tab-serviceAccounts" @click="$emit('update:active-tab','serviceAccounts')">Service Accounts</button>
          </div>`,
        },
        ModuleRail: {
          props: ["modules", "modelValue"],
          emits: ["update:modelValue"],
          template: `<div data-test="module-rail-stub"></div>`,
        },
        GroupUsers: { template: '<div data-test="group-users-stub"></div>' },
        GroupServiceAccounts: { template: '<div data-test="group-service-accounts-stub"></div>' },
        QueryEditor: editorStub,
        ...customStubs,
      },
    },
  });

  // allow onBeforeMount async chain to complete
  await flushPromises();
  await flushPromises();
  return wrapper;
}

function useNavigationFixture() {
  beforeEach(() => {
    ctl.resources = NAVIGATION_RESOURCE_CATALOG;
    ctl.metricStreams = [{ name: "cpu" }, { name: "mem" }];
  });
}

function useSavedGrantsFixture() {
  beforeEach(() => {
    ctl.resources = SAVED_GRANTS_RESOURCE_CATALOG;
    ctl.metricStreams = [
      { name: "cpu" },
      { name: "postgresql_backends" },
      { name: "mysql_threads" },
    ];
    vi.mocked(dashboardService.list).mockImplementation(async () => ({
      // The real endpoint wraps each dashboard in a version key, and getDashboards
      // reads the first truthy value out of it.
      data: { dashboards: [{ v1: { dashboardId: "d1", title: "D1" } }] },
    }));
    vi.mocked(alertService.listByFolderId).mockImplementation(async () => ({
      data: { list: [{ alert_id: "a1", name: "A1" }] },
    }));
  });
  afterEach(() => {
    vi.mocked(dashboardService.list).mockReset();
    vi.mocked(dashboardService.list_Folders).mockReset();
    vi.mocked(alertService.listByFolderId).mockReset();
  });
}

const mountEditRoleVm = async () => (await mountEditRole()).vm;

beforeEach(() => {
  // A draft one test leaves behind would open the restore dialog on the next mount of the same role.
  localStorage.clear();
  // resourcesQuery is cached by TanStack, so without this the second mount
  // never re-calls getResources and the call-order pins go stale.
  queryClient.clear();
  ctl.callOrder = [];
  ctl.rolePermissions = [];
  ctl.resourcesError = null;
  ctl.resources = RESOURCE_CATALOG;
  ctl.metricStreams = null;
  ctl.logStreams = null;
  ctl.streamCalls = [];
  ctl.streamGate = null;
  ctl.failStreamTypes = [];
  router.currentRoute.value.query = {};
});

// Reset mocks
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mockToast.mockClear();
});

src/components/iam/roles/EditRole4.spec.jsdescribe("EditRole - presets panel wiring", () => {
  it("announces a preset added from the panel", async () => {
    const wrapper = await mountEditRole();
    mockToast.mockClear();

    wrapper.findComponent({ name: "RoleSummary" }).vm.$emit("preset", "readonly");
    await flushPromises();

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "success",
        message: expect.stringContaining(i18n.global.t("iam.editRole.presetReadonlyTitle")),
      }),
    );
  });

  it("hands the panel the presets and a preview of each", async () => {
    const wrapper = await mountEditRole();
    const summary = wrapper.findComponent({ name: "RoleSummary" });

    expect(summary.props("presets").map((preset) => preset.id)).toContain("readonly");
    expect(summary.props("previewPreset")("readonly").status).toBe("ready");
    expect(summary.props("applying")).toBe(false);
  });

  // Opening a module unmounts the overview, so only the page can remember the closed panel.
  it("keeps the panel closed after a module is opened and left", async () => {
    const wrapper = await mountEditRole();
    await wrapper.find('[data-test="edit-role-presets-close"]').trigger("click");

    wrapper.vm.activeModule = "stream";
    await flushPromises();
    expect(wrapper.findComponent({ name: "RoleSummary" }).exists()).toBe(false);

    wrapper.vm.activeModule = "";
    await flushPromises();
    expect(wrapper.find('[data-test="edit-role-presets-panel"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="edit-role-presets-open"]').exists()).toBe(true);
  });

  it("starts with the panel open on a fresh visit after it was closed", async () => {
    const earlier = await mountEditRole();
    await earlier.find('[data-test="edit-role-presets-close"]').trigger("click");
    earlier.unmount();

    const wrapper = await mountEditRole();

    expect(wrapper.find('[data-test="edit-role-presets-panel"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="edit-role-presets-open"]').exists()).toBe(false);
  });
});

describe("EditRole - presets panel stream lists", () => {
  // Every visit would otherwise fetch the metrics and logs lists just to count the stream presets.
  it("reads no stream list when the page opens", async () => {
    await mountEditRole();
    await flushPromises();

    expect(ctl.streamCalls).toEqual([]);
  });

  it("reads the metrics and logs lists once the panel asks for them", async () => {
    const wrapper = await mountEditRole();
    await flushPromises();

    wrapper.findComponent({ name: "RoleSummary" }).vm.$emit("load-streams");
    await flushPromises();

    expect([...new Set(ctl.streamCalls)].sort()).toEqual(["logs", "metrics"]);
    expect(wrapper.vm.previewPreset("dbm").status).toBe("ready");
  });
});

describe("EditRole - preset stream rows follow the latest read", () => {
  // Called directly: RoleSummary, which relays the panel's request, is hidden while a module is open.
  const loadStreams = async (wrapper) => {
    await wrapper.vm.loadPresetStreams();
    await flushPromises();
  };

  it("rebuilds the metrics rows when Retry succeeds after a failed refresh", async () => {
    ctl.metricStreams = [{ name: "cpu" }];
    const wrapper = await mountEditRole();
    await loadStreams(wrapper);
    expect(wrapper.vm.previewPreset("dbm").noMatchingStreams).toBe(true);

    ctl.metricStreams = [{ name: "cpu" }, { name: "postgresql_backends" }];
    ctl.failStreamTypes = ["metrics"];
    await loadStreams(wrapper);
    expect(wrapper.vm.previewPreset("dbm").status).toBe("failed");

    ctl.failStreamTypes = [];
    await loadStreams(wrapper);
    expect(wrapper.vm.previewPreset("dbm").adds).toContain("metrics:postgresql_backends:AllowGet");
  });

  it("rebuilds rows the Metrics module loaded earlier on the first preset lookup", async () => {
    ctl.metricStreams = [{ name: "cpu" }];
    const wrapper = await mountEditRole();
    wrapper.vm.activeModule = "stream";
    await flushPromises();
    const metrics = wrapper.vm.activeModuleView.entities.find((row) => row.name === "metrics");
    await wrapper.vm.getResourceEntities(metrics);
    expect(metrics.entities.map((row) => row.name)).toEqual(["cpu"]);

    ctl.metricStreams = [{ name: "cpu" }, { name: "postgresql_backends" }];
    await loadStreams(wrapper);

    expect(wrapper.vm.previewPreset("dbm").adds).toContain("metrics:postgresql_backends:AllowGet");
  });
});

describe("EditRole - save while a preset is staging", () => {
  // DBM waits on the metrics list; a save built before it lands would commit its grants unsent.
  it("sends the preset's grants when Save is clicked mid-apply", async () => {
    const { updateRole } = await import("@/services/iam");
    const wrapper = await mountEditRole();
    vi.mocked(updateRole).mockClear();

    const applying = wrapper.vm.applyPreset("dbm");
    expect(wrapper.vm.applyingPreset).toBe(true);
    const saving = wrapper.vm.saveRole();
    await Promise.all([applying, saving]);
    await flushPromises();

    expect(vi.mocked(updateRole)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateRole).mock.calls[0][0].payload.add).toEqual(
      expect.arrayContaining([{ object: "metrics:postgresql_backends", permission: "AllowGet" }]),
    );
    expect(wrapper.vm.addedPermissions).toEqual({});
  });

  // JSON would snapshot the grants before the preset lands, and Save would then stage that stale snapshot over them.
  it("holds the Table and JSON switch until the preset lands, then saves its grants", async () => {
    const { updateRole } = await import("@/services/iam");
    const wrapper = await mountEditRole();
    const viewSwitch = () => wrapper.findComponent({ name: "PermissionsViewSwitch" });
    let release;
    ctl.streamGate = new Promise((resolve) => {
      release = resolve;
    });
    vi.mocked(updateRole).mockClear();

    const applying = wrapper.vm.applyPreset("dbm");
    await flushPromises();
    expect(wrapper.vm.applyingPreset).toBe(true);
    expect(viewSwitch().props("disabled")).toBe(true);
    viewSwitch().vm.$emit("update:modelValue", "json");
    await flushPromises();
    expect(wrapper.vm.permissionsUiType).toBe("table");

    const saving = wrapper.vm.saveRole();
    release();
    await Promise.all([applying, saving]);
    await flushPromises();

    expect(vi.mocked(updateRole)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateRole).mock.calls[0][0].payload.add).toEqual(
      expect.arrayContaining([{ object: "metrics:postgresql_backends", permission: "AllowGet" }]),
    );
    expect(viewSwitch().props("disabled")).toBe(false);
  });

  it("holds preset Add off while a save is in flight", async () => {
    const { updateRole } = await import("@/services/iam");
    const wrapper = await mountEditRole();
    const summary = () => wrapper.findComponent({ name: "RoleSummary" });
    let finish;
    vi.mocked(updateRole).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    wrapper.vm.updatePermissionMappings("logs:app:AllowGet");

    const saving = wrapper.vm.saveRole();
    await flushPromises();
    expect(summary().props("applying")).toBe(true);

    finish({ data: { code: 200 } });
    await saving;
    await flushPromises();
    expect(summary().props("applying")).toBe(false);
  });
});

describe("EditRole - nothing stages while a save is in flight", () => {
  // The payload is built before the PUT, so a key staged after it would be committed as saved unsent.
  it("ignores Add All, Undo, pane clicks and a view switch until the PUT settles", async () => {
    const { updateRole } = await import("@/services/iam");
    const wrapper = await mountEditRole();
    const drawer = () => wrapper.findComponent({ name: "UnsavedChangesDrawer" });
    const pane = () => wrapper.findComponent({ name: "ModulePane" });
    const sent = `afolder:${ALL}:AllowAll`;
    const streamsList = `stream:${ALL}:AllowList`;
    let finish;
    vi.mocked(updateRole).mockClear();
    vi.mocked(updateRole).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    wrapper.vm.activeModule = "stream";
    await flushPromises();
    const metrics = wrapper.vm.activeModuleView.entities.find((row) => row.name === "metrics");
    wrapper.vm.updatePermissionMappings(sent);

    const saving = wrapper.vm.saveRole();
    await flushPromises();
    expect(drawer().props("saving")).toBe(true);
    drawer().vm.$emit("add", [streamsList, `destination:${ALL}:AllowList`]);
    drawer().vm.$emit("undo", [sent]);
    pane().vm.$emit("change", { row: metrics, permission: "AllowList", newValue: true });
    wrapper.findComponent({ name: "PermissionsViewSwitch" }).vm.$emit("update:modelValue", "json");
    await flushPromises();

    finish({ data: { code: 200 } });
    await saving;
    await flushPromises();

    expect(vi.mocked(updateRole)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateRole).mock.calls[0][0].payload.add).toEqual([
      { object: `afolder:${ALL}`, permission: "AllowAll" },
    ]);
    expect([...wrapper.vm.selectedPermissionsHash]).toEqual([sent]);
    expect(wrapper.vm.addedPermissions).toEqual({});
    expect(wrapper.vm.removedPermissions).toEqual({});
    expect(wrapper.vm.permissionsUiType).toBe("table");

    drawer().vm.$emit("add", [streamsList]);
    expect(drawer().props("saving")).toBe(false);
    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([streamsList]);
  });
});