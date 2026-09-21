import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { queryClient } from "@/composables/query/queryClient";

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
}));

// Mock composable useStreams
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn(async (type) => {
      const map = {
        logs: { list: [{ name: "app" }, { name: "sys" }] },
        metrics: {
          list: ctl.metricStreams ?? [
            { name: "cpu" },
            { name: "mem" },
            { name: "postgresql_backends" },
            { name: "mysql_threads" },
          ],
        },
        traces: { list: [{ name: "svc-a" }] },
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
];

// The navigation suite pins exact rail and module expectations against this trimmed catalogue.
const NAVIGATION_RESOURCE_CATALOG = RESOURCE_CATALOG.slice(0, 11);

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
  // resourcesQuery is cached by TanStack, so without this the second mount
  // never re-calls getResources and the call-order pins go stale.
  queryClient.clear();
  ctl.callOrder = [];
  ctl.rolePermissions = [];
  ctl.resourcesError = null;
  ctl.resources = RESOURCE_CATALOG;
  ctl.metricStreams = null;
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

    // toast is called with variant: "success" after a successful update
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
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

  it("modifyResourcePermissions hides some settings flags", async () => {
    const wrapper = await mountEditRole();
    const r = {
      resourceName: "settings",
      permission: {
        AllowList: { show: true },
        AllowDelete: { show: true },
        AllowPost: { show: true },
      },
    };
    wrapper.vm.modifyResourcePermissions(r);
    expect(r.permission.AllowList.show).toBe(false);
    expect(r.permission.AllowDelete.show).toBe(false);
    expect(r.permission.AllowPost.show).toBe(false);
  });

  it("getDefaultResource returns top_level type", async () => {
    const wrapper = await mountEditRole();
    const r = wrapper.vm.getDefaultResource();
    expect(r.top_level).toBe(true);
    expect(r.type).toBe("Type");
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

  it("getResourceByName finds nested resource", async () => {
    const wrapper = await mountEditRole();
    const permissions = [
      { resourceName: "stream", childs: [{ resourceName: "logs" }], entities: [], permission: {} },
    ];
    const found = wrapper.vm.getResourceByName(permissions, "logs");
    expect(found?.resourceName).toBe("logs");
  });

  it("setDefaultPermissions organizes resources and filters children from top level", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissionsState.resources = [
      { key: "stream", display_name: "Streams", has_entities: true, top_level: true },
      { key: "logs", display_name: "Logs", has_entities: true, parent: "stream", top_level: false },
    ];
    wrapper.vm.setDefaultPermissions();
    expect(wrapper.vm.permissionsState.permissions.some((r) => r.resourceName === "stream")).toBe(
      true,
    );
  });
});

// 11. New resource type permission flags (logs_pattern, logs_insights, logs_cache)
describe("EditRole - modifyResourcePermissions new resource types", () => {
  const makeResource = (name) => ({
    resourceName: name,
    permission: {
      AllowAll: { show: true },
      AllowList: { show: true },
      AllowGet: { show: true },
      AllowDelete: { show: true },
      AllowPost: { show: true },
      AllowPut: { show: true },
    },
  });

  it("logs_pattern hides AllowList, AllowDelete, AllowPost, AllowPut", async () => {
    const wrapper = await mountEditRole();
    const r = makeResource("logs_pattern");
    wrapper.vm.modifyResourcePermissions(r);
    expect(r.permission.AllowList.show).toBe(false);
    expect(r.permission.AllowDelete.show).toBe(false);
    expect(r.permission.AllowPost.show).toBe(false);
    expect(r.permission.AllowPut.show).toBe(false);
  });

  it("logs_pattern keeps AllowAll and AllowGet visible", async () => {
    const wrapper = await mountEditRole();
    const r = makeResource("logs_pattern");
    wrapper.vm.modifyResourcePermissions(r);
    expect(r.permission.AllowAll.show).toBe(true);
    expect(r.permission.AllowGet.show).toBe(true);
  });

  it("logs_insights hides AllowList, AllowDelete, AllowPost, AllowPut", async () => {
    const wrapper = await mountEditRole();
    const r = makeResource("logs_insights");
    wrapper.vm.modifyResourcePermissions(r);
    expect(r.permission.AllowList.show).toBe(false);
    expect(r.permission.AllowDelete.show).toBe(false);
    expect(r.permission.AllowPost.show).toBe(false);
    expect(r.permission.AllowPut.show).toBe(false);
  });

  it("logs_insights keeps AllowAll and AllowGet visible", async () => {
    const wrapper = await mountEditRole();
    const r = makeResource("logs_insights");
    wrapper.vm.modifyResourcePermissions(r);
    expect(r.permission.AllowAll.show).toBe(true);
    expect(r.permission.AllowGet.show).toBe(true);
  });

  it("logs_cache hides AllowList, AllowGet, AllowPost, AllowPut", async () => {
    const wrapper = await mountEditRole();
    const r = makeResource("logs_cache");
    wrapper.vm.modifyResourcePermissions(r);
    expect(r.permission.AllowList.show).toBe(false);
    expect(r.permission.AllowGet.show).toBe(false);
    expect(r.permission.AllowPost.show).toBe(false);
    expect(r.permission.AllowPut.show).toBe(false);
  });

  it("logs_cache keeps AllowAll and AllowDelete visible", async () => {
    const wrapper = await mountEditRole();
    const r = makeResource("logs_cache");
    wrapper.vm.modifyResourcePermissions(r);
    expect(r.permission.AllowAll.show).toBe(true);
    expect(r.permission.AllowDelete.show).toBe(true);
  });

  it("logs_pattern and logs_insights have identical permission restrictions", async () => {
    const wrapper = await mountEditRole();
    const r1 = makeResource("logs_pattern");
    const r2 = makeResource("logs_insights");
    wrapper.vm.modifyResourcePermissions(r1);
    wrapper.vm.modifyResourcePermissions(r2);
    expect(r1.permission.AllowList.show).toBe(r2.permission.AllowList.show);
    expect(r1.permission.AllowDelete.show).toBe(r2.permission.AllowDelete.show);
    expect(r1.permission.AllowPost.show).toBe(r2.permission.AllowPost.show);
    expect(r1.permission.AllowPut.show).toBe(r2.permission.AllowPut.show);
    expect(r1.permission.AllowGet.show).toBe(r2.permission.AllowGet.show);
  });

  it("logs_cache hides AllowGet but logs_pattern does not", async () => {
    const wrapper = await mountEditRole();
    const rCache = makeResource("logs_cache");
    const rPattern = makeResource("logs_pattern");
    wrapper.vm.modifyResourcePermissions(rCache);
    wrapper.vm.modifyResourcePermissions(rPattern);
    expect(rCache.permission.AllowGet.show).toBe(false);
    expect(rPattern.permission.AllowGet.show).toBe(true);
  });

  it("logs_pattern hides AllowDelete but logs_cache does not", async () => {
    const wrapper = await mountEditRole();
    const rCache = makeResource("logs_cache");
    const rPattern = makeResource("logs_pattern");
    wrapper.vm.modifyResourcePermissions(rCache);
    wrapper.vm.modifyResourcePermissions(rPattern);
    expect(rPattern.permission.AllowDelete.show).toBe(false);
    expect(rCache.permission.AllowDelete.show).toBe(true);
  });

  it("unrelated resource type is not affected by new type checks", async () => {
    const wrapper = await mountEditRole();
    const r = makeResource("some_other_resource");
    wrapper.vm.modifyResourcePermissions(r);
    // No flags should be hidden for an unrelated resource type
    expect(r.permission.AllowList.show).toBe(true);
    expect(r.permission.AllowGet.show).toBe(true);
    expect(r.permission.AllowDelete.show).toBe(true);
    expect(r.permission.AllowPost.show).toBe(true);
    expect(r.permission.AllowPut.show).toBe(true);
  });
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

describe("EditRole - kubernetes viewer preset", () => {
  beforeEach(() => {
    ctl.metricStreams = [
      { name: "cpu" },
      { name: "mem" },
      { name: "k8s_pod_cpu" },
      { name: "k8s_node_memory" },
    ];
  });

  afterEach(() => {
    ctl.metricStreams = null;
  });

  const mountWithK8sPreset = async () => {
    router.currentRoute.value.query = { preset: "k8s" };
    const wrapper = await mountEditRole();
    await flushPromises();
    router.currentRoute.value.query = {};
    return wrapper;
  };

  // Per-stream GET is what narrows the type node's LIST down to the curated set.
  it("stages AllowGet on the curated metric streams present in the org", async () => {
    const wrapper = await mountWithK8sPreset();

    expect(Object.values(wrapper.vm.addedPermissions)).toEqual(
      expect.arrayContaining([
        { object: "metrics:k8s_pod_cpu", permission: "AllowGet" },
        { object: "metrics:k8s_node_memory", permission: "AllowGet" },
      ]),
    );
  });

  it("stages exactly the curated streams plus the metrics type node", async () => {
    const wrapper = await mountWithK8sPreset();

    expect(
      [...new Set(Object.values(wrapper.vm.addedPermissions).map((p) => p.object))].sort(),
    ).toEqual(["metrics:_all_default", "metrics:k8s_node_memory", "metrics:k8s_pod_cpu"]);
  });

  // GET /{org}/streams checks `metrics:_all_<org>` (EntitySource::Org rewrites the
  // object to the wildcard), and FGA's LIST relation does not accept ALLOW_GET —
  // without this grant the curated pages fail their one hard dependency.
  it("stages AllowList on the metrics stream-type node", async () => {
    const wrapper = await mountWithK8sPreset();

    expect(Object.values(wrapper.vm.addedPermissions)).toEqual(
      expect.arrayContaining([{ object: "metrics:_all_default", permission: "AllowList" }]),
    );
  });

  // ALLOW_GET on `metrics:_all_<org>` reads as a wildcard over every metric stream in the org, which would make the 37 per-stream grants decorative.
  it("never stages AllowGet on the metrics stream-type node", async () => {
    const wrapper = await mountWithK8sPreset();

    expect(Object.values(wrapper.vm.addedPermissions)).not.toContainEqual({
      object: "metrics:_all_default",
      permission: "AllowGet",
    });
  });

  it("does not grant a wildcard beyond the metrics stream type", async () => {
    const wrapper = await mountWithK8sPreset();

    const objects = Object.values(wrapper.vm.addedPermissions).map((p) => p.object);
    expect(objects).not.toContain("stream:_all_default");
    expect(objects).not.toContain("logs:_all_default");
    expect(objects).not.toContain("traces:_all_default");
  });

  it("ticks the metrics type-node checkboxes so the grant is reviewable", async () => {
    const wrapper = await mountWithK8sPreset();

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

  it("does not stage a permission the table hides on a stream row", async () => {
    const wrapper = await mountWithK8sPreset();

    const rows = wrapper.vm.heavyResourceEntities.metrics || [];
    const seeded = rows.find((r) => r.name === "k8s_pod_cpu");
    expect(seeded.permission.AllowList.show).toBe(false);
    expect(
      Object.values(wrapper.vm.addedPermissions).some(
        (p) => p.permission === "AllowList" && p.object.startsWith("metrics:k8s_"),
      ),
    ).toBe(false);
  });

  it("does not stage unrelated metric streams", async () => {
    const wrapper = await mountWithK8sPreset();

    const objects = Object.values(wrapper.vm.addedPermissions).map((p) => p.object);
    expect(objects).not.toContain("metrics:cpu");
    expect(objects).not.toContain("metrics:mem");
  });

  it("only stages read permissions (never write or delete)", async () => {
    const wrapper = await mountWithK8sPreset();

    const perms = Object.values(wrapper.vm.addedPermissions).map((p) => p.permission);
    expect(perms.length).toBeGreaterThan(0);
    expect(perms.every((p) => p === "AllowList" || p === "AllowGet")).toBe(true);
  });

  it("skips curated streams absent from this org without throwing", async () => {
    const wrapper = await mountWithK8sPreset();

    const objects = Object.values(wrapper.vm.addedPermissions).map((p) => p.object);
    expect(objects).not.toContain("metrics:k8s_absent_stream");
  });

  it("ticks the checkbox state on the seeded stream rows", async () => {
    const wrapper = await mountWithK8sPreset();

    const rows = wrapper.vm.heavyResourceEntities.metrics || [];
    const seeded = rows.find((r) => r.name === "k8s_pod_cpu");
    expect(seeded).toBeDefined();
    expect(seeded.resourceName).toBe("metrics");
    expect(seeded.permission.AllowGet.value).toBe(true);

    const untouched = rows.find((r) => r.name === "cpu");
    expect(untouched.permission.AllowGet.value).toBe(false);
  });

  it("expands the stream + metrics nodes so the seeded rows are visible", async () => {
    const wrapper = await mountWithK8sPreset();

    const streamResource = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "stream",
    );
    expect(streamResource.expand).toBe(true);
    const metricsNode = streamResource.entities.find((e) => e.name === "metrics");
    expect(metricsNode).toBeDefined();
    expect(metricsNode.expand).toBe(true);
  });

  it("writes the seeded permissions into the save payload", async () => {
    const { updateRole } = await import("@/services/iam");
    const wrapper = await mountWithK8sPreset();

    await wrapper.vm.saveRole();
    await flushPromises();

    const payload = vi.mocked(updateRole).mock.calls[0][0].payload;
    expect(payload.remove).toEqual([]);
    expect(payload.add).toEqual(
      expect.arrayContaining([
        { object: "metrics:_all_default", permission: "AllowList" },
        { object: "metrics:k8s_pod_cpu", permission: "AllowGet" },
        { object: "metrics:k8s_node_memory", permission: "AllowGet" },
      ]),
    );
    expect(payload.add).not.toContainEqual({
      object: "metrics:_all_default",
      permission: "AllowGet",
    });
    expect(payload.add).toHaveLength(3);
  });

  it("reports how many curated streams matched this org", async () => {
    mockToast.mockClear();
    await mountWithK8sPreset();

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

    try {
      const wrapper = await mountWithK8sPreset();
      expect(Object.keys(wrapper.vm.addedPermissions).length).toBe(0);
    } finally {
      ctl.metricStreams = null;
    }

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "warning",
        message: expect.stringContaining("None"),
      }),
    );
  });

  it("does not seed when the role already has permissions", async () => {
    const { getAllRolePermissions } = await import("@/services/iam");
    vi.mocked(getAllRolePermissions).mockImplementationOnce(async () => ({
      data: [{ object: "logs:app", permission: "AllowGet" }],
    }));

    router.currentRoute.value.query = { preset: "k8s" };
    const wrapper = await mountEditRole();
    await flushPromises();
    router.currentRoute.value.query = {};

    expect(wrapper.vm.selectedPermissionsHash.size).toBeGreaterThan(0);
    expect(Object.keys(wrapper.vm.addedPermissions).length).toBe(0);
  });

  it("does not seed k8s streams for the readonly preset", async () => {
    router.currentRoute.value.query = { preset: "readonly" };
    const wrapper = await mountEditRole();
    await flushPromises();
    router.currentRoute.value.query = {};

    const objects = Object.values(wrapper.vm.addedPermissions).map((p) => p.object);
    expect(objects).not.toContain("metrics:k8s_pod_cpu");
  });

  it("does not seed k8s streams with no preset at all", async () => {
    router.currentRoute.value.query = {};
    const wrapper = await mountEditRole();
    await flushPromises();

    expect(Object.keys(wrapper.vm.addedPermissions).length).toBe(0);
  });
});

// Characterization suite: pins observed grant behaviour, so a failure means the refactor changed it; never edit to make it pass.
describe("EditRole - grant hash encoding [characterization]", () => {
  it("encodes a type level grant with the _all_<org> entity", async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.vm.getPermissionHash("stream", "AllowAll")).toBe("stream:_all_default:AllowAll");
  });

  it("encodes a per entity grant as resource:entity:action", async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.vm.getPermissionHash("logs", "AllowGet", "app")).toBe("logs:app:AllowGet");
  });

  it("passes a folder scoped entity id through untouched", async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.vm.getPermissionHash("dashboard", "AllowGet", "folder1/dash1")).toBe(
      "dashboard:folder1/dash1:AllowGet",
    );
  });
});

