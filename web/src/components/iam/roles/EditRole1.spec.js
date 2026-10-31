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

// 1. Basic rendering
describe("EditRole - basic rendering", () => {
  it("renders page and title with role name", async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.find('[data-test="edit-role-page"]').exists()).toBe(true);
    // Role name now renders as the OPageHeader title (row 1).
    expect(wrapper.find(".app-page-header h1").text()).toContain("Admin");
  });

  it("renders tabs component", async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.find('[data-test="edit-role-tabs"]').exists()).toBe(true);
  });

  it.skip("shows loading spinner during initial fetch", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.isFetchingInitialRoles = true;
    await flushPromises();
    expect(wrapper.find('[data-test="edit-role-page-loading-spinner"]').exists()).toBe(true);
  });
});

// 2. Tabs and activeTab switching
describe("EditRole - tabs behavior", () => {
  it("default tab is permissions", async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.vm.activeTab).toBe("permissions");
  });

  it("switches to users tab", async () => {
    const wrapper = await mountEditRole();
    await wrapper.find(".tab-users").trigger("click");
    expect(wrapper.vm.activeTab).toBe("users");
  });

  it("switches to service accounts when available", async () => {
    const wrapper = await mountEditRole();
    await wrapper.find(".tab-serviceAccounts").trigger("click");
    expect(wrapper.vm.activeTab).toBe("serviceAccounts");
  });
});

// 4. Permission mapping helpers
describe("EditRole - permission mappings", () => {
  it("getPermissionHash formats correctly for default entity", async () => {
    const wrapper = await mountEditRole();
    const h = wrapper.vm.getPermissionHash("stream", "AllowAll");
    expect(h.startsWith("stream:_all_")).toBe(true);
  });

  it("updatePermissionMappings adds new permission when not present", async () => {
    const wrapper = await mountEditRole();
    const hash = "stream:_all_default:AllowGet";
    wrapper.vm.updatePermissionMappings(hash);
    expect(wrapper.vm.addedPermissions[hash]).toBeTruthy();
    expect(wrapper.vm.selectedPermissionsHash.has(hash)).toBe(true);
  });

  it("updatePermissionMappings toggles removal for existing permission", async () => {
    const wrapper = await mountEditRole();
    const hash = "stream:_all_default:AllowPut";
    wrapper.vm.permissionsHash = new Set([hash]);
    wrapper.vm.selectedPermissionsHash = new Set([hash]);
    // remove existing
    wrapper.vm.updatePermissionMappings(hash);
    expect(wrapper.vm.removedPermissions[hash]).toBeTruthy();
    expect(wrapper.vm.selectedPermissionsHash.has(hash)).toBe(false);
  });

  it("updateEntityPermission sets entity permission value based on selection", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.selectedPermissionsHash = new Set(["logs:app:AllowGet"]);
    const resource = { entities: [{ name: "app", permission: { AllowGet: { value: false } } }] };
    wrapper.vm.updateEntityPermission(resource, "logs", "app", "AllowGet");
    expect(resource.entities[0].permission.AllowGet.value).toBe(true);
  });
});

