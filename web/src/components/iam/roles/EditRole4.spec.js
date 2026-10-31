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

const mountWithSaved = async (perms) => {
  ctl.rolePermissions = perms;
  return mountEditRole();
};

const mountWithPreset = async (preset) => {
  router.currentRoute.value.query = { preset };
  const wrapper = await mountEditRole();
  await flushPromises();
  router.currentRoute.value.query = {};
  return wrapper;
};

const stagedObjects = (wrapper) => Object.values(wrapper.vm.addedPermissions).map((p) => p.object);

describe("EditRole - all modules", () => {
  const openAllModules = async (wrapper) => {
    wrapper.vm.activeModule = "__all__";
    await flushPromises();
  };

  it("lists one row per rail module", async () => {
    const wrapper = await mountEditRole();
    await openAllModules(wrapper);

    const keys = wrapper.vm.railModules.map((module) => module.key);
    expect(keys.length).toBeGreaterThan(1);
    // One row per module and nothing else: a stream type or folder here would be a second, narrower grant.
    expect(wrapper.vm.paneView.entities.map((row) => row.name)).toEqual(keys);
    keys.forEach((key) => {
      expect(
        wrapper
          .find(`[data-test="edit-role-permissions-table-body-row-${key}-col-AllowAll-checkbox"]`)
          .exists(),
      ).toBe(true);
    });
  });

  // rum_analytics hides List, so ticking the column must skip it rather than stage a grant OpenFGA rejects.
  it("stages the module-wide List grant on every module that offers it from one header tick", async () => {
    ctl.resources = RUM_RESOURCE_CATALOG;
    const wrapper = await mountEditRole();
    await openAllModules(wrapper);

    await wrapper
      .find('[data-test="edit-role-module-pane-bulk-AllowList"] button[role="checkbox"]')
      .trigger("click");
    await flushPromises();

    const expected = wrapper.vm.railModules
      .map((module) => module.key)
      .filter((key) => key !== "rum_analytics")
      .map((key) => `${key}:${ALL}:AllowList`);
    expect(Object.keys(wrapper.vm.addedPermissions).sort()).toEqual(expected.sort());
    expect(
      wrapper
        .find('[data-test="edit-role-module-pane-bulk-AllowList"] button[role="checkbox"]')
        .attributes("aria-checked"),
    ).toBe("true");
  });

  // A role that holds one stream must still show it on the Streams row, or Selected hides the module.
  it("badges a module row with the grants held inside it", async () => {
    ctl.rolePermissions = [{ object: "logs:app", permission: "AllowGet" }];
    const wrapper = await mountEditRole();
    await openAllModules(wrapper);

    expect(wrapper.find('[data-test="edit-role-module-pane-inside-stream"]').text()).toBe(
      String(i18n.global.t("iam.editRole.grantedInsideCount", { count: 1 })),
    );
  });

  // A module row switches the rail to that module; treating it as a folder would leave All Modules on screen.
  it("opens the module itself when its row is clicked", async () => {
    const wrapper = await mountEditRole();
    await openAllModules(wrapper);

    await wrapper.find('[data-test="edit-role-module-pane-open-stream"]').trigger("click");
    await flushPromises();

    expect(wrapper.vm.activeModule).toBe("stream");
    expect(wrapper.vm.openFolder).toBeNull();
    expect(wrapper.vm.activeModuleView.entities.map((row) => row.name).sort()).toEqual([
      "index",
      "logs",
      "metrics",
      "profiles",
      "traces",
    ]);
    expect(wrapper.find('[data-test^="edit-role-module-pane-bulk-"]').exists()).toBe(false);
  });
});

describe("EditRole - Review Changes footer", () => {
  const reviewButton = (wrapper) => wrapper.find('[data-test="edit-role-review-changes-btn"]');

  it("disables Review Changes with no change and nothing missing", async () => {
    const wrapper = await mountEditRole();

    expect(reviewButton(wrapper).attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-test="edit-role-unsaved-count"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="edit-role-review-missing-icon"]').exists()).toBe(false);
  });

  it("counts the staged changes on the badge", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.updatePermissionMappings("logs:app:AllowGet");
    await flushPromises();

    expect(reviewButton(wrapper).attributes("disabled")).toBeUndefined();
    expect(wrapper.find('[data-test="edit-role-unsaved-count"]').text()).toBe("1");
  });

  // A saved dashboard folder with no stream grant cannot load panels, so the role is flagged with nothing staged.
  it("enables Review Changes with a warning when a module is missing and nothing is staged", async () => {
    const wrapper = await mountWithSaved([{ object: "dfolder:f1", permission: "AllowGet" }]);
    await flushPromises();

    expect(reviewButton(wrapper).attributes("disabled")).toBeUndefined();
    expect(wrapper.find('[data-test="edit-role-review-missing-icon"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="edit-role-unsaved-count"]').exists()).toBe(false);
    expect(
      wrapper
        .findAllComponents({ name: "OTooltip" })
        .some(
          (tooltip) =>
            tooltip.props("content") ===
            i18n.global.t("iam.editRole.reviewMissingTooltip", { count: 1 }, 1),
        ),
    ).toBe(true);
  });

  // A missing module is advice, not an edit, so it must not hold the user on the page.
  it("does not count a missing module as unsaved", async () => {
    const wrapper = await mountWithSaved([{ object: "dfolder:f1", permission: "AllowGet" }]);

    expect(wrapper.vm.companionGaps.length).toBe(1);
    expect(wrapper.vm.isAnyDirty).toBe(false);
  });
});