describe("EditRole - toggle state machine [characterization]", () => {
  const NEW_GRANT = "logs:app:AllowGet";
  const SAVED_GRANT = "logs:sys:AllowGet";

  const withSavedGrant = (vm, hash) => {
    vm.permissionsHash = new Set([hash]);
    vm.selectedPermissionsHash = new Set([hash]);
  };

  it("stages a brand new grant as added and selects it", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.updatePermissionMappings(NEW_GRANT);

    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([NEW_GRANT]);
    expect(Object.keys(wrapper.vm.removedPermissions)).toEqual([]);
    expect(wrapper.vm.selectedPermissionsHash.has(NEW_GRANT)).toBe(true);
  });

  it("clears the staging when a brand new grant is toggled twice", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.updatePermissionMappings(NEW_GRANT);
    wrapper.vm.updatePermissionMappings(NEW_GRANT);

    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([]);
    expect(Object.keys(wrapper.vm.removedPermissions)).toEqual([]);
    expect(wrapper.vm.selectedPermissionsHash.has(NEW_GRANT)).toBe(false);
  });

  it("stages a saved grant as removed when it is unticked", async () => {
    const wrapper = await mountEditRole();
    withSavedGrant(wrapper.vm, SAVED_GRANT);
    wrapper.vm.updatePermissionMappings(SAVED_GRANT);

    expect(Object.keys(wrapper.vm.removedPermissions)).toEqual([SAVED_GRANT]);
    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([]);
    expect(wrapper.vm.selectedPermissionsHash.has(SAVED_GRANT)).toBe(false);
  });

  it("clears the staging when a saved grant is unticked and ticked again", async () => {
    const wrapper = await mountEditRole();
    withSavedGrant(wrapper.vm, SAVED_GRANT);
    wrapper.vm.updatePermissionMappings(SAVED_GRANT);
    wrapper.vm.updatePermissionMappings(SAVED_GRANT);

    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([]);
    expect(Object.keys(wrapper.vm.removedPermissions)).toEqual([]);
    expect(wrapper.vm.selectedPermissionsHash.has(SAVED_GRANT)).toBe(true);
  });

  it("stages several grants independently", async () => {
    const wrapper = await mountEditRole();
    withSavedGrant(wrapper.vm, SAVED_GRANT);
    wrapper.vm.updatePermissionMappings("logs:app:AllowPut");
    wrapper.vm.updatePermissionMappings("metrics:cpu:AllowGet");
    wrapper.vm.updatePermissionMappings(SAVED_GRANT);

    expect(Object.keys(wrapper.vm.addedPermissions).sort()).toEqual([
      "logs:app:AllowPut",
      "metrics:cpu:AllowGet",
    ]);
    expect(Object.keys(wrapper.vm.removedPermissions)).toEqual([SAVED_GRANT]);
  });

  // The store's core invariant: selected is always saved plus added minus removed.
  it("keeps selected equal to saved plus added minus removed", async () => {
    const wrapper = await mountEditRole();
    const vm = wrapper.vm;
    vm.permissionsHash = new Set(["logs:sys:AllowGet", "logs:sys:AllowPut"]);
    vm.selectedPermissionsHash = new Set(["logs:sys:AllowGet", "logs:sys:AllowPut"]);

    ["logs:app:AllowGet", "logs:sys:AllowGet", "metrics:cpu:AllowGet", "logs:app:AllowGet"].forEach(
      (hash) => vm.updatePermissionMappings(hash),
    );

    const expected = new Set(vm.permissionsHash);
    Object.keys(vm.addedPermissions).forEach((hash) => expected.add(hash));
    Object.keys(vm.removedPermissions).forEach((hash) => expected.delete(hash));

    expect(Array.from(vm.selectedPermissionsHash).sort()).toEqual(Array.from(expected).sort());
  });
});

describe("EditRole - save payload [characterization]", () => {
  it("does not call updateRole when nothing changed", async () => {
    const { updateRole } = await import("@/services/iam");
    const wrapper = await mountEditRole();
    vi.mocked(updateRole).mockClear();
    mockToast.mockClear();

    await wrapper.vm.saveRole();

    expect(vi.mocked(updateRole)).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "info" }));
  });

  it("sends only the added grants when nothing was removed", async () => {
    const { updateRole } = await import("@/services/iam");
    const wrapper = await mountEditRole();
    vi.mocked(updateRole).mockClear();
    wrapper.vm.updatePermissionMappings("logs:app:AllowGet");

    await wrapper.vm.saveRole();
    await flushPromises();

    const payload = vi.mocked(updateRole).mock.calls[0][0].payload;
    expect(payload.add).toEqual([{ object: "logs:app", permission: "AllowGet" }]);
    expect(payload.remove).toEqual([]);
  });

  it("sends an add list and a remove list in one payload", async () => {
    const { updateRole } = await import("@/services/iam");
    const wrapper = await mountEditRole();
    vi.mocked(updateRole).mockClear();
    wrapper.vm.permissionsHash = new Set(["logs:sys:AllowGet"]);
    wrapper.vm.selectedPermissionsHash = new Set(["logs:sys:AllowGet"]);
    wrapper.vm.updatePermissionMappings("logs:app:AllowPut");
    wrapper.vm.updatePermissionMappings("logs:sys:AllowGet");

    await wrapper.vm.saveRole();
    await flushPromises();

    expect(vi.mocked(updateRole).mock.calls[0][0].payload).toEqual({
      add: [{ object: "logs:app", permission: "AllowPut" }],
      remove: [{ object: "logs:sys", permission: "AllowGet" }],
      add_users: [],
      remove_users: [],
    });
  });

  it("targets the edited role and the current organization", async () => {
    const { updateRole } = await import("@/services/iam");
    const wrapper = await mountEditRole();
    vi.mocked(updateRole).mockClear();
    wrapper.vm.updatePermissionMappings("logs:app:AllowGet");

    await wrapper.vm.saveRole();
    await flushPromises();

    const call = vi.mocked(updateRole).mock.calls[0][0];
    expect(call.role_id).toBe(wrapper.vm.editingRole);
    expect(call.org_identifier).toBe(store.state.selectedOrganization.identifier);
  });
});

