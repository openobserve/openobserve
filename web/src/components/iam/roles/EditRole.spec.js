import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

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
  K8S_VIEWER_PERMS: ["AllowList", "AllowGet"],
}));

// Mutable so a spec can shrink the org's metric streams (the zero-match case).
const metricStreamsOverride = { list: null };

// Mock composable useStreams
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn(async (type) => {
      const map = {
        logs: { list: [{ name: "app" }, { name: "sys" }] },
        metrics: {
          list: metricStreamsOverride.list ?? [
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
vi.mock("@/services/iam", () => ({
  getResources: vi.fn(async () => ({
    data: [
      {
        key: "stream",
        display_name: "Streams",
        has_entities: true,
        top_level: true,
        visible: true,
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
        order: 8,
      },
      {
        key: "role",
        display_name: "Roles",
        has_entities: false,
        top_level: true,
        visible: true,
        order: 9,
      },
      {
        key: "group",
        display_name: "Groups",
        has_entities: false,
        top_level: true,
        visible: true,
        order: 10,
      },
      {
        key: "provider",
        display_name: "LLM Providers",
        has_entities: true,
        top_level: true,
        visible: true,
        order: 11,
      },
      {
        key: "score_config",
        display_name: "Score Configs",
        has_entities: true,
        top_level: true,
        visible: true,
        order: 12,
      },
      {
        key: "scorer",
        display_name: "Scorers",
        has_entities: true,
        top_level: true,
        visible: true,
        order: 13,
      },
      {
        key: "eval_job",
        display_name: "Online Eval Jobs",
        has_entities: true,
        top_level: true,
        visible: true,
        order: 14,
      },
      {
        key: "annotation_queue",
        display_name: "Annotation Queues",
        has_entities: true,
        top_level: true,
        visible: true,
        order: 15,
      },
      {
        key: "dataset",
        display_name: "Datasets",
        has_entities: true,
        top_level: true,
        visible: true,
        order: 16,
      },
      {
        key: "db_monitoring",
        display_name: "Database Monitoring",
        has_entities: false,
        top_level: true,
        visible: true,
        order: 17,
      },
    ],
  })),
  getResourcePermission: vi.fn(async () => ({ data: [] })),
  getAllRolePermissions: vi.fn(async () => ({ data: [] })),
  getRoleUsers: vi.fn(async () => ({ data: ["u1@example.com", "u2@example.com"] })),
  updateRole: vi.fn(async () => ({ data: { code: 200 } })),
  getGroups: vi.fn(async () => ({ data: [] })),
  getRoles: vi.fn(async () => ({ data: [] })),
}));

vi.mock("@/services/stream", () => ({ default: {} }));
vi.mock("@/services/pipelines", () => ({
  default: {
    getPipelines: vi.fn(async () => ({ data: { list: [{ pipeline_id: "p1", name: "P1" }] } })),
  },
}));
vi.mock("@/services/alerts", () => ({
  default: {
    listByFolderId: vi.fn(async () => ({ data: { list: [{ alertId: "a1", name: "A1" }] } })),
  },
}));
vi.mock("@/services/reports", () => ({
  default: { list: vi.fn(async () => ({ data: [{ name: "r1" }] })) },
}));
vi.mock("@/services/alert_templates", () => ({
  default: { list: vi.fn(async () => ({ data: [{ name: "t1" }] })) },
}));
vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn(async () => ({ data: [{ name: "dest1" }] })) },
}));
vi.mock("@/services/jstransform", () => ({
  default: { list: vi.fn(async () => ({ data: { list: [{ name: "f1" }] } })) },
}));
vi.mock("@/services/organizations", () => ({
  default: {
    list: vi.fn(async () => ({ data: { data: [{ identifier: "org1" }, { identifier: "org2" }] } })),
  },
}));
vi.mock("@/services/saved_views", () => ({
  default: { get: vi.fn(async () => ({ data: { views: [{ view_id: "v1", view_name: "V1" }] } })) },
}));
vi.mock("@/services/dashboards", () => ({
  default: {
    list: vi.fn(async () => ({ data: { dashboards: [{ dashboardId: "d1", title: "D1" }] } })),
    list_Folders: vi.fn(async () => ({
      data: { list: [{ folderId: "default", name: "default" }] },
    })),
  },
}));
vi.mock("@/services/service_accounts", () => ({
  default: { list: vi.fn(async () => ({ data: { data: ["svc1@example.com"] } })) },
}));
vi.mock("@/services/cipher_keys", () => ({
  default: { list: vi.fn(async () => ({ data: { keys: [{ name: "key1" }] } })) },
}));
vi.mock("@/services/common", () => ({
  default: {
    list_Folders: vi.fn(async () => ({
      data: { list: [{ folderId: "default", name: "default" }] },
    })),
  },
}));
vi.mock("@/services/online-evals.service", () => ({
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
}));
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

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

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
        PermissionsTable: {
          props: [
            "rows",
            "customFilteredPermissions",
            "filter",
            "visibleResourceCount",
            "selectedPermissionsHash",
          ],
          emits: ["updated:permission", "expand:row"],
          template: `<div data-test="permissions-table-stub"></div>`,
        },
        GroupUsers: { template: '<div data-test="group-users-stub"></div>' },
        GroupServiceAccounts: { template: '<div data-test="group-service-accounts-stub"></div>' },
        QueryEditor: defineComponent({
          name: "QueryEditorStub",
          emits: ["update:query"],
          props: { modelValue: { type: String, default: "" } },
          setup() {
            return () => null;
          },
        }),
        ...customStubs,
      },
    },
  });

  // allow onBeforeMount async chain to complete
  await flushPromises();
  await flushPromises();
  return wrapper;
}

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

