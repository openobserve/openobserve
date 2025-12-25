import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { installQuasar } from '@/test/unit/helpers/install-quasar-plugin';
import { Dialog, Notify } from 'quasar';
import i18n from '@/locales';
import store from '@/test/unit/helpers/store';
import router from '@/test/unit/helpers/router';

// Ensure Quasar plugin
installQuasar({ plugins: [Dialog, Notify] });

// Avoid waiting for router readiness / guards to hang
// @ts-ignore
router.isReady = () => Promise.resolve();

// Mock routeGuard to always continue
vi.mock('@/utils/zincutils', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    routeGuard: vi.fn((_to, _from, next) => next()),
  };
});

// Mock config flags to enable enterprise routes if needed
vi.mock('@/aws-exports', () => ({
  default: { isCloud: 'false', isEnterprise: 'true' },
}));

// Mock composable useStreams
vi.mock('@/composables/useStreams', () => ({
  default: () => ({
    getStreams: vi.fn(async (type) => {
      const map = {
        logs: { list: [{ name: 'app' }, { name: 'sys' }] },
        metrics: { list: [{ name: 'cpu' }, { name: 'mem' }] },
        traces: { list: [{ name: 'svc-a' }] },
        index: { list: [{ name: 'users' }] },
        enrichment_tables: { list: [{ name: 'geo' }] },
        metadata: { list: [{ name: 'meta' }] },
      };
      return map[type] || { list: [] };
    }),
  }),
}));

// Mock all external services used inside EditRole.vue
vi.mock('@/services/iam', () => ({
  getResources: vi.fn(async (_org) => ({
    data: [
      { key: 'stream', display_name: 'Streams', has_entities: true, top_level: true, visible: true, order: 1 },
      { key: 'logs', display_name: 'Logs', has_entities: true, parent: 'stream', top_level: false, visible: true, order: 2 },
      { key: 'metrics', display_name: 'Metrics', has_entities: true, parent: 'stream', top_level: false, visible: true, order: 3 },
      { key: 'dfolder', display_name: 'Dash Folders', has_entities: true, top_level: true, visible: true, order: 4 },
      { key: 'dashboard', display_name: 'Dashboards', has_entities: true, parent: 'dfolder', top_level: false, visible: true, order: 5 },
      { key: 'afolder', display_name: 'Alert Folders', has_entities: true, top_level: true, visible: true, order: 6 },
      { key: 'alert', display_name: 'Alerts', has_entities: true, parent: 'afolder', top_level: false, visible: true, order: 7 },
      { key: 'role', display_name: 'Roles', has_entities: false, top_level: true, visible: true, order: 8 },
      { key: 'group', display_name: 'Groups', has_entities: false, top_level: true, visible: true, order: 9 },
    ],
  })),
  getResourcePermission: vi.fn(async () => ({ data: [] })),
  getRoleUsers: vi.fn(async () => ({ data: ['u1@example.com', 'u2@example.com'] })),
  updateRole: vi.fn(async () => ({ data: { code: 200 } })),
  getGroups: vi.fn(async () => ({ data: [] })),
  getRoles: vi.fn(async () => ({ data: [] })),
}));