describe("EditRole - baseline after save [characterization]", () => {
  const stageAddAndRemove = (vm) => {
    vm.permissionsHash = new Set(["logs:sys:AllowGet"]);
    vm.selectedPermissionsHash = new Set(["logs:sys:AllowGet"]);
    vm.updatePermissionMappings("logs:app:AllowPut");
    vm.updatePermissionMappings("logs:sys:AllowGet");
  };

  it("clears the staged changes once the save resolves", async () => {
    const wrapper = await mountEditRole();
    stageAddAndRemove(wrapper.vm);

    await wrapper.vm.saveRole();
    await flushPromises();

    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([]);
    expect(Object.keys(wrapper.vm.removedPermissions)).toEqual([]);
  });

  it("promotes the saved set to the new baseline", async () => {
    const wrapper = await mountEditRole();
    stageAddAndRemove(wrapper.vm);

    await wrapper.vm.saveRole();
    await flushPromises();

    expect(Array.from(wrapper.vm.permissionsHash)).toEqual(["logs:app:AllowPut"]);
    expect(Array.from(wrapper.vm.selectedPermissionsHash)).toEqual(["logs:app:AllowPut"]);
  });

  it("treats an immediate second save as a no change save", async () => {
    const { updateRole } = await import("@/services/iam");
    const wrapper = await mountEditRole();
    stageAddAndRemove(wrapper.vm);
    await wrapper.vm.saveRole();
    await flushPromises();

    vi.mocked(updateRole).mockClear();
    mockToast.mockClear();
    await wrapper.vm.saveRole();

    expect(vi.mocked(updateRole)).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "info" }));
  });
});

describe("EditRole - JSON view parity [characterization]", () => {
  it("stages the same grants as ticking the rows would", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissionsJsonValue = JSON.stringify([
      { object: "logs:app", permission: "AllowGet" },
      { object: "metrics:cpu", permission: "AllowList" },
    ]);

    await wrapper.vm.updateJsonInTable();

    expect(Array.from(wrapper.vm.selectedPermissionsHash).sort()).toEqual([
      "logs:app:AllowGet",
      "metrics:cpu:AllowList",
    ]);
  });

  it("sends the grants entered as JSON in the save payload", async () => {
    const { updateRole } = await import("@/services/iam");
    const wrapper = await mountEditRole();
    vi.mocked(updateRole).mockClear();
    wrapper.vm.permissionsJsonValue = JSON.stringify([
      { object: "logs:app", permission: "AllowGet" },
    ]);

    await wrapper.vm.updateJsonInTable();
    await wrapper.vm.saveRole();
    await flushPromises();

    expect(vi.mocked(updateRole).mock.calls[0][0].payload.add).toEqual([
      { object: "logs:app", permission: "AllowGet" },
    ]);
  });
});

describe("EditRole - module navigation", () => {
  // Opens Streams, then drills into one stream type, the way a user reaches individual streams.
  const openStreamType = async (wrapper, type) => {
    wrapper.vm.activeModule = "stream";
    await flushPromises();
    const typeNode = wrapper.vm.activeModuleView.entities.find((row) => row.name === type);
    await wrapper.vm.openFolderRow(typeNode);
    await flushPromises();
    return typeNode;
  };

  it("lists streams as one rail module", async () => {
    const wrapper = await mountEditRole();
    const keys = wrapper.vm.railModules.map((module) => module.key);

    expect(keys).toContain("stream");
    expect(keys).not.toContain("logs");
    expect(keys).not.toContain("metrics");
  });

  it("opens on the summary, with no module selected", async () => {
    const wrapper = await mountEditRole();

    expect(wrapper.vm.activeModule).toBe("");
    expect(wrapper.vm.activeModuleView).toBeNull();
  });

  it("opens streams with every stream on top and the stream types as rows", async () => {
    const wrapper = await mountEditRole();

    wrapper.vm.activeModule = "stream";
    await flushPromises();

    expect(wrapper.vm.activeModuleView.scopes.map((scope) => scope.key)).toEqual(["stream"]);
    expect(wrapper.vm.activeModuleView.entities.map((row) => row.name).sort()).toEqual([
      "index",
      "logs",
      "metrics",
      "traces",
    ]);
  });

  it("lets every stream lock the stream type rows beneath it", async () => {
    const wrapper = await mountEditRole();

    wrapper.vm.activeModule = "stream";
    await flushPromises();

    expect(wrapper.vm.activeModuleView.scopes[0].covers.sort()).toEqual([
      "index",
      "logs",
      "metrics",
      "traces",
    ]);
  });

  it("drills into a stream type with every stream hidden but still in effect", async () => {
    const wrapper = await mountEditRole();

    await openStreamType(wrapper, "metrics");

    const scopes = wrapper.vm.activeModuleView.scopes;
    expect(wrapper.vm.activeModuleView.trail).toHaveLength(2);
    expect(scopes.map((scope) => scope.key)).toEqual(["stream", "metrics"]);
    expect(scopes.map((scope) => !!scope.hidden)).toEqual([true, false]);
  });

  it("explains a lock that comes from every stream on the stream type row", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.updatePermissionMappings("stream:_all_default:AllowGet");

    await openStreamType(wrapper, "metrics");

    const ownScope = wrapper.vm.activeModuleView.scopes.find((scope) => scope.key === "metrics");
    expect(String(ownScope.hint)).toContain("Every Stream");
  });

  it("lists every stream of the type, not a truncated slice", async () => {
    const wrapper = await mountEditRole();

    await openStreamType(wrapper, "metrics");

    expect(wrapper.vm.activeModuleView.entities.map((row) => row.name)).toEqual([
      "cpu",
      "mem",
      "postgresql_backends",
      "mysql_threads",
    ]);
  });

  it("stages a grant made in the pane through the same state machine as before", async () => {
    const wrapper = await mountEditRole();
    await openStreamType(wrapper, "metrics");

    const cpu = wrapper.vm.activeModuleView.entities.find((row) => row.name === "cpu");
    wrapper.vm.handlePermissionBatchChange([{ row: cpu, permission: "AllowGet", newValue: true }]);

    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual(["metrics:cpu:AllowGet"]);
  });

  it("stages a stream type grant as that type's _all_ object", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.activeModule = "stream";
    await flushPromises();

    const metrics = wrapper.vm.activeModuleView.entities.find((row) => row.name === "metrics");
    wrapper.vm.handlePermissionBatchChange([
      { row: metrics, permission: "AllowGet", newValue: true },
    ]);

    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual(["metrics:_all_default:AllowGet"]);
  });

  it("stages every stream as the stream _all_ object", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.activeModule = "stream";
    await flushPromises();

    const everyStream = wrapper.vm.activeModuleView.scopes[0];
    wrapper.vm.handlePermissionBatchChange([
      { row: everyStream.node, permission: "AllowGet", newValue: true },
    ]);

    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual(["stream:_all_default:AllowGet"]);
  });

  it("returns to the stream types from the first crumb", async () => {
    const wrapper = await mountEditRole();
    await openStreamType(wrapper, "metrics");

    wrapper.vm.navigateTrail(0);

    expect(wrapper.vm.activeModuleView.trail).toHaveLength(1);
  });
});

describe("EditRole - pane reads the grant store", () => {
  const openMetrics = async (wrapper) => {
    wrapper.vm.activeModule = "stream";
    await flushPromises();
    const metrics = wrapper.vm.activeModuleView.entities.find((row) => row.name === "metrics");
    await wrapper.vm.openFolderRow(metrics);
    await flushPromises();
    return wrapper.vm.activeModuleView.entities.find((row) => row.name === "cpu");
  };

  // The summary can remove a grant without touching row objects, so the pane must follow the store.
  it("reflects a grant removed outside the pane", async () => {
    const wrapper = await mountEditRole();
    const cpu = await openMetrics(wrapper);
    wrapper.vm.handlePermissionBatchChange([{ row: cpu, permission: "AllowGet", newValue: true }]);

    wrapper.vm.updatePermissionMappings("metrics:cpu:AllowGet");

    expect(wrapper.vm.isGranted(cpu, "AllowGet")).toBe(false);
  });

  it("writes and reads the same key for a row", async () => {
    const wrapper = await mountEditRole();
    const cpu = await openMetrics(wrapper);

    wrapper.vm.handlePermissionChange(cpu, "AllowGet");

    expect(wrapper.vm.permissionHashFor(cpu, "AllowGet")).toBe("metrics:cpu:AllowGet");
    expect(wrapper.vm.isGranted(cpu, "AllowGet")).toBe(true);
  });
});

describe("EditRole - summary", () => {
  const withSaved = (vm, keys) => {
    vm.permissionsHash = new Set(keys);
    vm.selectedPermissionsHash = new Set(keys);
  };
  const moduleKeys = (vm) => vm.summaryModules.map((module) => module.moduleKey).sort();

  // Stream types are children of `stream`, so their grants land on the one Streams card.
  it("shows one card per module the role holds", async () => {
    const wrapper = await mountEditRole();
    withSaved(wrapper.vm, ["metrics:cpu:AllowGet", "logs:app:AllowGet", "dfolder:f1:AllowGet"]);

    expect(moduleKeys(wrapper.vm)).toEqual(["dfolder", "stream"]);
  });

  it("routes a dashboard grant to its folder module", async () => {
    const wrapper = await mountEditRole();
    withSaved(wrapper.vm, ["dashboard:f1/d1:AllowGet"]);

    expect(moduleKeys(wrapper.vm)).toEqual(["dfolder"]);
  });

  it("drops a module whose only grant is staged for removal", async () => {
    const wrapper = await mountEditRole();
    withSaved(wrapper.vm, ["logs:app:AllowGet"]);

    wrapper.vm.updatePermissionMappings("logs:app:AllowGet");

    expect(wrapper.vm.summaryModules).toEqual([]);
  });
});

describe("EditRole - pending changes", () => {
  const withSaved = (vm, keys) => {
    vm.permissionsHash = new Set(keys);
    vm.selectedPermissionsHash = new Set(keys);
  };

  it("lists a staged addition and a staged removal with the keys to undo them", async () => {
    const wrapper = await mountEditRole();
    withSaved(wrapper.vm, ["logs:app:AllowGet"]);
    wrapper.vm.updatePermissionMappings("logs:app:AllowGet");
    wrapper.vm.updatePermissionMappings("metrics:cpu:AllowGet");

    const byState = Object.fromEntries(
      wrapper.vm.pendingChanges.map((change) => [change.state, change.keys]),
    );

    expect(byState).toEqual({
      removed: ["logs:app:AllowGet"],
      added: ["metrics:cpu:AllowGet"],
    });
  });

  // The drawer's Undo sends a change's keys back through the same toggle, so it must net to the saved state.
  it("returns to the saved state when a change's keys are undone", async () => {
    const wrapper = await mountEditRole();
    withSaved(wrapper.vm, ["logs:app:AllowGet"]);
    wrapper.vm.updatePermissionMappings("logs:app:AllowGet");

    wrapper.vm.pendingChanges[0].keys.forEach(wrapper.vm.updatePermissionMappings);

    expect(wrapper.vm.pendingChanges).toEqual([]);
    expect(Object.keys(wrapper.vm.removedPermissions)).toEqual([]);
  });
});

