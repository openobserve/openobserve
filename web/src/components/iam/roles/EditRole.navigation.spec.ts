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

// Characterization suite for the rail, the scope ladder, the module view model,
// the summary and saving. It records what EditRole.vue does TODAY so a refactor
// that splits the file up fails loudly. Never edit a test to make it pass.

import { describe, it, expect, afterEach, vi } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

// @ts-expect-error test helper router has no real readiness to await
router.isReady = () => Promise.resolve();

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    routeGuard: vi.fn((_to: unknown, _from: unknown, next: () => void) => next()),
  };
});

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "true" },
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
      const map: Record<string, { list: { name: string }[] }> = {
        logs: { list: [{ name: "app" }, { name: "sys" }] },
        metrics: { list: [{ name: "cpu" }, { name: "mem" }] },
        traces: { list: [{ name: "svc-a" }] },
        index: { list: [{ name: "users" }] },
        enrichment_tables: { list: [{ name: "geo" }] },
        metadata: { list: [{ name: "meta" }] },
      };
      return map[type] || { list: [] };
    }),
  }),
}));

vi.mock("@/services/iam", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  const getResources = vi.fn(async () => ({
    data: [
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
    ],
  }));
  return overlayServiceMock(await importOriginal(), {
    getResources,
    getResourcePermission: vi.fn(async () => ({ data: [] })),
    getAllRolePermissions: vi.fn(async () => ({ data: [] })),
    getRoleUsers: vi.fn(async () => ({ data: ["u1@example.com", "u2@example.com"] })),
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
    default: { list: vi.fn(async () => ({ data: [{ name: "r1" }] })) },
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
      providers: { list: vi.fn(async () => [{ id: "openai", name: "OpenAI" }]) },
      scoreConfigs: { list: vi.fn(async () => []) },
      scorers: { list: vi.fn(async () => []) },
      jobs: { list: vi.fn(async () => []) },
    },
  });
});
vi.mock("@/services/llm-queues.service", () => ({
  default: { list: vi.fn(async () => []) },
}));
vi.mock("@/services/llm-datasets.service", () => ({
  default: { list: vi.fn(async () => []) },
}));

import EditRole from "@/components/iam/roles/EditRole.vue";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const ORG = store.state.selectedOrganization.identifier;
const ALL = `_all_${ORG}`;

async function mountEditRole() {
  router.currentRoute.value.name = "editRole";
  router.currentRoute.value.params = { role_name: "Admin" };
  router.currentRoute.value.query = {};

  const wrapper = mount(EditRole, {
    attachTo: node,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        AppTabs: {
          props: ["tabs", "activeTab"],
          emits: ["update:active-tab"],
          template: `<div data-test="app-tabs-stub"></div>`,
        },
        ModuleRail: {
          props: ["modules", "modelValue"],
          emits: ["update:modelValue"],
          template: `<div data-test="module-rail-stub"></div>`,
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
      },
    },
  });

  await flushPromises();
  await flushPromises();
  return wrapper.vm as any;
}

const withSaved = (vm: any, keys: string[]) => {
  vm.permissionsHash = new Set(keys);
  vm.selectedPermissionsHash = new Set(keys);
};

const openModuleView = async (vm: any, moduleKey: string) => {
  vm.activeModule = moduleKey;
  await flushPromises();
};

const drillInto = async (vm: any, moduleKey: string, rowName: string) => {
  await openModuleView(vm, moduleKey);
  const row = vm.activeModuleView.entities.find((entity: any) => entity.name === rowName);
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
  const addOrgResource = (vm: any) => {
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
      const vm = await mountEditRole();
      addOrgResource(vm);
      expect(vm.grantableResources.map((resource: any) => resource.key)).not.toContain("org");
    } finally {
      store.state.zoConfig.meta_org = metaOrg;
    }
  });

  it("keeps the org resource inside the meta org", async () => {
    const vm = await mountEditRole();
    addOrgResource(vm);
    expect(vm.grantableResources.map((resource: any) => resource.key)).toContain("org");
  });
});

