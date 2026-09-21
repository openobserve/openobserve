// Characterization tests for EditRole.vue's saved-grant loading, presets and
// JSON view. They record TODAY'S behaviour so a refactor that splits the file
// up fails loudly. Do not "fix" an assertion here to match what the code
// should do — change the source and then re-pin.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { queryClient } from "@/composables/query/queryClient";

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

// @ts-expect-error test router helper
router.isReady = () => Promise.resolve();

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, routeGuard: vi.fn((_to, _from, next) => next()) };
});

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "true" },
}));

// Shared mutable state for the hoisted service mocks.
const ctl = vi.hoisted(() => ({
  callOrder: [] as string[],
  rolePermissions: [] as { object: string; permission: string }[],
  resourcesError: null as any,
  metricStreams: null as { name: string }[] | null,
}));

vi.mock("@/components/iam/roles/dbmViewerPreset", () => ({
  DBM_VIEWER_STREAMS: ["postgresql_backends", "mysql_threads", "dbm_absent_stream"],
  DBM_VIEWER_STREAM_ROW_PERMS: ["AllowGet"],
  DBM_VIEWER_TYPE_NODE_PERMS: ["AllowList"],
  DBM_MODULE_RESOURCE: "db_monitoring",
}));

vi.mock("@/components/iam/roles/k8sViewerPreset", () => ({
  K8S_VIEWER_STREAMS: ["k8s_pod_cpu", "k8s_node_memory", "k8s_absent_stream"],
  K8S_VIEWER_STREAM_ROW_PERMS: ["AllowGet"],
  K8S_VIEWER_TYPE_NODE_PERMS: ["AllowList"],
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn(async (type: string) => {
      const map: Record<string, any> = {
        logs: { list: [{ name: "app" }, { name: "sys" }] },
        metrics: {
          list: ctl.metricStreams ?? [
            { name: "cpu" },
            { name: "postgresql_backends" },
            { name: "mysql_threads" },
          ],
        },
        traces: { list: [{ name: "svc-a" }] },
        index: { list: [{ name: "users" }] },
      };
      return map[type] || { list: [] };
    }),
  }),
}));

const RESOURCE_CATALOG = [
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

vi.mock("@/services/iam", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    getResources: vi.fn(async () => {
      ctl.callOrder.push("getResources");
      if (ctl.resourcesError) throw ctl.resourcesError;
      return { data: RESOURCE_CATALOG };
    }),
    getResourcePermission: vi.fn(async () => ({ data: [] })),
    getAllRolePermissions: vi.fn(async () => {
      ctl.callOrder.push("getAllRolePermissions");
      return { data: ctl.rolePermissions.map((p) => ({ ...p })) };
    }),
    getRoleUsers: vi.fn(async () => {
      ctl.callOrder.push("getRoleUsers");
      return { data: ["u1@example.com"] };
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
vi.mock("@/services/dashboards", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      // The real endpoint wraps each dashboard in a version key, and getDashboards
      // reads the first truthy value out of it.
      list: vi.fn(async () => ({
        data: { dashboards: [{ v1: { dashboardId: "d1", title: "D1" } }] },
      })),
      list_Folders: vi.fn(async () => ({
        data: { list: [{ folderId: "default", name: "default" }] },
      })),
    },
  });
});
vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      listByFolderId: vi.fn(async () => ({
        data: { list: [{ alert_id: "a1", name: "A1" }] },
      })),
    },
  });
});
vi.mock("@/services/reports", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      listByFolderId: vi.fn(async () => ({
        data: { list: [{ report_id: "rep1", name: "Report One" }] },
      })),
    },
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
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn(async () => ({ data: { data: [] } })) },
  });
});

import dashboardService from "@/services/dashboards";
import EditRole from "@/components/iam/roles/EditRole.vue";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const ORG = store.state.selectedOrganization.identifier;

const editorStub = defineComponent({
  name: "QueryEditorStub",
  props: { query: { type: String, default: "" } },
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

async function mountEditRole(customStubs: Record<string, any> = {}) {
  router.currentRoute.value.name = "editRole";
  router.currentRoute.value.params = { role_name: "Admin" } as any;

  const wrapper = mount(EditRole as any, {
    attachTo: node,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        AppTabs: { template: `<div data-test="app-tabs-stub"></div>` },
        ModuleRail: { template: `<div data-test="module-rail-stub"></div>` },
        GroupUsers: { template: '<div data-test="group-users-stub"></div>' },
        GroupServiceAccounts: { template: '<div data-test="group-sa-stub"></div>' },
        QueryEditor: editorStub,
        ...customStubs,
      },
    },
  });

  await flushPromises();
  await flushPromises();
  return wrapper;
}

const mountWithSaved = async (perms: { object: string; permission: string }[]) => {
  ctl.rolePermissions = perms;
  return mountEditRole();
};