describe("EditRole - folder drill-in", () => {
  it("opens a folder showing only this folder, with the folder type scope hidden", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.activeModule = "dfolder";
    await flushPromises();
    const folder = wrapper.vm.activeModuleView.entities[0];

    await wrapper.vm.openFolderRow(folder);
    await flushPromises();

    const scopes = wrapper.vm.activeModuleView.scopes;
    expect(wrapper.vm.activeModuleView.trail).toHaveLength(2);
    expect(scopes.map((scope) => scope.resource)).toEqual(["dfolder", "dfolder"]);
    expect(scopes.map((scope) => !!scope.hidden)).toEqual([true, false]);
  });

  // model.fga resolves every action on a dashboard as `<ACTION> from parent`, so folder grants reach its dashboards.
  it("lets the folder and the folder type scope lock the dashboards inside", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.activeModule = "dfolder";
    await flushPromises();

    await wrapper.vm.openFolderRow(wrapper.vm.activeModuleView.entities[0]);
    await flushPromises();

    const [typeScope, thisFolder] = wrapper.vm.activeModuleView.scopes;
    expect(thisFolder.covers).toEqual(["dashboard"]);
    expect(typeScope.covers).toEqual(["dfolder", "dashboard"]);
  });

  it("names the hidden folder type scope when it locks this folder", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.updatePermissionMappings("dfolder:_all_default:AllowGet");
    wrapper.vm.activeModule = "dfolder";
    await flushPromises();

    await wrapper.vm.openFolderRow(wrapper.vm.activeModuleView.entities[0]);
    await flushPromises();

    const thisFolder = wrapper.vm.activeModuleView.scopes.at(-1);
    expect(String(thisFolder.hint)).toContain("Dash Folders");
  });

  it("keeps the plain folder hint when nothing above grants", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.activeModule = "dfolder";
    await flushPromises();

    await wrapper.vm.openFolderRow(wrapper.vm.activeModuleView.entities[0]);
    await flushPromises();

    expect(String(wrapper.vm.activeModuleView.scopes.at(-1).hint)).toBe(
      "Grants on the folder itself",
    );
  });

  it("returns to the folder list from the first crumb", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.activeModule = "dfolder";
    await flushPromises();
    await wrapper.vm.openFolderRow(wrapper.vm.activeModuleView.entities[0]);

    wrapper.vm.navigateTrail(0);

    expect(wrapper.vm.activeModuleView.trail).toHaveLength(1);
  });

  it("leaves the folder when another module is chosen", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.activeModule = "dfolder";
    await flushPromises();
    await wrapper.vm.openFolderRow(wrapper.vm.activeModuleView.entities[0]);

    wrapper.vm.activeModule = "metrics";
    await flushPromises();

    expect(wrapper.vm.openFolder).toBeNull();
  });
});

describe("EditRole - header row", () => {
  it("puts the permission count and view switch in the summary header, once", async () => {
    const wrapper = await mountEditRole();

    const counts = wrapper.findAll('[data-test="edit-role-permissions-count"]');
    expect(counts).toHaveLength(1);
    expect(
      wrapper
        .find('[data-test="edit-role-summary"]')
        .find('[data-test="edit-role-permissions-count"]')
        .exists(),
    ).toBe(true);
  });

  it("keeps the view switch reachable in the JSON view, which has no pane header", async () => {
    const wrapper = await mountEditRole();

    wrapper.vm.permissionsUiType = "json";
    await flushPromises();

    expect(wrapper.find('[data-test="edit-role-summary"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-test="edit-role-permissions-ui-type-toggle"]')).toHaveLength(1);
  });
});

describe("EditRole - org module", () => {
  const withOrgResource = (vm) => {
    vm.permissionsState.resources = [
      ...vm.permissionsState.resources,
      { key: "org", display_name: "Organizations", has_entities: true, order: 999 },
    ];
  };

  // The backend does not reject org grants from other orgs, so the rail is the only gate.
  it("hides the organizations module outside the meta org", async () => {
    const metaOrg = store.state.zoConfig.meta_org;
    store.state.zoConfig.meta_org = "_meta";
    try {
      const wrapper = await mountEditRole();
      withOrgResource(wrapper.vm);

      expect(wrapper.vm.railModules.map((module) => module.key)).not.toContain("org");
    } finally {
      store.state.zoConfig.meta_org = metaOrg;
    }
  });

  it("offers the organizations module inside the meta org", async () => {
    const wrapper = await mountEditRole();
    withOrgResource(wrapper.vm);

    expect(wrapper.vm.railModules.map((module) => module.key)).toContain("org");
  });
});

describe("EditRole - presets after undo", () => {
  // Undo only clears the grant store, so a preset must judge "already granted" from the store, not row flags.
  it("seeds the read-only preset again after every change is undone", async () => {
    const wrapper = await mountEditRole();
    await wrapper.vm.applyPreset("readonly");
    const seeded = Object.keys(wrapper.vm.addedPermissions);
    expect(seeded.length).toBeGreaterThan(0);

    wrapper.vm.pendingChanges
      .flatMap((change) => change.keys)
      .forEach(wrapper.vm.updatePermissionMappings);
    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([]);

    await wrapper.vm.applyPreset("readonly");
    expect(Object.keys(wrapper.vm.addedPermissions).sort()).toEqual([...seeded].sort());
  });
});

describe("EditRole - preset cards", () => {
  const staged = (wrapper) => Object.keys(wrapper.vm.addedPermissions);

  // The Role Overview cards route through applyPreset, not the ?preset= query the other preset tests use.
  it("runs the preset each card names", async () => {
    const dbm = await mountEditRole();
    await dbm.vm.applyPreset("dbm");
    await flushPromises();
    expect(staged(dbm).some((key) => key.startsWith("db_monitoring:"))).toBe(true);

    const k8s = await mountEditRole();
    await k8s.vm.applyPreset("k8s");
    await flushPromises();
    expect(staged(k8s).some((key) => key.startsWith("db_monitoring:"))).toBe(false);
  });

  it("does nothing for an unknown preset", async () => {
    const wrapper = await mountEditRole();
    await wrapper.vm.applyPreset("nope");
    expect(staged(wrapper)).toEqual([]);
  });

  // A preset stages through toggle, which revokes a held key, so it must skip anything already held.
  it("leaves a grant the role already holds untouched", async () => {
    const wrapper = await mountEditRole();
    await wrapper.vm.applyPreset("readonly");
    const [held] = staged(wrapper);
    expect(held).toBeDefined();

    await wrapper.vm.applyPreset("readonly");

    expect(wrapper.vm.selectedPermissionsHash.has(held)).toBe(true);
    expect(Object.keys(wrapper.vm.removedPermissions)).toEqual([]);
  });
});

describe("EditRole - overlapping entity loads", () => {
  // The loaders push into the list, so two overlapping opens must share one request.
  it("lists a resource's entities once when it is opened twice at the same time", async () => {
    const wrapper = await mountEditRole();
    const resource = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "provider",
    );
    onlineEvalsService.providers.list.mockClear();

    await Promise.all([
      wrapper.vm.getResourceEntities(resource),
      wrapper.vm.getResourceEntities(resource),
    ]);

    expect(onlineEvalsService.providers.list).toHaveBeenCalledTimes(1);
    expect(resource.entities).toHaveLength(1);
  });
});

const resourceOf = (wrapper, name) =>
  wrapper.vm.getResourceByName(wrapper.vm.permissionsState.permissions, name);

// Load a top-level resource's entities the way the tree does, and hand back the resource.
async function loadResource(wrapper, name) {
  const resource = resourceOf(wrapper, name);
  await wrapper.vm.getResourceEntities(resource);
  return resource;
}

// Stream types are entities of `stream`, not resources — `logs`/`metrics`/... load off those.
async function loadStreamType(wrapper, type) {
  const stream = await loadResource(wrapper, "stream");
  const typeNode = stream.entities.find((e) => e.name === type);
  await wrapper.vm.getResourceEntities(typeNode);
  return typeNode;
}

describe("EditRole - loaded rows through the tree [characterization]", () => {
  it("getStreamsTypes builds four type rows", async () => {
    const wrapper = await mountEditRole();
    const stream = await loadResource(wrapper, "stream");

    expect(stream.entities.map((e) => e.name)).toEqual(["logs", "traces", "metrics", "index"]);
    expect(stream.entities[0]).toMatchObject({
      name: "logs",
      type: "Type",
      resourceName: "logs",
      childName: "logs",
      has_entities: true,
      top_level: true,
      show: true,
      entities: [],
    });
    expect(stream.entities[0].permission.AllowList.show).toBe(true);
    expect(stream.entities[0].permission.AllowPost.show).toBe(true);
  });

  it("getLogs rows are leaf rows mirrored into heavyResourceEntities", async () => {
    const wrapper = await mountEditRole();
    const logsNode = await loadStreamType(wrapper, "logs");
    const row = logsNode.entities[0];

    expect(logsNode.entities.map((e) => e.name)).toEqual(["app", "sys"]);
    expect(wrapper.vm.heavyResourceEntities.logs.map((e) => e.name)).toEqual(["app", "sys"]);
    expect(row).toMatchObject({
      name: "app",
      display_name: "app",
      resourceName: "logs",
      type: "Resource",
      has_entities: false,
      top_level: false,
      show: true,
    });
    expect(row.permission.AllowList.show).toBe(false);
    expect(row.permission.AllowPost.show).toBe(false);
    expect(row.permission.AllowAll.show).toBe(true);
    expect(row.permission.AllowGet.show).toBe(true);
    expect(row.permission.AllowDelete.show).toBe(true);
    expect(row.permission.AllowPut.show).toBe(true);
    expect(row.permission.AllowGet.value).toBe(false);
  });

  it("each stream type keeps its own list in heavyResourceEntities", async () => {
    const wrapper = await mountEditRole();

    const metrics = await loadStreamType(wrapper, "metrics");
    const traces = await loadStreamType(wrapper, "traces");
    const index = await loadStreamType(wrapper, "index");

    expect(traces.entities.map((e) => e.name)).toEqual(["svc-a"]);
    expect(index.entities.map((e) => e.name)).toEqual(["users"]);
    expect(Object.keys(wrapper.vm.heavyResourceEntities).sort()).toEqual([
      "index",
      "metrics",
      "traces",
    ]);
    expect(wrapper.vm.heavyResourceEntities.metrics.map((e) => e.name)).toEqual(
      metrics.entities.map((e) => e.name),
    );
  });

  it("getFolders rows carry the dashboard child", async () => {
    const wrapper = await mountEditRole();
    const dfolder = await loadResource(wrapper, "dfolder");

    expect(dfolder.entities.map((e) => e.name)).toEqual(["default"]);
    expect(dfolder.entities[0]).toMatchObject({
      name: "default",
      display_name: "default",
      resourceName: "dfolder",
      childName: "dashboard",
      type: "Resource",
      has_entities: true,
      top_level: false,
      show: true,
    });
    expect(dfolder.entities[0].permission.AllowList.show).toBe(true);
    expect(dfolder.entities[0].permission.AllowPost.show).toBe(true);
  });

  it("expandPermission toggles expand and loads only on the way open", async () => {
    const wrapper = await mountEditRole();
    const resource = resourceOf(wrapper, "provider");
    onlineEvalsService.providers.list.mockClear();

    await wrapper.vm.expandPermission(resource);
    expect(resource.expand).toBe(true);
    expect(onlineEvalsService.providers.list).toHaveBeenCalledTimes(1);

    await wrapper.vm.expandPermission(resource);
    expect(resource.expand).toBe(false);
    expect(onlineEvalsService.providers.list).toHaveBeenCalledTimes(1);
  });

  it("expandPermission swallows a loader rejection", async () => {
    const wrapper = await mountEditRole();
    const resource = resourceOf(wrapper, "provider");
    onlineEvalsService.providers.list.mockRejectedValueOnce(new Error("boom"));

    await expect(wrapper.vm.expandPermission(resource)).resolves.toBeUndefined();
    expect(resource.expand).toBe(true);
    expect(resource.entities).toEqual([]);
  });
});