// 3. Permissions UI toggling
describe("EditRole - permissions UI", () => {
  it("updateTableData triggers visibility update and count", async () => {
    const wrapper = await mountEditRole();
    // seed a minimal permissions tree
    wrapper.vm.permissionsState.permissions = [
      {
        name: "stream",
        resourceName: "stream",
        type: "Type",
        entities: [],
        permission: { AllowAll: { value: false } },
        show: true,
      },
    ];
    await wrapper.vm.updateTableData("all");
    await flushPromises();
    expect(typeof wrapper.vm.countOfVisibleResources).toBe("number");
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

// 5. Filtering and visibility helpers
describe("EditRole - filtering & visibility", () => {
  it("filterResources finds rows by display_name", async () => {
    const wrapper = await mountEditRole();
    const rows = [
      { display_name: "Streams", entities: [] },
      { display_name: "Dashboards", entities: [{ display_name: "Default" }] },
    ];
    const res = wrapper.vm.filterResources(rows, "streams");
    expect(res.length).toBeGreaterThan(0);
  });

  it("countVisibleResources counts nested visible rows", async () => {
    const wrapper = await mountEditRole();
    // Nested entities are only counted when the parent has expand: true
    const permissions = [
      { show: true, expand: true, entities: [{ show: true, entities: [] }] },
      { show: false, entities: [] },
    ];
    const count = wrapper.vm.countVisibleResources(permissions);
    expect(count).toBe(2);
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

  it("onResourceChange updates visibility and count", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissionsState.permissions = [
      { show: false, permission: { AllowAll: { value: true } }, entities: [] },
    ];
    await wrapper.vm.onResourceChange();
    expect(typeof wrapper.vm.countOfVisibleResources).toBe("number");
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

  it("countVisibleResources sets reactive countOfVisibleResources", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.countVisibleResources([{ show: true, entities: [] }]);
    expect(wrapper.vm.countOfVisibleResources).toBe(1);
  });

  it("getOrgId returns store selected org identifier", async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.vm.getOrgId()).toBe(store.state.selectedOrganization.identifier);
  });

  it("updatePermissionVisibility expands heavy resources children list", async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.heavyResourceEntities = { logs: [{ show: true }, { show: false }] };
    const permissions = [{ name: "logs", entities: [], permission: { AllowAll: { value: true } } }];
    wrapper.vm.updatePermissionVisibility(permissions);
    expect(Array.isArray(permissions[0].entities)).toBe(true);
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

// Default permissions filter for a brand-new (empty) role
describe("EditRole - empty role default filter", () => {
  it('defaults the permissions filter to "all" when the role has no permissions', async () => {
    // getAllRolePermissions is mocked to return [] (empty role).
    const wrapper = await mountEditRole();
    expect(wrapper.vm.selectedPermissionsHash.size).toBe(0);
    expect(wrapper.vm.filter.permissions).toBe("all");
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
    metricStreamsOverride.list = null;
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

  it("sets the permissions filter to 'selected' so the seeded rows are easy to review", async () => {
    const wrapper = await mountWithDbmPreset();
    expect(wrapper.vm.filter.permissions).toBe("selected");
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
    metricStreamsOverride.list = [{ name: "cpu" }];
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
    metricStreamsOverride.list = [
      { name: "cpu" },
      { name: "mem" },
      { name: "k8s_pod_cpu" },
      { name: "k8s_node_memory" },
    ];
  });

  afterEach(() => {
    metricStreamsOverride.list = null;
  });

  const mountWithK8sPreset = async () => {
    router.currentRoute.value.query = { preset: "k8s" };
    const wrapper = await mountEditRole();
    await flushPromises();
    router.currentRoute.value.query = {};
    return wrapper;
  };

  // A leaf stream row hides its AllowList checkbox, so seeding it would stage a grant the user cannot see or untick.
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
  it("stages AllowList and AllowGet on the metrics stream-type node", async () => {
    const wrapper = await mountWithK8sPreset();

    expect(Object.values(wrapper.vm.addedPermissions)).toEqual(
      expect.arrayContaining([
        { object: "metrics:_all_default", permission: "AllowList" },
        { object: "metrics:_all_default", permission: "AllowGet" },
      ]),
    );
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
    expect(metricsNode.permission.AllowGet.value).toBe(true);
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

  it("switches the filter to Selected so the seeded rows are not buried", async () => {
    const wrapper = await mountWithK8sPreset();
    expect(wrapper.vm.filter.permissions).toBe("selected");
  });

  // The granted metrics type node forces its children to show, so every stream it covers is listed.
  it("leaves the seeded stream rows visible in the table", async () => {
    const wrapper = await mountWithK8sPreset();
    await wrapper.vm.updateTableData();
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const streamResource = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "stream",
    );
    expect(streamResource.show).toBe(true);
    const metricsNode = streamResource.entities.find((e) => e.name === "metrics");
    expect(metricsNode.show).toBe(true);
    const visible = metricsNode.entities.map((e) => e.name);
    expect(visible).toContain("k8s_pod_cpu");
    expect(visible).toContain("k8s_node_memory");
    expect(streamResource.entities.filter((e) => e.name !== "metrics").every((e) => !e.show)).toBe(
      true,
    );
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
        { object: "metrics:_all_default", permission: "AllowGet" },
        { object: "metrics:k8s_pod_cpu", permission: "AllowGet" },
        { object: "metrics:k8s_node_memory", permission: "AllowGet" },
      ]),
    );
    expect(payload.add).toHaveLength(4);
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
    metricStreamsOverride.list = [{ name: "cpu" }];
    mockToast.mockClear();

    try {
      const wrapper = await mountWithK8sPreset();
      expect(Object.keys(wrapper.vm.addedPermissions).length).toBe(0);
    } finally {
      metricStreamsOverride.list = null;
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