const mountWithPreset = async (preset: string) => {
  router.currentRoute.value.query = { preset } as any;
  const wrapper = await mountEditRole();
  await flushPromises();
  router.currentRoute.value.query = {};
  return wrapper;
};

const stagedObjects = (wrapper: any) =>
  Object.values(wrapper.vm.addedPermissions).map((p: any) => p.object);

beforeEach(() => {
  // resourcesQuery is cached by TanStack, so without this the second mount
  // never re-calls getResources and the call-order pins go stale.
  queryClient.clear();
  ctl.callOrder = [];
  ctl.rolePermissions = [];
  ctl.resourcesError = null;
  ctl.metricStreams = null;
  router.currentRoute.value.query = {};
});

afterEach(() => {
  vi.clearAllMocks();
  mockToast.mockClear();
});

describe("EditRole savedGrants - getRoleDetails orchestration", () => {
  it("fetches resources, then the role's permissions, then its users", async () => {
    await mountEditRole();
    expect(ctl.callOrder).toEqual(["getResources", "getAllRolePermissions", "getRoleUsers"]);
  });

  it("drops invisible resources and orders the rest by `order`", async () => {
    const wrapper = await mountEditRole();
    const keys = wrapper.vm.permissionsState.resources.map((r: any) => r.key);
    expect(keys).not.toContain("hidden_thing");
    expect(keys.slice(0, 3)).toEqual(["stream", "logs", "metrics"]);
  });

  it("leaves isFetchingInitialRoles false once the chain settles", async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.vm.isFetchingInitialRoles).toBe(false);
  });

  it("flips isFetchingInitialRoles true before the first await resolves", async () => {
    const wrapper = mount(EditRole as any, {
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
    const app = rows.find((r: any) => r.name === "app");
    expect(app.resourceName).toBe("logs");
    expect(app.type).toBe("Resource");
    expect(app.permission.AllowGet.value).toBe(true);
    expect(rows.find((r: any) => r.name === "sys").permission.AllowGet.value).toBe(false);
  });

  it("expands dfolder and its folder to tick a folder-scoped dashboard grant", async () => {
    const wrapper = await mountWithSaved([
      { object: "dashboard:default/d1", permission: "AllowGet" },
    ]);
    const dfolder = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "dfolder",
    );
    const folder = dfolder.entities.find((e: any) => e.name === "default");
    expect(folder).toBeDefined();
    const dash = folder.entities.find((e: any) => e.name === "default/d1");
    expect(dash).toBeDefined();
    expect(dash.resourceName).toBe("dashboard");
    expect(dash.permission.AllowGet.value).toBe(true);
  });

  // The grant names a dashboard, but nothing is loaded yet: the folders must be
  // fetched first, then that folder's dashboards, or the row can never be found.
  it("loads the folder list before that folder's dashboards", async () => {
    const order: string[] = [];
    (dashboardService.list_Folders as any).mockImplementation(async () => {
      order.push("folders");
      return { data: { list: [{ folderId: "default", name: "default" }] } };
    });
    (dashboardService.list as any).mockImplementation(async () => {
      order.push("dashboards");
      return { data: { dashboards: [{ v1: { dashboardId: "d1", title: "D1" } }] } };
    });

    await mountWithSaved([{ object: "dashboard:default/d1", permission: "AllowGet" }]);

    expect(order).toEqual(["folders", "dashboards"]);
  });

  // The expansion keeps its own resource map so a second grant in the same folder
  // reuses the rows the first one loaded.
  it("loads one folder once for two grants inside it", async () => {
    (dashboardService.list as any).mockResolvedValue({
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

    expect((dashboardService.list_Folders as any).mock.calls.length).toBe(1);
    expect((dashboardService.list as any).mock.calls.length).toBe(1);
    const folder = wrapper.vm
      .getResourceByName(wrapper.vm.permissionsState.permissions, "dfolder")
      .entities.find((e: any) => e.name === "default");
    expect(
      folder.entities.find((e: any) => e.name === "default/d1").permission.AllowGet.value,
    ).toBe(true);
    expect(
      folder.entities.find((e: any) => e.name === "default/d2").permission.AllowPut.value,
    ).toBe(true);
  });

  it("expands afolder and its folder to tick a folder-scoped alert grant", async () => {
    const wrapper = await mountWithSaved([{ object: "alert:default/a1", permission: "AllowPut" }]);
    const afolder = wrapper.vm.getResourceByName(
      wrapper.vm.permissionsState.permissions,
      "afolder",
    );
    const alert = afolder.entities
      .find((e: any) => e.name === "default")
      .entities.find((e: any) => e.name === "default/a1");
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
      .find((e: any) => e.name === "default")
      .entities.find((e: any) => e.name === "default/rep1");
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

    const row = (wrapper.vm.heavyResourceEntities["logs"] ?? []).find((r: any) => r.name === "app");
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