describe("EditRole - tree builders [characterization]", () => {
  it("getDefaultResource returns a blank top-level Type with every action shown", async () => {
    const wrapper = await mountEditRole();
    const resource = wrapper.vm.getDefaultResource();

    expect(resource).toEqual({
      name: "",
      permission: {
        AllowAll: { show: true, value: false },
        AllowList: { show: true, value: false },
        AllowGet: { show: true, value: false },
        AllowDelete: { show: true, value: false },
        AllowPost: { show: true, value: false },
        AllowPut: { show: true, value: false },
      },
      display_name: "",
      parent: "",
      childs: [],
      type: "Type",
      resourceName: "",
      entities: [],
      has_entities: false,
      is_loading: false,
      top_level: true,
    });
  });

  it("getResourceByName returns null at the top level and undefined while recursing", async () => {
    const wrapper = await mountEditRole();
    const permissions = [
      { resourceName: "stream", childs: [{ resourceName: "logs", childs: [] }] },
    ];

    expect(wrapper.vm.getResourceByName(permissions, "logs")?.resourceName).toBe("logs");
    expect(wrapper.vm.getResourceByName(permissions, "nope")).toBe(null);
    expect(wrapper.vm.getResourceByName(permissions[0].childs, "nope", 1)).toBe(undefined);
  });

  it("setPermission copies the catalog row onto a default resource and registers it", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissionsState.permissions = [];

    wrapper.vm.setPermission(
      { key: "alpha", display_name: "Alpha", top_level: true, has_entities: true, parent: "" },
      new Set(),
    );

    const added = wrapper.vm.permissionsState.permissions.at(-1);
    expect(added).toMatchObject({
      name: "alpha",
      resourceName: "alpha",
      display_name: "Alpha",
      top_level: true,
      has_entities: true,
      parent: "",
      type: "Type",
      childs: [],
      entities: [],
    });
    expect(wrapper.vm.resourceMapper.alpha).toBe(added);
  });

  it("setPermission attaches a child to its parent instead of pushing it to the top level", async () => {
    const wrapper = await mountEditRole();
    const before = wrapper.vm.permissionsState.permissions.length;

    wrapper.vm.setPermission(
      { key: "child", display_name: "Child", top_level: false, parent: "stream" },
      new Set(),
    );

    expect(wrapper.vm.permissionsState.permissions.length).toBe(before);
    expect(resourceOf(wrapper, "stream").childs.some((c) => c.name === "child")).toBe(true);
  });

  it("setPermission ignores a resource with no key and a resource already visited", async () => {
    const wrapper = await mountEditRole();
    const before = wrapper.vm.permissionsState.permissions.length;
    const visited = new Set(["alpha"]);

    wrapper.vm.setPermission({ display_name: "No key" }, new Set());
    wrapper.vm.setPermission({ key: "alpha", display_name: "Alpha", top_level: true }, visited);

    expect(wrapper.vm.permissionsState.permissions.length).toBe(before);
  });

  it("setDefaultPermissions keeps parents at the top level and nests the children", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissionsState.permissions = [];
    wrapper.vm.permissionsState.resources = [
      { key: "stream", display_name: "Streams", has_entities: true, top_level: true },
      { key: "logs", display_name: "Logs", has_entities: true, parent: "stream", top_level: false },
    ];

    wrapper.vm.setDefaultPermissions();

    expect(wrapper.vm.permissionsState.permissions.map((r) => r.resourceName)).toEqual(["stream"]);
    expect(wrapper.vm.permissionsState.permissions[0].childs.map((c) => c.name)).toEqual(["logs"]);
  });

  it("modifyResourcePermissions hides actions per resource type and leaves others alone", async () => {
    const wrapper = await mountEditRole();
    const make = (resourceName) => ({
      resourceName,
      permission: {
        AllowAll: { show: true },
        AllowList: { show: true },
        AllowGet: { show: true },
        AllowDelete: { show: true },
        AllowPost: { show: true },
        AllowPut: { show: true },
      },
    });
    const hidden = (r) =>
      Object.keys(r.permission)
        .filter((k) => !r.permission[k].show)
        .sort();

    const settings = make("settings");
    const pattern = make("logs_pattern");
    const cache = make("logs_cache");
    const other = make("pipeline");
    [settings, pattern, cache, other].forEach(wrapper.vm.modifyResourcePermissions);

    expect(hidden(settings)).toEqual(["AllowDelete", "AllowList", "AllowPost"]);
    expect(hidden(pattern)).toEqual(["AllowDelete", "AllowList", "AllowPost", "AllowPut"]);
    expect(hidden(cache)).toEqual(["AllowGet", "AllowList", "AllowPost", "AllowPut"]);
    expect(hidden(other)).toEqual([]);
  });
});

// Characterization suite for the rail, the scope ladder, the module view model,
// the summary and saving. It records what EditRole.vue does TODAY so a refactor
// that splits the file up fails loudly. Never edit a test to make it pass.

const withSaved = (vm, keys) => {
  vm.permissionsHash = new Set(keys);
  vm.selectedPermissionsHash = new Set(keys);
};

const openModuleView = async (vm, moduleKey) => {
  vm.activeModule = moduleKey;
  await flushPromises();
};

const drillInto = async (vm, moduleKey, rowName) => {
  await openModuleView(vm, moduleKey);
  const row = vm.activeModuleView.entities.find((entity) => entity.name === rowName);
  await vm.openFolderRow(row);
  await flushPromises();
  return row;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mockToast.mockClear();
});

describe("EditRole - grantable resources [characterization]", () => {
  useNavigationFixture();
  const addOrgResource = (vm) => {
    vm.permissionsState.resources = [
      ...vm.permissionsState.resources,
      { key: "org", display_name: "Organizations", has_entities: true, order: 999 },
    ];
  };

  // setPermission refuses an org grant outside the meta org, so the list it feeds must agree.
  it("drops the org resource outside the meta org", async () => {
    const metaOrg = store.state.zoConfig.meta_org;
    store.state.zoConfig.meta_org = "_meta";
    try {
      const vm = await mountEditRoleVm();
      addOrgResource(vm);
      expect(vm.grantableResources.map((resource) => resource.key)).not.toContain("org");
    } finally {
      store.state.zoConfig.meta_org = metaOrg;
    }
  });

  it("keeps the org resource inside the meta org", async () => {
    const vm = await mountEditRoleVm();
    addOrgResource(vm);
    expect(vm.grantableResources.map((resource) => resource.key)).toContain("org");
  });
});

describe("EditRole - rail modules [characterization]", () => {
  useNavigationFixture();
  it("folds stream children into the one Streams module", async () => {
    const vm = await mountEditRoleVm();
    const stream = vm.roleModules.find((module) => module.key === "stream");
    expect(stream.countedKeys).toEqual(["stream", "logs", "metrics"]);
    expect(stream.hasEntities).toBe(true);
  });

  it("describes a rail module with its label, icon and group", async () => {
    const vm = await mountEditRoleVm();
    const stream = vm.railModules.find((module) => module.key === "stream");
    expect(stream).toMatchObject({
      key: "stream",
      label: "Streams",
      icon: "window",
      groupId: "data",
      groupLabel: i18n.global.t("iam.editRole.moduleGroupData"),
    });
  });

  it("orders the rail by module group", async () => {
    const vm = await mountEditRoleVm();
    const groups = vm.railModules.map((module) => module.groupId);
    expect(groups.indexOf("data")).toBeLessThan(groups.indexOf("access"));
  });

  // Counts on Streams add up across stream, logs and metrics, which are three separate grant resources.
  it("sums granted, added and removed across every counted resource", async () => {
    const vm = await mountEditRoleVm();
    withSaved(vm, ["logs:app:AllowGet", "metrics:cpu:AllowGet", `stream:${ALL}:AllowList`]);

    vm.updatePermissionMappings("metrics:mem:AllowGet");
    vm.updatePermissionMappings("logs:app:AllowGet");

    const stream = vm.railModules.find((module) => module.key === "stream");
    expect({ granted: stream.granted, added: stream.added, removed: stream.removed }).toEqual({
      granted: 3,
      added: 1,
      removed: 1,
    });
  });
});

describe("EditRole - active module view [characterization]", () => {
  useNavigationFixture();
  it("lists a plain module's entities under its own type scope", async () => {
    const vm = await mountEditRoleVm();
    await openModuleView(vm, "provider");

    expect(vm.activeModuleView.trail).toEqual(["LLM Providers"]);
    expect(vm.activeModuleView.scopes.map((scope) => scope.key)).toEqual(["provider"]);
    expect(vm.activeModuleView.entities).toBe(vm.resourceMapper.provider.entities);
    expect(vm.activeModuleView.entities.map((row) => row.name)).toEqual(["openai"]);
  });

  it("reads a drilled stream type's rows from heavyResourceEntities", async () => {
    const vm = await mountEditRoleVm();
    await drillInto(vm, "stream", "metrics");

    expect(vm.activeModuleView.trail).toEqual(["Streams", "Metrics"]);
    expect(vm.activeModuleView.entities).toBe(vm.heavyResourceEntities.metrics);
    expect(vm.activeModuleView.entities.map((row) => row.name)).toEqual(["cpu", "mem"]);
  });

  it("reads a drilled folder's rows from the folder node", async () => {
    const vm = await mountEditRoleVm();
    const folder = await drillInto(vm, "dfolder", "default");

    expect(vm.activeModuleView.trail).toEqual(["Dash Folders", "default"]);
    expect(vm.activeModuleView.entities).toBe(folder.entities);
    expect(vm.activeModuleView.entities.map((row) => row.name)).toEqual(["d1"]);
  });
});

describe("EditRole - navigation [characterization]", () => {
  useNavigationFixture();
  it("clears the loading marker once the module's entities land", async () => {
    const vm = await mountEditRoleVm();
    await openModuleView(vm, "provider");
    expect(vm.loadingFor).toBe("");
    expect(vm.moduleLoading).toBe(false);
  });

  it("reports loading while the open module is the one in flight", async () => {
    const vm = await mountEditRoleVm();
    await openModuleView(vm, "provider");
    vm.loadingFor = "provider";
    await flushPromises();
    expect(vm.moduleLoading).toBe(true);
  });

  it("reports loading while the open folder is the one in flight", async () => {
    const vm = await mountEditRoleVm();
    await drillInto(vm, "dfolder", "default");
    vm.loadingFor = "default";
    await flushPromises();
    expect(vm.moduleLoading).toBe(true);
  });

  // A slower module must not clear the spinner of the one now on screen.
  it("ignores a stale module's loading marker", async () => {
    const vm = await mountEditRoleVm();
    await openModuleView(vm, "provider");
    vm.loadingFor = "dfolder";
    await flushPromises();
    expect(vm.moduleLoading).toBe(false);
  });
});

