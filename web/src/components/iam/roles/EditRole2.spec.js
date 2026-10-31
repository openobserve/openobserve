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

// Per-tab dirty state
describe("EditRole - dirty state", () => {
  it("is not dirty on initial load", async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.vm.isAnyDirty).toBe(false);
    const permTab = wrapper.vm.tabs.find((t) => t.value === "permissions");
    const usersTab = wrapper.vm.tabs.find((t) => t.value === "users");
    expect(permTab.dirty).toBe(false);
    expect(usersTab.dirty).toBe(false);
  });

  it("marks the permissions tab dirty after a permission change", async () => {
    const wrapper = await mountEditRole();
    const resource = wrapper.vm.permissionsState.permissions[0];
    wrapper.vm.handlePermissionChange(resource, "AllowGet");
    await wrapper.vm.$nextTick();
    const permTab = wrapper.vm.tabs.find((t) => t.value === "permissions");
    expect(permTab.dirty).toBe(true);
    expect(wrapper.vm.isAnyDirty).toBe(true);
  });

  it("marks the users tab dirty when a user is staged for addition", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.addedUsers.add("new@example.com");
    await wrapper.vm.$nextTick();
    const usersTab = wrapper.vm.tabs.find((t) => t.value === "users");
    expect(usersTab.dirty).toBe(true);
    expect(wrapper.vm.isAnyDirty).toBe(true);
  });

  it("tracks Users and Service Accounts dirty state independently", async () => {
    const wrapper = await mountEditRole();

    // Staging a service account must NOT mark the Users tab dirty.
    wrapper.vm.addedServiceAccounts.add("svc@example.com");
    await wrapper.vm.$nextTick();
    const usersTab = wrapper.vm.tabs.find((t) => t.value === "users");
    const saTab = wrapper.vm.tabs.find((t) => t.value === "serviceAccounts");
    expect(saTab?.dirty).toBe(true);
    expect(usersTab.dirty).toBe(false);
    expect(wrapper.vm.isAnyDirty).toBe(true);

    // ...and vice-versa.
    wrapper.vm.addedServiceAccounts.clear();
    wrapper.vm.addedUsers.add("user@example.com");
    await wrapper.vm.$nextTick();
    const usersTab2 = wrapper.vm.tabs.find((t) => t.value === "users");
    const saTab2 = wrapper.vm.tabs.find((t) => t.value === "serviceAccounts");
    expect(usersTab2.dirty).toBe(true);
    expect(saTab2?.dirty).toBe(false);
  });
});

// Read-only preset seeding
describe("EditRole - read-only preset", () => {
  it("seeds AllowList + AllowGet on visible top-level resources", async () => {
    router.currentRoute.value.query = { preset: "readonly" };
    const wrapper = await mountEditRole();
    router.currentRoute.value.query = {};

    // At least one resource should now carry pending read-only permissions.
    const added = Object.values(wrapper.vm.addedPermissions);
    expect(added.length).toBeGreaterThan(0);
    const perms = added.map((p) => p.permission);
    expect(perms).toContain("AllowGet");
    expect(perms.every((p) => p === "AllowGet" || p === "AllowList")).toBe(true);
  });

  it("does not seed permissions without the readonly preset", async () => {
    router.currentRoute.value.query = {};
    const wrapper = await mountEditRole();
    expect(Object.keys(wrapper.vm.addedPermissions).length).toBe(0);
  });
});