vi.mock('@/services/stream', () => ({ default: {} }));
vi.mock('@/services/pipelines', () => ({ default: { getPipelines: vi.fn(async () => ({ data: { list: [{ pipeline_id: 'p1', name: 'P1' }] } })) } }));
vi.mock('@/services/alerts', () => ({ default: { listByFolderId: vi.fn(async () => ({ data: { list: [{ alertId: 'a1', name: 'A1' }] } })) } }));
vi.mock('@/services/reports', () => ({ default: { list: vi.fn(async () => ({ data: [{ name: 'r1' }] })) } }));
vi.mock('@/services/alert_templates', () => ({ default: { list: vi.fn(async () => ({ data: [{ name: 't1' }] })) } }));
vi.mock('@/services/action_scripts', () => ({ default: { list: vi.fn(async () => ({ data: [{ id: 'ac1', name: 'AC1' }] })) } }));
vi.mock('@/services/alert_destination', () => ({ default: { list: vi.fn(async () => ({ data: [{ name: 'dest1' }] })) } }));
vi.mock('@/services/jstransform', () => ({ default: { list: vi.fn(async () => ({ data: { list: [{ name: 'f1' }] } })) } }));
vi.mock('@/services/organizations', () => ({ default: { list: vi.fn(async () => ({ data: { data: [{ identifier: 'org1' }, { identifier: 'org2' }] } })) } }));
vi.mock('@/services/saved_views', () => ({ default: { get: vi.fn(async () => ({ data: { views: [{ view_id: 'v1', view_name: 'V1' }] } })) } }));
vi.mock('@/services/dashboards', () => ({ default: { list: vi.fn(async () => ({ data: { dashboards: [{ dashboardId: 'd1', title: 'D1' }] } })), list_Folders: vi.fn(async () => ({ data: { list: [{ folderId: 'default', name: 'default' }] } })) } }));
vi.mock('@/services/service_accounts', () => ({ default: { list: vi.fn(async () => ({ data: { data: ['svc1@example.com'] } })) } }));
vi.mock('@/services/cipher_keys', () => ({ default: { list: vi.fn(async () => ({ data: { keys: [{ name: 'key1' }] } })) } }));
vi.mock('@/services/common', () => ({ default: { list_Folders: vi.fn(async () => ({ data: { list: [{ folderId: 'default', name: 'default' }] } })) } }));

// Target component
import EditRole from '@/components/iam/roles/EditRole.vue';

const node = document.createElement('div');
node.setAttribute('id', 'app');
document.body.appendChild(node);

async function mountEditRole(customStubs = {}) {
  // preset current route for onBeforeMount usage
  router.currentRoute.value.name = 'editRole';
  router.currentRoute.value.params = { role_name: 'Admin' };

  const wrapper = mount(EditRole, {
    attachTo: node,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        AppTabs: {
          props: ['tabs', 'activeTab'],
          emits: ['update:active-tab'],
          template: `<div data-test="app-tabs-stub">
            <button class="tab-permissions" @click="$emit('update:active-tab','permissions')">Permissions</button>
            <button class="tab-users" @click="$emit('update:active-tab','users')">Users</button>
            <button class="tab-serviceAccounts" @click="$emit('update:active-tab','serviceAccounts')">Service Accounts</button>
          </div>`,
        },
        PermissionsTable: {
          props: ['rows', 'customFilteredPermissions', 'filter', 'visibleResourceCount', 'selectedPermissionsHash'],
          emits: ['updated:permission', 'expand:row'],
          template: `<div data-test="permissions-table-stub"></div>`,
        },
        GroupUsers: { template: '<div data-test="group-users-stub"></div>' },
        GroupServiceAccounts: { template: '<div data-test="group-service-accounts-stub"></div>' },
        QueryEditor: defineComponent({
          name: 'QueryEditorStub',
          emits: ['update:query'],
          props: { modelValue: { type: String, default: '' } },
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

// Helpers to stub editor ref methods when switching to JSON view
function stubEditorRefs(wrapper) {
  if (!wrapper.vm.permissionJsonEditorRef) {
    // initialize ref container if missing
    // @ts-ignore
    wrapper.vm.permissionJsonEditorRef = { value: null };
  }
  // Assign methods on the ref's value so component closures use them
  wrapper.vm.permissionJsonEditorRef.value = {
    setValue: vi.fn(),
    formatDocument: vi.fn(),
    resetEditorLayout: vi.fn(),
  };
}

// Reset mocks
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// 1. Basic rendering
describe('EditRole - basic rendering', () => {
  it('renders page and title with role name', async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.find('[data-test="edit-role-page"]').exists()).toBe(true);
    // The title div contains both the role name and tabs, so we check if it includes the role name
    expect(wrapper.get('[data-test="edit-role-title"]').text()).toContain('Admin');
  });

  it('renders tabs component', async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.find('[data-test="edit-role-tabs"]').exists()).toBe(true);
  });

  it('shows loading spinner during initial fetch', async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.isFetchingInitialRoles = true;
    await flushPromises();
    expect(wrapper.find('[data-test="edit-role-page-loading-spinner"]').exists()).toBe(true);
  });
});