describe("EditRole - tabs and dirty state [characterization]", () => {
  useNavigationFixture();
  it("lists permissions, users and service accounts when service accounts are enabled", async () => {
    const vm = await mountEditRoleVm();
    expect(vm.tabs.map((tab) => tab.value)).toEqual(["permissions", "users", "serviceAccounts"]);
    expect(vm.tabs.map((tab) => tab.icon)).toEqual(["shield", "group", "smart-toy"]);
  });

  it("hides the service accounts tab when the feature is off", async () => {
    const enabled = store.state.zoConfig.service_account_enabled;
    store.state.zoConfig.service_account_enabled = false;
    try {
      const vm = await mountEditRoleVm();
      expect(vm.tabs.map((tab) => tab.value)).toEqual(["permissions", "users"]);
    } finally {
      store.state.zoConfig.service_account_enabled = enabled;
    }
  });

  it("clears the permissions dirty flag when a change is undone", async () => {
    const vm = await mountEditRoleVm();
    vm.updatePermissionMappings("metrics:cpu:AllowGet");
    expect(vm.isPermissionsDirty).toBe(true);

    vm.updatePermissionMappings("metrics:cpu:AllowGet");
    expect(vm.isPermissionsDirty).toBe(false);
    expect(vm.isAnyDirty).toBe(false);
  });

  it("counts a staged user removal as dirty", async () => {
    const vm = await mountEditRoleVm();
    vm.removedUsers.add("u1@example.com");
    await vm.$nextTick();

    expect(vm.isUsersDirty).toBe(true);
    expect(vm.isServiceAccountsDirty).toBe(false);
    expect(vm.isAnyDirty).toBe(true);
  });

  it("counts a staged service account removal as dirty on its own tab", async () => {
    const vm = await mountEditRoleVm();
    vm.removedServiceAccounts.add("svc1@example.com");
    await vm.$nextTick();

    expect(vm.isServiceAccountsDirty).toBe(true);
    expect(vm.isUsersDirty).toBe(false);
  });

  // The leave guard holds the navigation in a promise the dialog resolves.
  it("resolves the held navigation with the user's answer and forgets the resolver", async () => {
    const vm = await mountEditRoleVm();
    const resolve = vi.fn();
    vm.leaveConfirm = { show: true, resolve };

    vm.onLeaveConfirm(true);

    expect(resolve).toHaveBeenCalledWith(true);
    expect(vm.leaveConfirm.show).toBe(false);
    expect(vm.leaveConfirm.resolve).toBeNull();
  });

  it("opens with no dialog and nothing to resolve", async () => {
    const vm = await mountEditRoleVm();
    expect(vm.leaveConfirm).toEqual({ show: false, resolve: null });
  });
});

describe("EditRole - save failures", () => {
  useNavigationFixture();
  const failSave = async (status) => {
    const { updateRole } = await import("@/services/iam");
    const vm = await mountEditRoleVm();
    vi.mocked(updateRole).mockRejectedValueOnce({ response: { status } });
    vm.updatePermissionMappings("logs:app:AllowPut");
    mockToast.mockClear();

    await vm.saveRole();
    await flushPromises();
    return mockToast.mock.calls.map(([arg]) => arg?.variant);
  };

  // A 403 is already reported by the global forbidden handler, so the page must not add a second message.
  it("stays quiet on a 403", async () => {
    expect(await failSave(403)).not.toContain("error");
  });

  it("reports any other failure", async () => {
    expect(await failSave(500)).toContain("error");
  });
});

describe("EditRole - save payload [characterization]", () => {
  useNavigationFixture();
  it("sends permissions and both kinds of principal in one payload", async () => {
    const { updateRole } = await import("@/services/iam");
    const vm = await mountEditRoleVm();
    vi.mocked(updateRole).mockClear();

    withSaved(vm, ["logs:sys:AllowGet"]);
    vm.updatePermissionMappings("logs:app:AllowPut");
    vm.updatePermissionMappings("logs:sys:AllowGet");
    vm.addedUsers.add("new@example.com");
    vm.removedUsers.add("u1@example.com");
    vm.addedServiceAccounts.add("svc@example.com");
    vm.removedServiceAccounts.add("svc1@example.com");

    await vm.saveRole();
    await flushPromises();

    expect(vi.mocked(updateRole).mock.calls[0][0]).toEqual({
      role_id: "Admin",
      org_identifier: ORG,
      payload: {
        add: [{ object: "logs:app", permission: "AllowPut" }],
        remove: [{ object: "logs:sys", permission: "AllowGet" }],
        add_users: ["new@example.com", "svc@example.com"],
        remove_users: ["u1@example.com", "svc1@example.com"],
      },
    });
  });

  it("does not call the mutation when nothing changed", async () => {
    const { updateRole } = await import("@/services/iam");
    const vm = await mountEditRoleVm();
    vi.mocked(updateRole).mockClear();
    mockToast.mockClear();

    await vm.saveRole();

    expect(vi.mocked(updateRole)).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      variant: "info",
      message: i18n.global.t("iam.editRole.noUpdatesDetected"),
    });
  });

  it("saves a membership only change with empty grant lists", async () => {
    const { updateRole } = await import("@/services/iam");
    const vm = await mountEditRoleVm();
    vi.mocked(updateRole).mockClear();
    vm.addedUsers.add("new@example.com");

    await vm.saveRole();
    await flushPromises();

    expect(vi.mocked(updateRole).mock.calls[0][0].payload).toEqual({
      add: [],
      remove: [],
      add_users: ["new@example.com"],
      remove_users: [],
    });
  });

  // A principal staged on both tabs is one user to the backend.
  it("sends a principal staged on both tabs once", async () => {
    const { updateRole } = await import("@/services/iam");
    const vm = await mountEditRoleVm();
    vi.mocked(updateRole).mockClear();
    vm.addedUsers.add("both@example.com");
    vm.addedServiceAccounts.add("both@example.com");

    await vm.saveRole();
    await flushPromises();

    expect(vi.mocked(updateRole).mock.calls[0][0].payload.add_users).toEqual(["both@example.com"]);
  });

  it("flushes the JSON editor into the payload before saving", async () => {
    const { updateRole } = await import("@/services/iam");
    const vm = await mountEditRoleVm();
    vi.mocked(updateRole).mockClear();
    vm.permissionsUiType = "json";
    vm.permissionsJsonValue = JSON.stringify([{ object: "logs:app", permission: "AllowGet" }]);

    await vm.saveRole();
    await flushPromises();

    expect(vi.mocked(updateRole).mock.calls[0][0].payload.add).toEqual([
      { object: "logs:app", permission: "AllowGet" },
    ]);
  });
});

describe("EditRole - state after save [characterization]", () => {
  useNavigationFixture();
  const stage = (vm) => {
    withSaved(vm, ["logs:sys:AllowGet"]);
    vm.updatePermissionMappings("logs:app:AllowPut");
    vm.updatePermissionMappings("logs:sys:AllowGet");
    vm.addedUsers.add("new@example.com");
    vm.removedUsers.add("u1@example.com");
    vm.addedServiceAccounts.add("svc@example.com");
  };

  it("promotes the staged grants to the baseline and clears the staging", async () => {
    const vm = await mountEditRoleVm();
    stage(vm);

    await vm.saveRole();
    await flushPromises();

    expect([...vm.permissionsHash]).toEqual(["logs:app:AllowPut"]);
    expect([...vm.selectedPermissionsHash]).toEqual(["logs:app:AllowPut"]);
    expect(vm.addedPermissions).toEqual({});
    expect(vm.removedPermissions).toEqual({});
    expect(vm.isPermissionsDirty).toBe(false);
  });

  it("rebuilds the rail counts from the committed baseline", async () => {
    const vm = await mountEditRoleVm();
    stage(vm);

    await vm.saveRole();
    await flushPromises();

    const stream = vm.railModules.find((module) => module.key === "stream");
    expect({ granted: stream.granted, added: stream.added, removed: stream.removed }).toEqual({
      granted: 1,
      added: 0,
      removed: 0,
    });
  });

  it("applies the staged membership to the role's user list and clears both tabs", async () => {
    const vm = await mountEditRoleVm();
    stage(vm);

    await vm.saveRole();
    await flushPromises();

    expect(vm.roleUsers).toEqual(["u2@example.com", "new@example.com", "svc@example.com"]);
    expect(vm.addedUsers.size).toBe(0);
    expect(vm.removedUsers.size).toBe(0);
    expect(vm.addedServiceAccounts.size).toBe(0);
    expect(vm.removedServiceAccounts.size).toBe(0);
    expect(vm.isAnyDirty).toBe(false);
  });

  it("treats an immediate second save as no change", async () => {
    const { updateRole } = await import("@/services/iam");
    const vm = await mountEditRoleVm();
    stage(vm);
    await vm.saveRole();
    await flushPromises();

    vi.mocked(updateRole).mockClear();
    await vm.saveRole();

    expect(vi.mocked(updateRole)).not.toHaveBeenCalled();
  });
});

// Characterization tests for EditRole.vue's saved-grant loading, presets and
// JSON view. They record TODAY'S behaviour so a refactor that splits the file
// up fails loudly. Do not "fix" an assertion here to match what the code
// should do — change the source and then re-pin.

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

describe("EditRole savedGrants - getRoleDetails orchestration", () => {
  useSavedGrantsFixture();
  it("fetches resources, then the role's permissions, then its users", async () => {
    await mountEditRole();
    expect(ctl.callOrder).toEqual(["getResources", "getAllRolePermissions", "getRoleUsers"]);
  });

  it("drops invisible resources and orders the rest by `order`", async () => {
    const wrapper = await mountEditRole();
    const keys = wrapper.vm.permissionsState.resources.map((r) => r.key);
    expect(keys).not.toContain("hidden_thing");
    expect(keys.slice(0, 3)).toEqual(["stream", "logs", "metrics"]);
  });

  it("leaves isFetchingInitialRoles false once the chain settles", async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.vm.isFetchingInitialRoles).toBe(false);
  });

  it("flips isFetchingInitialRoles true before the first await resolves", async () => {
    const wrapper = mount(EditRole, {
      attachTo: node,
      global: {
        plugins: [i18n, store, router],
        stubs: {
          AppTabs: { template: "<div />" },
          ModuleRail: { template: "<div />" },
          GroupUsers: { template: "<div />" },
          GroupServiceAccounts: { template: "<div />" },
          QueryEditor: editorStub,
        },
      },
    });
    expect(wrapper.vm.isFetchingInitialRoles).toBe(true);
    await flushPromises();
    await flushPromises();
  });

  it("reports a 404 as roleNotFound and leaves the page", async () => {
    ctl.resourcesError = Object.assign(new Error("nope"), { response: { status: 404 } });
    const push = vi.spyOn(router, "push");
    const wrapper = await mountEditRole();
    await flushPromises();

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: "Role not found or has been deleted. Redirecting to roles list.",
      }),
    );
    expect(push).toHaveBeenCalledWith({ name: "roles", query: { org_identifier: ORG } });
    expect(wrapper.vm.isFetchingInitialRoles).toBe(false);
    push.mockRestore();
  });

  it("surfaces a non-404 failure with the raw error message", async () => {
    ctl.resourcesError = Object.assign(new Error("boom"), { response: { status: 400 } });
    const push = vi.spyOn(router, "push");
    await mountEditRole();
    await flushPromises();

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "boom" }),
    );
    push.mockRestore();
  });
});

describe("EditRole savedGrants - savePermissionHash / seedSaved", () => {
  useSavedGrantsFixture();
  it("turns each returned permission into a resource:entity:action key", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissions = [
      { object: `stream:_all_${ORG}`, permission: "AllowGet" },
      { object: "logs:app", permission: "AllowList" },
    ];
    wrapper.vm.savePermissionHash();

    expect([...wrapper.vm.permissionsHash]).toEqual([
      `stream:_all_${ORG}:AllowGet`,
      "logs:app:AllowList",
    ]);
    expect([...wrapper.vm.selectedPermissionsHash]).toEqual([
      `stream:_all_${ORG}:AllowGet`,
      "logs:app:AllowList",
    ]);
  });

  it("seeds saved and current identically, so nothing reads as dirty", async () => {
    const wrapper = await mountWithSaved([{ object: `role:_all_${ORG}`, permission: "AllowGet" }]);
    expect(wrapper.vm.permissionsHash.size).toBe(1);
    expect(wrapper.vm.selectedPermissionsHash.size).toBe(1);
    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([]);
    expect(Object.keys(wrapper.vm.removedPermissions)).toEqual([]);
  });

  // A folder-scoped object keeps the whole "<folder>/<id>" as the entity: the
  // key is built by buildGrantKey, not by re-splitting on every colon.
  it("keeps a folder-scoped entity intact in the grant key", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissions = [{ object: "dashboard:default/d1", permission: "AllowPut" }];
    wrapper.vm.savePermissionHash();
    expect([...wrapper.vm.permissionsHash]).toEqual(["dashboard:default/d1:AllowPut"]);
  });

  it("is additive: a second call keeps the earlier baseline", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissions = [{ object: "logs:app", permission: "AllowGet" }];
    wrapper.vm.savePermissionHash();
    wrapper.vm.permissions = [{ object: "logs:sys", permission: "AllowGet" }];
    wrapper.vm.savePermissionHash();
    // The second call re-seeds the first entry too, because `permissions` is the whole list.
    expect(wrapper.vm.permissionsHash.has("logs:app:AllowGet")).toBe(true);
    expect(wrapper.vm.permissionsHash.has("logs:sys:AllowGet")).toBe(true);
  });
});