describe("EditRole - rail modules [characterization]", () => {
  it("folds stream children into the one Streams module", async () => {
    const vm = await mountEditRole();
    const stream = vm.roleModules.find((module: any) => module.key === "stream");
    expect(stream.countedKeys).toEqual(["stream", "logs", "metrics"]);
    expect(stream.hasEntities).toBe(true);
  });

  it("describes a rail module with its label, icon and group", async () => {
    const vm = await mountEditRole();
    const stream = vm.railModules.find((module: any) => module.key === "stream");
    expect(stream).toMatchObject({
      key: "stream",
      label: "Streams",
      icon: "window",
      groupId: "data",
      groupLabel: i18n.global.t("iam.editRole.moduleGroupData"),
    });
  });

  it("orders the rail by module group", async () => {
    const vm = await mountEditRole();
    const groups = vm.railModules.map((module: any) => module.groupId);
    expect(groups.indexOf("data")).toBeLessThan(groups.indexOf("access"));
  });

  // Counts on Streams add up across stream, logs and metrics, which are three separate grant resources.
  it("sums granted, added and removed across every counted resource", async () => {
    const vm = await mountEditRole();
    withSaved(vm, ["logs:app:AllowGet", "metrics:cpu:AllowGet", `stream:${ALL}:AllowList`]);

    vm.updatePermissionMappings("metrics:mem:AllowGet");
    vm.updatePermissionMappings("logs:app:AllowGet");

    const stream = vm.railModules.find((module: any) => module.key === "stream");
    expect({ granted: stream.granted, added: stream.added, removed: stream.removed }).toEqual({
      granted: 3,
      added: 1,
      removed: 1,
    });
  });
});

describe("EditRole - active module view [characterization]", () => {
  it("lists a plain module's entities under its own type scope", async () => {
    const vm = await mountEditRole();
    await openModuleView(vm, "provider");

    expect(vm.activeModuleView.trail).toEqual(["LLM Providers"]);
    expect(vm.activeModuleView.scopes.map((scope: any) => scope.key)).toEqual(["provider"]);
    expect(vm.activeModuleView.entities).toBe(vm.resourceMapper.provider.entities);
    expect(vm.activeModuleView.entities.map((row: any) => row.name)).toEqual(["openai"]);
  });

  it("reads a drilled stream type's rows from heavyResourceEntities", async () => {
    const vm = await mountEditRole();
    await drillInto(vm, "stream", "metrics");

    expect(vm.activeModuleView.trail).toEqual(["Streams", "Metrics"]);
    expect(vm.activeModuleView.entities).toBe(vm.heavyResourceEntities.metrics);
    expect(vm.activeModuleView.entities.map((row: any) => row.name)).toEqual(["cpu", "mem"]);
  });

  it("reads a drilled folder's rows from the folder node", async () => {
    const vm = await mountEditRole();
    const folder = await drillInto(vm, "dfolder", "default");

    expect(vm.activeModuleView.trail).toEqual(["Dash Folders", "default"]);
    expect(vm.activeModuleView.entities).toBe(folder.entities);
    expect(vm.activeModuleView.entities.map((row: any) => row.name)).toEqual(["d1"]);
  });
});

describe("EditRole - navigation [characterization]", () => {
  it("clears the loading marker once the module's entities land", async () => {
    const vm = await mountEditRole();
    await openModuleView(vm, "provider");
    expect(vm.loadingFor).toBe("");
    expect(vm.moduleLoading).toBe(false);
  });

  it("reports loading while the open module is the one in flight", async () => {
    const vm = await mountEditRole();
    await openModuleView(vm, "provider");
    vm.loadingFor = "provider";
    await flushPromises();
    expect(vm.moduleLoading).toBe(true);
  });

  it("reports loading while the open folder is the one in flight", async () => {
    const vm = await mountEditRole();
    await drillInto(vm, "dfolder", "default");
    vm.loadingFor = "default";
    await flushPromises();
    expect(vm.moduleLoading).toBe(true);
  });

  // A slower module must not clear the spinner of the one now on screen.
  it("ignores a stale module's loading marker", async () => {
    const vm = await mountEditRole();
    await openModuleView(vm, "provider");
    vm.loadingFor = "dfolder";
    await flushPromises();
    expect(vm.moduleLoading).toBe(false);
  });
});