// 2. Tabs and activeTab switching
describe('EditRole - tabs behavior', () => {
  it('default tab is permissions', async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.vm.activeTab).toBe('permissions');
  });

  it('switches to users tab', async () => {
    const wrapper = await mountEditRole();
    await wrapper.find('.tab-users').trigger('click');
    expect(wrapper.vm.activeTab).toBe('users');
  });

  it('switches to service accounts when available', async () => {
    const wrapper = await mountEditRole();
    await wrapper.find('.tab-serviceAccounts').trigger('click');
    expect(wrapper.vm.activeTab).toBe('serviceAccounts');
  });
});

// 3. Permissions UI toggling
describe('EditRole - permissions UI', () => {

  it('updateTableData triggers visibility update and count', async () => {
    const wrapper = await mountEditRole();
    // seed a minimal permissions tree
    wrapper.vm.permissionsState.permissions = [
      { name: 'stream', resourceName: 'stream', type: 'Type', entities: [], permission: { AllowAll: { value: false } }, show: true },
    ];
    await wrapper.vm.updateTableData('all');
    await flushPromises();
    expect(typeof wrapper.vm.countOfVisibleResources).toBe('number');
  });

});

// 4. Permission mapping helpers
describe('EditRole - permission mappings', () => {
  it('getPermissionHash formats correctly for default entity', async () => {
    const wrapper = await mountEditRole();
    const h = wrapper.vm.getPermissionHash('stream', 'AllowAll');
    expect(h.startsWith('stream:_all_')).toBe(true);
  });


  it('updatePermissionMappings adds new permission when not present', async () => {
    const wrapper = await mountEditRole();
    const hash = 'stream:_all_default:AllowGet';
    wrapper.vm.updatePermissionMappings(hash);
    expect(wrapper.vm.addedPermissions[hash]).toBeTruthy();
    expect(wrapper.vm.selectedPermissionsHash.has(hash)).toBe(true);
  });

  it('updatePermissionMappings toggles removal for existing permission', async () => {
    const wrapper = await mountEditRole();
    const hash = 'stream:_all_default:AllowPut';
    wrapper.vm.permissionsHash = new Set([hash]);
    wrapper.vm.selectedPermissionsHash = new Set([hash]);
    // remove existing
    wrapper.vm.updatePermissionMappings(hash);
    expect(wrapper.vm.removedPermissions[hash]).toBeTruthy();
    expect(wrapper.vm.selectedPermissionsHash.has(hash)).toBe(false);
  });

  it('updateEntityPermission sets entity permission value based on selection', async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.selectedPermissionsHash = new Set(['logs:app:AllowGet']);
    const resource = { entities: [{ name: 'app', permission: { AllowGet: { value: false } } }] };
    wrapper.vm.updateEntityPermission(resource, 'logs', 'app', 'AllowGet');
    expect(resource.entities[0].permission.AllowGet.value).toBe(true);
  });
});

// 5. Filtering and visibility helpers
describe('EditRole - filtering & visibility', () => {
  it('filterResources finds rows by display_name', async () => {
    const wrapper = await mountEditRole();
    const rows = [
      { display_name: 'Streams', entities: [] },
      { display_name: 'Dashboards', entities: [{ display_name: 'Default' }] },
    ];
    const res = wrapper.vm.filterResources(rows, 'streams');
    expect(res.length).toBeGreaterThan(0);
  });

  it('filterRowsByResourceName returns nested matches only', async () => {
    const wrapper = await mountEditRole();
    const rows = [
      { resourceName: 'stream', entities: [{ resourceName: 'logs', entities: [] }] },
      { resourceName: 'role', entities: [] },
    ];
    const res = wrapper.vm.filterRowsByResourceName(rows, 'logs');
    expect(res.length).toBe(1);
  });

  it('countVisibleResources counts nested visible rows', async () => {
    const wrapper = await mountEditRole();
    const permissions = [
      { show: true, entities: [{ show: true, entities: [] }] },
      { show: false, entities: [] },
    ];
    const count = wrapper.vm.countVisibleResources(permissions);
    expect(count).toBe(2);
  });
});