describe("EditRole savedGrants - updateRolePermissions expansion", () => {
  useSavedGrantsFixture();
  it("ticks the type-level checkbox for an _all_<org> grant", async () => {
    const wrapper = await mountWithSaved([
      { object: `stream:_all_${ORG}`, permission: "AllowGet" },
    ]);
    const stream = wrapper.vm.getResourceByName(wrapper.vm.permissionsState.permissions, "stream");
    expect(stream.permission.AllowGet.value).toBe(true);
    expect(stream.permission.AllowList.value).toBe(false);
  });

  it("expands the stream tree and ticks a per-stream row", async () => {
    const wrapper = await mountWithSaved([{ object: "logs:app", permission: "AllowGet" }]);
    const rows = wrapper.vm.heavyResourceEntities["logs"] ?? [];
    const app = rows.find((r) => r.name === "app");
    expect(app.resourceName).toBe("logs");
    expect(app.type).toBe("Resource");
    expect(app.permission.AllowGet.value).toBe(true);
    expect(rows.find((r) => r.name === "sys").permission.AllowGet.value).toBe(false);
  });

  it("expands dfolder and its folder to tick a folder-scoped dashboard grant", async () => {
    const wrapper = await mountWithSaved([
      { object: "dashboard:default/d1", permission: "AllowGet" },
    ]);
    const dfolder = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "dfolder",
    );
    const folder = dfolder.entities.find((e) => e.name === "default");
    expect(folder).toBeDefined();
    const dash = folder.entities.find((e) => e.name === "default/d1");
    expect(dash).toBeDefined();
    expect(dash.resourceName).toBe("dashboard");
    expect(dash.permission.AllowGet.value).toBe(true);
  });

  // The grant names a dashboard, but nothing is loaded yet: the folders must be
  // fetched first, then that folder's dashboards, or the row can never be found.
  it("loads the folder list before that folder's dashboards", async () => {
    const order = [];
    vi.mocked(dashboardService.list_Folders).mockImplementation(async () => {
      order.push("folders");
      return { data: { list: [{ folderId: "default", name: "default" }] } };
    });
    vi.mocked(dashboardService.list).mockImplementation(async () => {
      order.push("dashboards");
      return { data: { dashboards: [{ v1: { dashboardId: "d1", title: "D1" } }] } };
    });

    await mountWithSaved([{ object: "dashboard:default/d1", permission: "AllowGet" }]);

    expect(order).toEqual(["folders", "dashboards"]);
  });

  // The expansion keeps its own resource map so a second grant in the same folder
  // reuses the rows the first one loaded.
  it("loads one folder once for two grants inside it", async () => {
    vi.mocked(dashboardService.list).mockResolvedValue({
      data: {
        dashboards: [
          { v1: { dashboardId: "d1", title: "D1" } },
          { v1: { dashboardId: "d2", title: "D2" } },
        ],
      },
    });

    const wrapper = await mountWithSaved([
      { object: "dashboard:default/d1", permission: "AllowGet" },
      { object: "dashboard:default/d2", permission: "AllowPut" },
    ]);

    expect(vi.mocked(dashboardService.list_Folders).mock.calls.length).toBe(1);
    expect(vi.mocked(dashboardService.list).mock.calls.length).toBe(1);
    const folder = wrapper.vm
      .getResourceByName(wrapper.vm.permissionsState.permissions, "dfolder")
      .entities.find((e) => e.name === "default");
    expect(folder.entities.find((e) => e.name === "default/d1").permission.AllowGet.value).toBe(
      true,
    );
    expect(folder.entities.find((e) => e.name === "default/d2").permission.AllowPut.value).toBe(
      true,
    );
  });

  it("expands afolder and its folder to tick a folder-scoped alert grant", async () => {
    const wrapper = await mountWithSaved([{ object: "alert:default/a1", permission: "AllowPut" }]);
    const afolder = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "afolder",
    );
    const alert = afolder.entities
      .find((e) => e.name === "default")
      .entities.find((e) => e.name === "default/a1");
    expect(alert.resourceName).toBe("alert");
    expect(alert.permission.AllowPut.value).toBe(true);
  });

  it("expands rfolder and its folder to tick a folder-scoped report grant", async () => {
    const wrapper = await mountWithSaved([
      { object: "report:default/rep1", permission: "AllowGet" },
    ]);
    const rfolder = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "rfolder",
    );
    const report = rfolder.entities
      .find((e) => e.name === "default")
      .entities.find((e) => e.name === "default/rep1");
    expect(report.resourceName).toBe("report");
    expect(report.permission.AllowGet.value).toBe(true);
  });

  it("swallows a grant for a resource the catalog does not know", async () => {
    const wrapper = await mountWithSaved([
      { object: "not_a_resource:thing", permission: "AllowGet" },
      { object: `role:_all_${ORG}`, permission: "AllowGet" },
    ]);
    // The unknown grant still counts as held; it just has no row to tick.
    expect(wrapper.vm.selectedPermissionsHash.has("not_a_resource:thing:AllowGet")).toBe(true);
    const role = wrapper.vm.getResourceByName(wrapper.vm.permissionsState.permissions, "role");
    expect(role.permission.AllowGet.value).toBe(true);
  });

  it("updateEntityPermission mirrors the held set onto the matching child row", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.selectedPermissionsHash = new Set(["logs:app:AllowGet"]);
    const resource = {
      entities: [
        { name: "app", permission: { AllowGet: { value: false } } },
        { name: "sys", permission: { AllowGet: { value: true } } },
      ],
    };
    wrapper.vm.updateEntityPermission(resource, "logs", "app", "AllowGet");
    expect(resource.entities[0].permission.AllowGet.value).toBe(true);
    // Only the named entity is touched; "sys" keeps its stale value.
    expect(resource.entities[1].permission.AllowGet.value).toBe(true);
  });

  it("updateEntityPermission clears a row whose grant is no longer held", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.selectedPermissionsHash = new Set();
    const resource = { entities: [{ name: "app", permission: { AllowGet: { value: true } } }] };
    wrapper.vm.updateEntityPermission(resource, "logs", "app", "AllowGet");
    expect(resource.entities[0].permission.AllowGet.value).toBe(false);
  });
});

describe("EditRole savedGrants - key helpers", () => {
  useSavedGrantsFixture();
  it("decodePermission splits an object into resource and entity", async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.vm.decodePermission("logs:app")).toEqual({ resource: "logs", entity: "app" });
    expect(wrapper.vm.decodePermission("dashboard:default/d1")).toEqual({
      resource: "dashboard",
      entity: "default/d1",
    });
  });

  // Pinned as-is: split(":") with a 2-way destructure silently drops anything
  // after a second colon, so an entity containing ":" loses its tail.
  it("decodePermission drops everything after a second colon", async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.vm.decodePermission("logs:a:b")).toEqual({ resource: "logs", entity: "a" });
  });

  it("getPermissionHash defaults the entity to _all_<org>", async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.vm.getPermissionHash("stream", "AllowAll")).toBe(`stream:_all_${ORG}:AllowAll`);
    expect(wrapper.vm.getPermissionHash("logs", "AllowGet", "app")).toBe("logs:app:AllowGet");
  });

  it("permissionHashFor builds a type-level key from a Type row", async () => {
    const wrapper = await mountEditRole();
    const stream = wrapper.vm.getResourceByName(wrapper.vm.permissionsState.permissions, "stream");
    expect(stream.type).toBe("Type");
    expect(wrapper.vm.permissionHashFor(stream, "AllowList")).toBe(`stream:_all_${ORG}:AllowList`);
  });

  it("permissionHashFor builds a per-entity key from a non-top-level Resource row", async () => {
    const wrapper = await mountEditRole();
    const row = { type: "Resource", top_level: false, name: "app", resourceName: "logs" };
    expect(wrapper.vm.permissionHashFor(row, "AllowGet")).toBe("logs:app:AllowGet");
  });

  // A top-level "Resource" row is treated as its own resource type: the row's
  // NAME becomes the resource and the entity collapses to the org wildcard.
  it("permissionHashFor rewrites a top-level Resource row to a type-level key", async () => {
    const wrapper = await mountEditRole();
    const row = { type: "Resource", top_level: true, name: "alert", resourceName: "afolder" };
    expect(wrapper.vm.permissionHashFor(row, "AllowGet")).toBe(`alert:_all_${ORG}:AllowGet`);
  });

  it("handlePermissionChange stages an add for an unheld grant", async () => {
    const wrapper = await mountEditRole();
    const stream = wrapper.vm.getResourceByName(wrapper.vm.permissionsState.permissions, "stream");
    wrapper.vm.handlePermissionChange(stream, "AllowGet");
    expect(wrapper.vm.addedPermissions[`stream:_all_${ORG}:AllowGet`]).toEqual({
      object: `stream:_all_${ORG}`,
      permission: "AllowGet",
    });
    expect(wrapper.vm.selectedPermissionsHash.has(`stream:_all_${ORG}:AllowGet`)).toBe(true);
  });

  it("handlePermissionChange twice returns to nothing staged", async () => {
    const wrapper = await mountEditRole();
    const stream = wrapper.vm.getResourceByName(wrapper.vm.permissionsState.permissions, "stream");
    wrapper.vm.handlePermissionChange(stream, "AllowGet");
    wrapper.vm.handlePermissionChange(stream, "AllowGet");
    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([]);
    expect(wrapper.vm.selectedPermissionsHash.has(`stream:_all_${ORG}:AllowGet`)).toBe(false);
  });

  it("handlePermissionChange stages a removal for a saved grant", async () => {
    const wrapper = await mountWithSaved([
      { object: `stream:_all_${ORG}`, permission: "AllowGet" },
    ]);
    const stream = wrapper.vm.getResourceByName(wrapper.vm.permissionsState.permissions, "stream");
    wrapper.vm.handlePermissionChange(stream, "AllowGet");
    expect(wrapper.vm.removedPermissions[`stream:_all_${ORG}:AllowGet`]).toEqual({
      object: `stream:_all_${ORG}`,
      permission: "AllowGet",
    });
    expect(wrapper.vm.selectedPermissionsHash.has(`stream:_all_${ORG}:AllowGet`)).toBe(false);
  });

  it("handlePermissionBatchChange writes the checkbox value and stages each grant", async () => {
    const wrapper = await mountEditRole();
    const stream = wrapper.vm.getResourceByName(wrapper.vm.permissionsState.permissions, "stream");
    const role = wrapper.vm.getResourceByName(wrapper.vm.permissionsState.permissions, "role");
    wrapper.vm.handlePermissionBatchChange([
      { row: stream, permission: "AllowList", newValue: true },
      { row: role, permission: "AllowGet", newValue: true },
    ]);
    expect(stream.permission.AllowList.value).toBe(true);
    expect(role.permission.AllowGet.value).toBe(true);
    expect(Object.keys(wrapper.vm.addedPermissions).sort()).toEqual([
      `role:_all_${ORG}:AllowGet`,
      `stream:_all_${ORG}:AllowList`,
    ]);
  });
});