describe("EditRole - tabs and dirty state [characterization]", () => {
  it("lists permissions, users and service accounts when service accounts are enabled", async () => {
    const vm = await mountEditRole();
    expect(vm.tabs.map((tab: any) => tab.value)).toEqual([
      "permissions",
      "users",
      "serviceAccounts",
    ]);
    expect(vm.tabs.map((tab: any) => tab.icon)).toEqual(["shield", "group", "smart-toy"]);
  });

  it("hides the service accounts tab when the feature is off", async () => {
    const enabled = store.state.zoConfig.service_account_enabled;
    store.state.zoConfig.service_account_enabled = false;
    try {
      const vm = await mountEditRole();
      expect(vm.tabs.map((tab: any) => tab.value)).toEqual(["permissions", "users"]);
    } finally {
      store.state.zoConfig.service_account_enabled = enabled;
    }
  });

  it("clears the permissions dirty flag when a change is undone", async () => {
    const vm = await mountEditRole();
    vm.updatePermissionMappings("metrics:cpu:AllowGet");
    expect(vm.isPermissionsDirty).toBe(true);

    vm.updatePermissionMappings("metrics:cpu:AllowGet");
    expect(vm.isPermissionsDirty).toBe(false);
    expect(vm.isAnyDirty).toBe(false);
  });

  it("counts a staged user removal as dirty", async () => {
    const vm = await mountEditRole();
    vm.removedUsers.add("u1@example.com");
    await vm.$nextTick();

    expect(vm.isUsersDirty).toBe(true);
    expect(vm.isServiceAccountsDirty).toBe(false);
    expect(vm.isAnyDirty).toBe(true);
  });

  it("counts a staged service account removal as dirty on its own tab", async () => {
    const vm = await mountEditRole();
    vm.removedServiceAccounts.add("svc1@example.com");
    await vm.$nextTick();

    expect(vm.isServiceAccountsDirty).toBe(true);
    expect(vm.isUsersDirty).toBe(false);
  });

  // The leave guard holds the navigation in a promise the dialog resolves.
  it("resolves the held navigation with the user's answer and forgets the resolver", async () => {
    const vm = await mountEditRole();
    const resolve = vi.fn();
    vm.leaveConfirm = { show: true, resolve };

    vm.onLeaveConfirm(true);

    expect(resolve).toHaveBeenCalledWith(true);
    expect(vm.leaveConfirm.show).toBe(false);
    expect(vm.leaveConfirm.resolve).toBeNull();
  });

  it("opens with no dialog and nothing to resolve", async () => {
    const vm = await mountEditRole();
    expect(vm.leaveConfirm).toEqual({ show: false, resolve: null });
  });
});

describe("EditRole - save failures", () => {
  const failSave = async (status: number) => {
    const { updateRole } = await import("@/services/iam");
    const vm = await mountEditRole();
    vi.mocked(updateRole).mockRejectedValueOnce({ response: { status } });
    vm.updatePermissionMappings("logs:app:AllowPut");
    mockToast.mockClear();

    await vm.saveRole();
    await flushPromises();
    return mockToast.mock.calls.map(([arg]: any[]) => arg?.variant);
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
  it("sends permissions and both kinds of principal in one payload", async () => {
    const { updateRole } = await import("@/services/iam");
    const vm = await mountEditRole();
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
    const vm = await mountEditRole();
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
    const vm = await mountEditRole();
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
    const vm = await mountEditRole();
    vi.mocked(updateRole).mockClear();
    vm.addedUsers.add("both@example.com");
    vm.addedServiceAccounts.add("both@example.com");

    await vm.saveRole();
    await flushPromises();

    expect(vi.mocked(updateRole).mock.calls[0][0].payload.add_users).toEqual(["both@example.com"]);
  });

  it("flushes the JSON editor into the payload before saving", async () => {
    const { updateRole } = await import("@/services/iam");
    const vm = await mountEditRole();
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
  const stage = (vm: any) => {
    withSaved(vm, ["logs:sys:AllowGet"]);
    vm.updatePermissionMappings("logs:app:AllowPut");
    vm.updatePermissionMappings("logs:sys:AllowGet");
    vm.addedUsers.add("new@example.com");
    vm.removedUsers.add("u1@example.com");
    vm.addedServiceAccounts.add("svc@example.com");
  };

  it("promotes the staged grants to the baseline and clears the staging", async () => {
    const vm = await mountEditRole();
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
    const vm = await mountEditRole();
    stage(vm);

    await vm.saveRole();
    await flushPromises();

    const stream = vm.railModules.find((module: any) => module.key === "stream");
    expect({ granted: stream.granted, added: stream.added, removed: stream.removed }).toEqual({
      granted: 1,
      added: 0,
      removed: 0,
    });
  });

  it("applies the staged membership to the role's user list and clears both tabs", async () => {
    const vm = await mountEditRole();
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
    const vm = await mountEditRole();
    stage(vm);
    await vm.saveRole();
    await flushPromises();

    vi.mocked(updateRole).mockClear();
    await vm.saveRole();

    expect(vi.mocked(updateRole)).not.toHaveBeenCalled();
  });
});