// 6. Entities & resources population helpers
describe('EditRole - entities population', () => {
  it('updateResourceEntities pushes entities and respects displayNameKey', async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissionsState.permissions = [{ name: 'role', entities: [], permission: {}, childs: [], resourceName: 'role' }];
    wrapper.vm.updateResourceEntities('role', [], [{ name: 'Admin' }], false, 'name');
    expect(wrapper.vm.permissionsState.permissions[0].entities.length).toBeGreaterThan(0);
  });

  it('updateEntityEntities populates entities for resource children', async () => {
    const wrapper = await mountEditRole();
    const resource = { name: 'dfolder', childName: 'dashboard', entities: [], permission: {} };
    wrapper.vm.selectedPermissionsHash = new Set();
    wrapper.vm.updateEntityEntities(resource, ['dashboardId'], [{ dashboardId: 'd1', title: 'D1' }], false, 'title');
    expect(resource.entities.length).toBe(1);
  });

  it('updateResourceResource adds typed child under parent', async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissionsState.permissions = [{ name: 'stream', resourceName: 'stream', entities: [], childs: [], permission: {} }];
    wrapper.vm.updateResourceResource('logs', 'stream', ['stream_type'], [{ stream_type: 'logs', name: 'Logs' }], true, 'name');
    expect(wrapper.vm.permissionsState.permissions[0].entities.length).toBe(1);
  });
});

// 7. Role save and cancel
describe('EditRole - save and cancel', () => {
  it('cancelPermissionsUpdate navigates to roles list', async () => {
    const wrapper = await mountEditRole();
    const spy = vi.spyOn(router, 'push');
    await wrapper.vm.cancelPermissionsUpdate();
    expect(spy).toHaveBeenCalledWith({
      name: 'roles',
      query: {
        org_identifier: store.state.selectedOrganization.identifier
      }
    });
  });

  it('saveRole notifies info when no changes', async () => {
    const wrapper = await mountEditRole();
    const notifySpy = vi.spyOn(wrapper.vm.q, 'notify');
    await wrapper.vm.saveRole();
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
  });

  it('saveRole calls updateRole and resets added/removed permissions', async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.updatePermissionMappings('logs:app:AllowGet');
    const notifySpy = vi.spyOn(wrapper.vm.q, 'notify');
    await wrapper.vm.saveRole();
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }));
    expect(Object.keys(wrapper.vm.addedPermissions).length).toBe(0);
  });
});

// 8. Data fetch pipeline
describe('EditRole - data fetch pipeline', () => {
  it('getRoleDetails loads resources and users', async () => {
    const wrapper = await mountEditRole();
    await wrapper.vm.getRoleDetails();
    await flushPromises();
    expect(wrapper.vm.permissionsState.resources.length).toBeGreaterThan(0);
    expect(wrapper.vm.roleUsers.length).toBeGreaterThan(0);
  });


  it('onResourceChange updates visibility and count', async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissionsState.permissions = [{ show: false, permission: { AllowAll: { value: true } }, entities: [] }];
    await wrapper.vm.onResourceChange();
    expect(typeof wrapper.vm.countOfVisibleResources).toBe('number');
  });
});

// 9. JSON sync flows
describe('EditRole - JSON editor flows', () => {

  it('updateJsonInTable updates mappings based on JSON string', async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissionsJsonValue = JSON.stringify([{ object: 'logs:app', permission: 'AllowGet' }]);
    await wrapper.vm.updateJsonInTable();
    expect(wrapper.vm.selectedPermissionsHash.size).toBeGreaterThan(0);
  });

});