describe("EditRole savedGrants - readonly preset", () => {
  useSavedGrantsFixture();
  it("seeds AllowList + AllowGet on every visible top-level resource", async () => {
    const wrapper = await mountWithPreset("readonly");
    expect(Object.keys(wrapper.vm.addedPermissions).sort()).toEqual(
      ["stream", "dfolder", "afolder", "rfolder", "role", "db_monitoring"]
        .flatMap((r) => [`${r}:_all_${ORG}:AllowList`, `${r}:_all_${ORG}:AllowGet`])
        .sort(),
    );
  });

  it("never seeds a child resource", async () => {
    const wrapper = await mountWithPreset("readonly");
    const objects = stagedObjects(wrapper);
    expect(objects).not.toContain(`logs:_all_${ORG}`);
    expect(objects).not.toContain(`dashboard:_all_${ORG}`);
    expect(objects).not.toContain(`alert:_all_${ORG}`);
  });

  it("reports nothing — the readonly preset raises no toast", async () => {
    mockToast.mockClear();
    await mountWithPreset("readonly");
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("seeds nothing when the role already holds grants", async () => {
    ctl.rolePermissions = [{ object: `role:_all_${ORG}`, permission: "AllowGet" }];
    const wrapper = await mountWithPreset("readonly");
    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([]);
    expect(wrapper.vm.selectedPermissionsHash.size).toBe(1);
  });

  it("skips a permission the role already holds when seeded directly", async () => {
    const wrapper = await mountWithSaved([{ object: `role:_all_${ORG}`, permission: "AllowGet" }]);
    wrapper.vm.seedReadonlyPreset();
    expect(Object.keys(wrapper.vm.addedPermissions)).toContain(`role:_all_${ORG}:AllowList`);
    expect(Object.keys(wrapper.vm.addedPermissions)).not.toContain(`role:_all_${ORG}:AllowGet`);
  });

  it("applyPreset('readonly') is the same entry point as the query param", async () => {
    const wrapper = await mountEditRole();
    await wrapper.vm.applyPreset("readonly");
    expect(Object.keys(wrapper.vm.addedPermissions).length).toBe(12);
  });

  it("applyPreset ignores an unknown preset id", async () => {
    const wrapper = await mountEditRole();
    await wrapper.vm.applyPreset("nope");
    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([]);
    expect(mockToast).not.toHaveBeenCalled();
  });
});

describe("EditRole savedGrants - dbm preset", () => {
  useSavedGrantsFixture();
  it("stages the curated streams, the LIST-only metrics type node and the module", async () => {
    const wrapper = await mountWithPreset("dbm");
    expect(Object.keys(wrapper.vm.addedPermissions).sort()).toEqual([
      `db_monitoring:_all_${ORG}:AllowGet`,
      `db_monitoring:_all_${ORG}:AllowList`,
      `metrics:_all_${ORG}:AllowList`,
      "metrics:mysql_threads:AllowGet",
      "metrics:postgresql_backends:AllowGet",
    ]);
  });

  it("reports the matched count and total in the toast", async () => {
    mockToast.mockClear();
    await mountWithPreset("dbm");
    expect(mockToast).toHaveBeenCalledWith({
      variant: "info",
      message:
        "Pre-selected read access on 2 of 3 DB Monitoring metric streams, plus the DB Monitoring module. Review before saving.",
    });
  });

  it("warns and still stages the module grant when no curated stream matches", async () => {
    ctl.metricStreams = [{ name: "cpu" }];
    mockToast.mockClear();
    const wrapper = await mountWithPreset("dbm");

    expect(mockToast).toHaveBeenCalledWith({
      variant: "warning",
      message:
        "None of the 3 DB Monitoring metric streams exist in this organization yet, so nothing was pre-selected on them; the DB Monitoring module grant was still staged.",
    });
    expect(Object.keys(wrapper.vm.addedPermissions).sort()).toEqual([
      `db_monitoring:_all_${ORG}:AllowGet`,
      `db_monitoring:_all_${ORG}:AllowList`,
    ]);
  });

  it("seeds nothing when the role already holds grants", async () => {
    ctl.rolePermissions = [{ object: "logs:app", permission: "AllowGet" }];
    mockToast.mockClear();
    const wrapper = await mountWithPreset("dbm");
    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([]);
    expect(mockToast).not.toHaveBeenCalled();
  });
});

describe("EditRole savedGrants - k8s preset", () => {
  useSavedGrantsFixture();
  beforeEach(() => {
    ctl.metricStreams = [{ name: "cpu" }, { name: "k8s_pod_cpu" }, { name: "k8s_node_memory" }];
  });

  it("stages the curated streams plus the LIST-only metrics type node", async () => {
    const wrapper = await mountWithPreset("k8s");
    expect(Object.keys(wrapper.vm.addedPermissions).sort()).toEqual([
      `metrics:_all_${ORG}:AllowList`,
      "metrics:k8s_node_memory:AllowGet",
      "metrics:k8s_pod_cpu:AllowGet",
    ]);
  });

  it("reports the matched count and total in the toast", async () => {
    mockToast.mockClear();
    await mountWithPreset("k8s");
    expect(mockToast).toHaveBeenCalledWith({
      variant: "info",
      message:
        "Pre-selected read access on 2 of 3 Kubernetes metric streams. Review before saving.",
    });
  });

  it("warns and stages nothing when no curated stream matches", async () => {
    ctl.metricStreams = [{ name: "cpu" }];
    mockToast.mockClear();
    const wrapper = await mountWithPreset("k8s");
    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([]);
    expect(mockToast).toHaveBeenCalledWith({
      variant: "warning",
      message:
        "None of the 3 Kubernetes metric streams exist in this organization yet, so nothing was pre-selected.",
    });
  });

  it("seeds nothing when the role already holds grants", async () => {
    ctl.rolePermissions = [{ object: "logs:app", permission: "AllowGet" }];
    mockToast.mockClear();
    const wrapper = await mountWithPreset("k8s");
    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([]);
    expect(mockToast).not.toHaveBeenCalled();
  });
});

describe("EditRole savedGrants - JSON view", () => {
  useSavedGrantsFixture();
  it("serialises the held grants into object/permission pairs", async () => {
    const wrapper = await mountWithSaved([
      { object: `stream:_all_${ORG}`, permission: "AllowGet" },
      { object: "logs:app", permission: "AllowList" },
    ]);
    await wrapper.vm.updatePermissionsUi("json");

    expect(wrapper.vm.permissionsUiType).toBe("json");
    expect(JSON.parse(wrapper.vm.permissionsJsonValue)).toEqual([
      { object: `stream:_all_${ORG}`, permission: "AllowGet" },
      { object: "logs:app", permission: "AllowList" },
    ]);
  });

  it("keeps a folder-scoped object whole when serialising", async () => {
    const wrapper = await mountWithSaved([
      { object: "dashboard:default/d1", permission: "AllowGet" },
    ]);
    await wrapper.vm.updatePermissionsUi("json");
    expect(JSON.parse(wrapper.vm.permissionsJsonValue)).toEqual([
      { object: "dashboard:default/d1", permission: "AllowGet" },
    ]);
  });

  it("stages a grant added only in the JSON", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissionsJsonValue = JSON.stringify([
      { object: "logs:app", permission: "AllowGet" },
    ]);
    wrapper.vm.updateJsonInTable();
    await flushPromises();

    expect(wrapper.vm.selectedPermissionsHash.has("logs:app:AllowGet")).toBe(true);
    expect(wrapper.vm.addedPermissions["logs:app:AllowGet"]).toEqual({
      object: "logs:app",
      permission: "AllowGet",
    });
  });

  it("stages a removal for a saved grant dropped from the JSON", async () => {
    const wrapper = await mountWithSaved([{ object: "logs:app", permission: "AllowGet" }]);
    wrapper.vm.permissionsJsonValue = "[]";
    wrapper.vm.updateJsonInTable();
    await flushPromises();

    expect(wrapper.vm.selectedPermissionsHash.has("logs:app:AllowGet")).toBe(false);
    expect(wrapper.vm.removedPermissions["logs:app:AllowGet"]).toEqual({
      object: "logs:app",
      permission: "AllowGet",
    });
  });

  it("clears the stream row checkbox when the JSON drops its grant", async () => {
    const wrapper = await mountWithSaved([{ object: "logs:app", permission: "AllowGet" }]);
    wrapper.vm.permissionsJsonValue = "[]";
    wrapper.vm.updateJsonInTable();
    await flushPromises();

    const row = (wrapper.vm.heavyResourceEntities["logs"] ?? []).find((r) => r.name === "app");
    expect(row.permission.AllowGet.value).toBe(false);
  });

  // Invalid JSON throws out of JSON.parse before anything is mutated, so the
  // staged state survives — but the caller gets a raw SyntaxError, not a toast.
  it("throws on invalid JSON without destroying the staged state", async () => {
    const wrapper = await mountWithSaved([{ object: "logs:app", permission: "AllowGet" }]);
    const stream = wrapper.vm.getResourceByName(wrapper.vm.permissionsState.permissions, "stream");
    wrapper.vm.handlePermissionChange(stream, "AllowList");

    wrapper.vm.permissionsJsonValue = "{not json";
    expect(() => wrapper.vm.updateJsonInTable()).toThrow(SyntaxError);

    expect(wrapper.vm.selectedPermissionsHash.has("logs:app:AllowGet")).toBe(true);
    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([`stream:_all_${ORG}:AllowList`]);
    expect(Object.keys(wrapper.vm.removedPermissions)).toEqual([]);
  });

  it("round-trips table -> JSON -> table with the same grant set", async () => {
    const wrapper = await mountWithSaved([
      { object: `stream:_all_${ORG}`, permission: "AllowGet" },
      { object: "logs:app", permission: "AllowList" },
      { object: "dashboard:default/d1", permission: "AllowPut" },
    ]);
    const before = [...wrapper.vm.selectedPermissionsHash].sort();

    await wrapper.vm.updatePermissionsUi("json");
    await wrapper.vm.updatePermissionsUi("table");
    await flushPromises();

    expect([...wrapper.vm.selectedPermissionsHash].sort()).toEqual(before);
    expect(wrapper.vm.permissionsUiType).toBe("table");
    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([]);
    expect(Object.keys(wrapper.vm.removedPermissions)).toEqual([]);
  });

  it("carries a staged add through the round trip", async () => {
    const wrapper = await mountEditRole();
    const role = wrapper.vm.getResourceByName(wrapper.vm.permissionsState.permissions, "role");
    wrapper.vm.handlePermissionChange(role, "AllowGet");

    await wrapper.vm.updatePermissionsUi("json");
    await wrapper.vm.updatePermissionsUi("table");
    await flushPromises();

    expect([...wrapper.vm.selectedPermissionsHash]).toEqual([`role:_all_${ORG}:AllowGet`]);
    expect(Object.keys(wrapper.vm.addedPermissions)).toEqual([`role:_all_${ORG}:AllowGet`]);
  });
});