describe("EditRole - review drawer wiring", () => {
  const drawer = (wrapper) => wrapper.findComponent({ name: "UnsavedChangesDrawer" });

  it("hands the drawer the grouped changes and the missing modules", async () => {
    const wrapper = await mountWithSaved([{ object: "dfolder:f1", permission: "AllowGet" }]);
    wrapper.vm.updatePermissionMappings("logs:app:AllowGet");
    await flushPromises();

    expect(
      drawer(wrapper)
        .props("groups")
        .map((group) => group.key),
    ).toEqual(["stream"]);
    expect(
      drawer(wrapper)
        .props("gaps")
        .map((gap) => gap.module),
    ).toEqual(["stream"]);
  });

  // Toggle revokes a held key, so a second Add must not take the grant back off.
  it("adds a companion grant once, however often Add is clicked", async () => {
    const wrapper = await mountEditRole();
    const key = `stream:${ALL}:AllowList`;

    drawer(wrapper).vm.$emit("add", [key]);
    drawer(wrapper).vm.$emit("add", [key]);
    await flushPromises();

    expect([...wrapper.vm.selectedPermissionsHash]).toEqual([key]);
    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([key]);
  });

  it("restores a grant staged for removal rather than adding it twice", async () => {
    const key = `stream:${ALL}:AllowList`;
    const wrapper = await mountWithSaved([{ object: `stream:${ALL}`, permission: "AllowList" }]);
    wrapper.vm.updatePermissionMappings(key);

    drawer(wrapper).vm.$emit("add", [key]);
    await flushPromises();

    expect(wrapper.vm.removedPermissions).toEqual({});
    expect(wrapper.vm.addedPermissions).toEqual({});
    expect(wrapper.vm.selectedPermissionsHash.has(key)).toBe(true);
  });

  it("closes the drawer and opens the module for Open Streams", async () => {
    const wrapper = await mountWithSaved([{ object: "dfolder:f1", permission: "AllowGet" }]);
    wrapper.vm.activeTab = "users";
    wrapper.vm.unsavedDrawerOpen = true;

    drawer(wrapper).vm.$emit("open-module", "stream");
    await flushPromises();

    expect(wrapper.vm.unsavedDrawerOpen).toBe(false);
    expect(wrapper.vm.activeTab).toBe("permissions");
    expect(wrapper.vm.activeModule).toBe("stream");
  });

  it("keeps the drawer open after Undo All while a module is still missing", async () => {
    const wrapper = await mountWithSaved([{ object: "dfolder:f1", permission: "AllowGet" }]);
    wrapper.vm.updatePermissionMappings("logs:app:AllowGet");
    wrapper.vm.unsavedDrawerOpen = true;
    await flushPromises();

    drawer(wrapper).vm.$emit("undo", ["logs:app:AllowGet"]);
    await flushPromises();

    expect(wrapper.vm.pendingChanges).toEqual([]);
    expect(wrapper.vm.unsavedDrawerOpen).toBe(true);
  });

  it("saves through the page's save path and closes the drawer", async () => {
    const { updateRole } = await import("@/services/iam");
    const wrapper = await mountEditRole();
    vi.mocked(updateRole).mockClear();
    wrapper.vm.updatePermissionMappings("logs:app:AllowGet");
    wrapper.vm.unsavedDrawerOpen = true;

    drawer(wrapper).vm.$emit("save");
    await flushPromises();

    expect(wrapper.vm.unsavedDrawerOpen).toBe(false);
    expect(vi.mocked(updateRole).mock.calls[0][0].payload.add).toEqual([
      { object: "logs:app", permission: "AllowGet" },
    ]);
  });
});

describe("EditRole - save toast", () => {
  useNavigationFixture();

  const toastAfterSave = async (vm) => {
    mockToast.mockClear();
    await vm.saveRole();
    await flushPromises();
    return mockToast.mock.calls.map(([arg]) => arg);
  };

  it("names the changes and modules a save touched", async () => {
    const vm = await mountEditRoleVm();
    withSaved(vm, ["dfolder:f1:AllowGet"]);
    vm.updatePermissionMappings("logs:app:AllowGet");
    vm.updatePermissionMappings("metrics:cpu:AllowGet");
    vm.updatePermissionMappings("dfolder:f1:AllowGet");

    expect(await toastAfterSave(vm)).toEqual([
      { variant: "success", message: "Saved 3 changes in 2 modules." },
    ]);
  });

  it("keeps the plain success message for a members-only save", async () => {
    const vm = await mountEditRoleVm();
    vm.addedUsers.add("new@example.com");

    expect(await toastAfterSave(vm)).toEqual([
      { variant: "success", message: i18n.global.t("iam.editRole.updateSuccess") },
    ]);
  });
});