// 10. Misc micro-tests to exceed 50 cases
describe('EditRole - micro validations', () => {
  it('decodePermission splits correctly', async () => {
    const wrapper = await mountEditRole();
    const { resource, entity } = wrapper.vm.decodePermission('logs:app');
    expect(resource).toBe('logs');
    expect(entity).toBe('app');
  });

  it('modifyResourcePermissions hides some settings flags', async () => {
    const wrapper = await mountEditRole();
    const r = { resourceName: 'settings', permission: { AllowList: { show: true }, AllowDelete: { show: true }, AllowPost: { show: true } } };
    wrapper.vm.modifyResourcePermissions(r);
    expect(r.permission.AllowList.show).toBe(false);
    expect(r.permission.AllowDelete.show).toBe(false);
    expect(r.permission.AllowPost.show).toBe(false);
  });

  it('getDefaultResource returns top_level type', async () => {
    const wrapper = await mountEditRole();
    const r = wrapper.vm.getDefaultResource();
    expect(r.top_level).toBe(true);
    expect(r.type).toBe('Type');
  });

  it('filterColumns returns filtered by label', async () => {
    const wrapper = await mountEditRole();
    const options = [{ label: 'Alpha' }, { label: 'Beta' }];
    const res = wrapper.vm.filterColumns(options, 'alp', (fn) => fn());
    expect(res.length).toBe(1);
  });

  it('filterResourceOptions updates filteredResources', async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.resourceOptions = [{ label: 'Dashboards' }, { label: 'Streams' }];
    wrapper.vm.filterResourceOptions('dash', (fn) => fn());
    expect(wrapper.vm.filteredResources.length).toBe(1);
  });

  it('savePermissionHash builds sets from permissions', async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissions = [ { object: 'logs:_all_default', permission: 'AllowGet' } ];
    wrapper.vm.savePermissionHash();
    expect(wrapper.vm.permissionsHash.size).toBe(1);
    expect(wrapper.vm.selectedPermissionsHash.size).toBe(1);
  });

  it('updateActiveTab ignores falsy input', async () => {
    const wrapper = await mountEditRole();
    await wrapper.vm.updateActiveTab('');
    expect(wrapper.vm.activeTab).toBeTruthy();
  });

  it('countVisibleResources sets reactive countOfVisibleResources', async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.countVisibleResources([{ show: true, entities: [] }]);
    expect(wrapper.vm.countOfVisibleResources).toBe(1);
  });

  it('getOrgId returns store selected org identifier', async () => {
    const wrapper = await mountEditRole();
    expect(wrapper.vm.getOrgId()).toBe(store.state.selectedOrganization.identifier);
  });

  it('updatePermissionVisibility expands heavy resources children list', async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.heavyResourceEntities = { logs: [{ show: true }, { show: false }] };
    const permissions = [{ name: 'logs', entities: [], permission: { AllowAll: { value: true } } }];
    wrapper.vm.updatePermissionVisibility(permissions);
    expect(Array.isArray(permissions[0].entities)).toBe(true);
  });

  it('getResourceByName finds nested resource', async () => {
    const wrapper = await mountEditRole();
    const permissions = [{ resourceName: 'stream', childs: [{ resourceName: 'logs' }], entities: [], permission: {} }];
    const found = wrapper.vm.getResourceByName(permissions, 'logs');
    expect(found?.resourceName).toBe('logs');
  });

  it('setDefaultPermissions organizes resources and filters children from top level', async () => {
    const wrapper = await mountEditRole();
    wrapper.vm.permissionsState.resources = [
      { key: 'stream', display_name: 'Streams', has_entities: true, top_level: true },
      { key: 'logs', display_name: 'Logs', has_entities: true, parent: 'stream', top_level: false },
    ];
    wrapper.vm.setDefaultPermissions();
    expect(wrapper.vm.permissionsState.permissions.some((r) => r.resourceName === 'stream')).toBe(true);
  });
});