describe("EditRole - dbm viewer preset", () => {
  const mountWithDbmPreset = async () => {
    router.currentRoute.value.query = { preset: "dbm" };
    const wrapper = await mountEditRole();
    await flushPromises();
    router.currentRoute.value.query = {};
    return wrapper;
  };

  afterEach(() => {
    ctl.metricStreams = null;
  });

  it("stages AllowGet on the curated DBM metric streams present in the org", async () => {
    const wrapper = await mountWithDbmPreset();

    expect(Object.values(wrapper.vm.addedPermissions)).toEqual(
      expect.arrayContaining([
        { object: "metrics:postgresql_backends", permission: "AllowGet" },
        { object: "metrics:mysql_threads", permission: "AllowGet" },
      ]),
    );
  });

  // A leaf stream row hides its AllowList checkbox, so seeding it would stage a grant the user cannot see or untick.
  it("does not stage a permission the table hides on a stream row", async () => {
    const wrapper = await mountWithDbmPreset();
    const rows = wrapper.vm.heavyResourceEntities["metrics"] ?? [];
    const seeded = rows.find((r) => r.name === "postgresql_backends");
    expect(seeded.permission.AllowList.show).toBe(false);
    expect(
      Object.values(wrapper.vm.addedPermissions).some(
        (p) => p.permission === "AllowList" && p.object.startsWith("metrics:postgresql_"),
      ),
    ).toBe(false);
  });

  // GET /{org}/streams checks `metrics:_all_<org>`, and FGA's LIST relation does
  // not accept ALLOW_GET — without this grant the Metrics tab cannot load its
  // stream list at all.
  it("stages AllowList on the metrics stream-type node", async () => {
    const wrapper = await mountWithDbmPreset();

    expect(Object.values(wrapper.vm.addedPermissions)).toEqual(
      expect.arrayContaining([{ object: "metrics:_all_default", permission: "AllowList" }]),
    );
  });

  // ALLOW_GET on `metrics:_all_<org>` reads as a wildcard over every metric stream in the org, which would make the curated per-stream grants decorative.
  it("never stages AllowGet on the metrics stream-type node", async () => {
    const wrapper = await mountWithDbmPreset();

    expect(Object.values(wrapper.vm.addedPermissions)).not.toContainEqual({
      object: "metrics:_all_default",
      permission: "AllowGet",
    });
  });

  // db_monitoring is a module-level toggle with no entities of its own — it
  // authorizes every /{org}/db_monitoring/* endpoint (the DB-load and
  // health-ratio panels riding _o2_dbm_server), a separate grant object from
  // the raw metrics:<name> streams above.
  it("stages AllowList and AllowGet on the db_monitoring module resource", async () => {
    const wrapper = await mountWithDbmPreset();

    expect(Object.values(wrapper.vm.addedPermissions)).toEqual(
      expect.arrayContaining([
        { object: "db_monitoring:_all_default", permission: "AllowList" },
        { object: "db_monitoring:_all_default", permission: "AllowGet" },
      ]),
    );
  });

  it("ticks the metrics type-node checkboxes so the grant is reviewable", async () => {
    const wrapper = await mountWithDbmPreset();

    const streamResource = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "stream",
    );
    const metricsNode = streamResource.entities.find((e) => e.name === "metrics");
    expect(metricsNode.type).toBe("Type");
    expect(metricsNode.permission.AllowList.show).toBe(true);
    expect(metricsNode.permission.AllowList.value).toBe(true);
    expect(metricsNode.permission.AllowGet.value).toBe(false);
  });

  it("does not grant a wildcard beyond metrics and db_monitoring", async () => {
    const wrapper = await mountWithDbmPreset();

    const objects = Object.values(wrapper.vm.addedPermissions).map((p) => p.object);
    expect(objects).not.toContain("stream:_all_default");
    expect(objects).not.toContain("logs:_all_default");
    expect(objects).not.toContain("traces:_all_default");
  });

  it("stages exactly the curated streams plus the metrics and db_monitoring grants", async () => {
    const wrapper = await mountWithDbmPreset();

    expect(
      [...new Set(Object.values(wrapper.vm.addedPermissions).map((p) => p.object))].sort(),
    ).toEqual([
      "db_monitoring:_all_default",
      "metrics:_all_default",
      "metrics:mysql_threads",
      "metrics:postgresql_backends",
    ]);
  });

  it("writes the seeded permissions into the save payload", async () => {
    const { updateRole } = await import("@/services/iam");
    const wrapper = await mountWithDbmPreset();

    await wrapper.vm.saveRole();
    await flushPromises();

    const payload = vi.mocked(updateRole).mock.calls[0][0].payload;
    expect(payload.remove).toEqual([]);
    expect(payload.add).toEqual(
      expect.arrayContaining([
        { object: "db_monitoring:_all_default", permission: "AllowList" },
        { object: "db_monitoring:_all_default", permission: "AllowGet" },
        { object: "metrics:_all_default", permission: "AllowList" },
        { object: "metrics:postgresql_backends", permission: "AllowGet" },
        { object: "metrics:mysql_threads", permission: "AllowGet" },
      ]),
    );
    expect(payload.add).not.toContainEqual({
      object: "metrics:_all_default",
      permission: "AllowGet",
    });
    expect(payload.add).toHaveLength(5);
  });

  it("reports how many curated streams matched this org", async () => {
    mockToast.mockClear();
    await mountWithDbmPreset();

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "info",
        message: expect.stringContaining("2 of 3"),
      }),
    );
  });

  it("reports the zero-match case instead of implying success", async () => {
    ctl.metricStreams = [{ name: "cpu" }];
    mockToast.mockClear();

    const wrapper = await mountWithDbmPreset();
    const objects = Object.values(wrapper.vm.addedPermissions).map((p) => p.object);
    expect(objects).not.toContain("metrics:_all_default");
    expect(objects).toContain("db_monitoring:_all_default");

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "warning",
        message: expect.stringContaining("None"),
      }),
    );
  });

  it("does not seed when the role already has permissions", async () => {
    const { getAllRolePermissions } = await import("@/services/iam");
    vi.mocked(getAllRolePermissions).mockResolvedValueOnce({
      data: [{ object: "stream:_all_default", permission: "AllowGet" }],
    });

    const wrapper = await mountWithDbmPreset();
    expect(Object.keys(wrapper.vm.addedPermissions).length).toBe(0);
  });

  it("does not seed permissions without the dbm preset", async () => {
    router.currentRoute.value.query = {};
    const wrapper = await mountEditRole();
    expect(Object.keys(wrapper.vm.addedPermissions).length).toBe(0);
  });
});