// 6. Entities & resources population helpers
describe("EditRole - entities population", () => {
  it("updateResourceEntities pushes entities and respects displayNameKey", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissionsState.permissions = [
      { name: "role", entities: [], permission: {}, childs: [], resourceName: "role" },
    ];
    wrapper.vm.updateResourceEntities("role", [], [{ name: "Admin" }], false, "name");
    expect(wrapper.vm.permissionsState.permissions[0].entities.length).toBeGreaterThan(0);
  });

  it("updateEntityEntities populates entities for resource children", async () => {
    const wrapper = await mountEditRole();
    const resource = { name: "dfolder", childName: "dashboard", entities: [], permission: {} };
    wrapper.vm.selectedPermissionsHash = new Set();
    wrapper.vm.updateEntityEntities(
      resource,
      ["dashboardId"],
      [{ dashboardId: "d1", title: "D1" }],
      false,
      "title",
    );
    expect(resource.entities.length).toBe(1);
  });

  it("updateResourceResource adds typed child under parent", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissionsState.permissions = [
      { name: "stream", resourceName: "stream", entities: [], childs: [], permission: {} },
    ];
    wrapper.vm.updateResourceResource(
      "logs",
      "stream",
      ["stream_type"],
      [{ stream_type: "logs", name: "Logs" }],
      true,
      "name",
    );
    expect(wrapper.vm.permissionsState.permissions[0].entities.length).toBe(1);
  });

  it("getResourceEntities loads synthetic environments keyed by name", async () => {
    const wrapper = await mountEditRole();
    const resource = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "synthetic_environment",
    );

    await wrapper.vm.getResourceEntities(resource);

    expect(syntheticsService.listEnvironments).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
    );
    expect(resource.entities.map((e) => e.name)).toEqual(["staging", "global"]);
    expect(resource.is_loading).toBe(false);
  });

  it("getResourceEntities loads provider entities", async () => {
    const wrapper = await mountEditRole();
    const resource = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "provider",
    );

    await wrapper.vm.getResourceEntities(resource);

    expect(onlineEvalsService.providers.list).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
    );
    expect(resource.entities[0]).toMatchObject({
      name: "openai",
      display_name: "OpenAI",
      resourceName: "provider",
    });
    expect(resource.is_loading).toBe(false);
  });

  it("getResourceEntities loads score config entities", async () => {
    const wrapper = await mountEditRole();
    const resource = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "score_config",
    );

    await wrapper.vm.getResourceEntities(resource);

    expect(onlineEvalsService.scoreConfigs.list).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
    );
    expect(resource.entities[0]).toMatchObject({
      name: "quality-score",
      display_name: "Quality Score",
      resourceName: "score_config",
    });
    expect(resource.is_loading).toBe(false);
  });

  it("getResourceEntities loads scorer entities", async () => {
    const wrapper = await mountEditRole();
    const resource = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "scorer",
    );

    await wrapper.vm.getResourceEntities(resource);

    expect(onlineEvalsService.scorers.list).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
    );
    expect(resource.entities[0]).toMatchObject({
      name: "llm-judge",
      display_name: "LLM Judge",
      resourceName: "scorer",
    });
    expect(resource.is_loading).toBe(false);
  });

  it("getResourceEntities loads eval job entities", async () => {
    const wrapper = await mountEditRole();
    const resource = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "eval_job",
    );

    await wrapper.vm.getResourceEntities(resource);

    expect(onlineEvalsService.jobs.list).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
    );
    expect(resource.entities[0]).toMatchObject({
      name: "daily-eval",
      display_name: "Daily Eval",
      resourceName: "eval_job",
    });
    expect(resource.is_loading).toBe(false);
  });

  it("getResourceEntities loads annotation queue entities", async () => {
    const wrapper = await mountEditRole();
    const resource = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "annotation_queue",
    );

    await wrapper.vm.getResourceEntities(resource);

    expect(llmQueuesService.list).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);
    expect(resource.entities[0]).toMatchObject({
      name: "review-queue",
      display_name: "Review Queue",
      resourceName: "annotation_queue",
    });
    expect(resource.is_loading).toBe(false);
  });

  it("getResourceEntities loads dataset entities", async () => {
    const wrapper = await mountEditRole();
    const resource = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "dataset",
    );

    await wrapper.vm.getResourceEntities(resource);

    expect(llmDatasetsService.list).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
    );
    expect(resource.entities[0]).toMatchObject({
      name: "golden-set",
      display_name: "Golden Set",
      resourceName: "dataset",
    });
    expect(resource.is_loading).toBe(false);
  });
});

// 7. Role save and cancel
describe("EditRole - save and cancel", () => {
  it("cancelPermissionsUpdate navigates to roles list", async () => {
    const wrapper = await mountEditRole();
    const spy = vi.spyOn(router, "push");
    await wrapper.vm.cancelPermissionsUpdate();
    expect(spy).toHaveBeenCalledWith({
      name: "roles",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
    });
  });

  it("saveRole notifies info when no changes", async () => {
    // The component uses toast() from @/lib/feedback/Toast/useToast.
    const wrapper = await mountEditRole();
    mockToast.mockClear();

    await wrapper.vm.saveRole();

    // toast is called with variant: "info" when there are no changes
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "info" }));
  });

  it("saveRole calls updateRole and resets added/removed permissions", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.updatePermissionMappings("logs:app:AllowGet");
    mockToast.mockClear();

    await wrapper.vm.saveRole();
    await flushPromises();

    expect(mockToast).toHaveBeenCalledWith({
      variant: "success",
      message: "Saved 1 change in 1 module.",
    });
    expect(Object.keys(wrapper.vm.addedPermissions).length).toBe(0);
  });
});

// 8. Data fetch pipeline
describe("EditRole - data fetch pipeline", () => {
  it("getRoleDetails loads resources and users", async () => {
    const wrapper = await mountEditRole();
    await wrapper.vm.getRoleDetails();
    await flushPromises();
    expect(wrapper.vm.permissionsState.resources.length).toBeGreaterThan(0);
    expect(wrapper.vm.roleUsers.length).toBeGreaterThan(0);
  });
});

// 9. JSON sync flows
describe("EditRole - JSON editor flows", () => {
  it("updateJsonInTable updates mappings based on JSON string", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissionsJsonValue = JSON.stringify([
      { object: "logs:app", permission: "AllowGet" },
    ]);
    await wrapper.vm.updateJsonInTable();
    expect(wrapper.vm.selectedPermissionsHash.size).toBeGreaterThan(0);
  });
});

// 10. Misc micro-tests to exceed 50 cases
describe("EditRole - micro validations", () => {
  it("decodePermission splits correctly", async () => {
    const wrapper = await mountEditRole();
    const { resource, entity } = wrapper.vm.decodePermission("logs:app");
    expect(resource).toBe("logs");
    expect(entity).toBe("app");
  });

  it("savePermissionHash builds sets from permissions", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissions = [{ object: "logs:_all_default", permission: "AllowGet" }];
    wrapper.vm.savePermissionHash();
    expect(wrapper.vm.permissionsHash.size).toBe(1);
    expect(wrapper.vm.selectedPermissionsHash.size).toBe(1);
  });

  it("updateActiveTab ignores falsy input", async () => {
    const wrapper = await mountEditRole();
    await wrapper.vm.updateActiveTab("");
    expect(wrapper.vm.activeTab).toBeTruthy();
  });

  it("getOrgId returns store selected org identifier", async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.vm.getOrgId()).toBe(store.state.selectedOrganization.identifier);
  });
});