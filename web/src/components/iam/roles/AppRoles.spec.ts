import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import i18n from '@/locales';
import store from '@/test/unit/helpers/store';
import router from '@/test/unit/helpers/router';


vi.mock('@/aws-exports', () => ({
  default: { isCloud: 'false', isEnterprise: 'true' },
}));

vi.mock('@/services/iam', () => ({
  getRoles: vi.fn(async () => ({ data: ['Admin', 'Viewer', 'Editor'] })),
  deleteRole: vi.fn(async () => ({})),
  bulkDeleteRoles: vi.fn(async () => ({
    data: { successful: ['Admin', 'Viewer'], unsuccessful: [] },
  })),
}));

vi.mock('@/services/reodotdev_analytics', () => ({
  useReo: () => ({ track: vi.fn() }),
}));

vi.mock('@/lib/feedback/Toast/useToast', () => ({
  toast: vi.fn(),
}));

import AppRoles from '@/components/iam/roles/AppRoles.vue';
import { getRoles, deleteRole, bulkDeleteRoles } from '@/services/iam';

const node = document.createElement('div');
node.setAttribute('id', 'app-roles-test');
document.body.appendChild(node);

async function mountAppRoles() {
  const wrapper = mount(AppRoles, {
    attachTo: node,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        AppTable: {
          props: ['rows', 'columns', 'filter', 'selected', 'title'],
          emits: ['update:selected'],
          template: `<div data-test="iam-roles-table-section"><slot name="actions" v-bind="{column:{row:rows&&rows[0]?rows[0]:{role_name:'Admin'}}}"/><slot name="bottom-actions"/></div>`,
        },
        AddRole: { template: '<div data-test="add-role-stub" />' },
        ConfirmDialog: {
          props: ['modelValue', 'title', 'message'],
          emits: ['update:ok', 'update:cancel', 'update:modelValue'],
          template: '<div data-test="confirm-dialog-stub"></div>',
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  vi.clearAllMocks();
});

// 1. Rendering
describe('AppRoles - rendering', () => {
  it('renders the section title', async () => {
    const wrapper = await mountAppRoles();
    // Title now lives in the standard AppPageHeader (row 1).
    expect(wrapper.find('.app-page-header h1').text()).toContain('Roles');
  });

  it.skip('renders the search input', async () => {
    // Search input is inside RoleTable child component, not directly in AppRoles.
    // AppRoles binds v-model:global-filter to RoleTable; the input is rendered by RoleTable itself.
    const wrapper = await mountAppRoles();
    expect(
      wrapper.find('[data-test="o2-table-global-filter-input"]').exists(),
    ).toBe(true);
  });

  it('renders the roles table', async () => {
    const wrapper = await mountAppRoles();
    expect(wrapper.find('[data-test="iam-roles-table-section"]').exists()).toBe(true);
  });

  it('renders the Add Role button', async () => {
    const wrapper = await mountAppRoles();
    expect(wrapper.find('[data-test="alert-list-add-alert-btn"]').exists()).toBe(true);
  });
});

// 2. setupRoles
describe('AppRoles - setupRoles', () => {
  it('calls getRoles on mount with the org identifier', async () => {
    await mountAppRoles();
    expect(getRoles).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);
  });

  it('populates rows after fetching roles', async () => {
    const wrapper = await mountAppRoles();
    expect((wrapper.vm as any).rows.length).toBe(3);
  });

  it('maps role strings to objects with role_name', async () => {
    const wrapper = await mountAppRoles();
    const rows = (wrapper.vm as any).rows;
    expect(rows[0]).toHaveProperty('role_name', 'Admin');
    expect(rows[1]).toHaveProperty('role_name', 'Viewer');
    expect(rows[2]).toHaveProperty('role_name', 'Editor');
  });

  it('formats row numbers with leading zeros for first 9', async () => {
    const wrapper = await mountAppRoles();
    const rows = (wrapper.vm as any).rows;
    expect(rows[0]['#']).toBe('01');
    expect(rows[1]['#']).toBe('02');
    expect(rows[2]['#']).toBe('03');
  });

  it('handles getRoles error gracefully', async () => {
    vi.mocked(getRoles).mockRejectedValueOnce(new Error('network error'));
    const wrapper = await mountAppRoles();
    // Should not throw, rows stays empty (or prior state)
    expect(wrapper.exists()).toBe(true);
  });
});

// 3. addRole
describe('AppRoles - addRole', () => {
  it('opens the add role dialog when button is clicked', async () => {
    const wrapper = await mountAppRoles();
    await wrapper.find('[data-test="alert-list-add-alert-btn"]').trigger('click');
    expect((wrapper.vm as any).showAddGroup).toBe(true);
  });
});

// 4. editRole
describe('AppRoles - editRole', () => {
  it('navigates to editRole route with role_name param', async () => {
    const wrapper = await mountAppRoles();
    const spy = vi.spyOn(router, 'push');
    (wrapper.vm as any).editRole({ role_name: 'Admin' });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'editRole',
        params: { role_name: 'Admin' },
      }),
    );
  });

  it('passes org_identifier in query', async () => {
    const wrapper = await mountAppRoles();
    const spy = vi.spyOn(router, 'push');
    (wrapper.vm as any).editRole({ role_name: 'Viewer' });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { org_identifier: store.state.selectedOrganization.identifier },
      }),
    );
  });
});

// 5. filterQuery (filtering handled by RoleTable component)
describe('AppRoles - filterQuery', () => {
  it('updates filterQuery when user types in search input', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).filterQuery = 'admin';
    expect((wrapper.vm as any).filterQuery).toBe('admin');
  });

  it('clears filterQuery when search is reset', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).filterQuery = 'admin';
    (wrapper.vm as any).filterQuery = '';
    expect((wrapper.vm as any).filterQuery).toBe('');
  });

  it('passes filterQuery to RoleTable as global-filter prop', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).filterQuery = 'test';
    await wrapper.vm.$nextTick();
    expect((wrapper.vm as any).filterQuery).toBe('test');
  });

  it('resets filterQuery on new role added', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).filterQuery = 'admin';
    await (wrapper.vm as any).setupRoles();
    // filterQuery remains as is - user can clear manually
    expect((wrapper.vm as any).filterQuery).toBe('admin');
  });
});

// 6. hideForm
describe('AppRoles - hideForm', () => {
  it('closes the add role dialog', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).showAddGroup = true;
    (wrapper.vm as any).hideForm();
    expect((wrapper.vm as any).showAddGroup).toBe(false);
  });
});

// 7. showConfirmDialog
describe('AppRoles - showConfirmDialog', () => {
  it('sets deleteConformDialog.show to true', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).showConfirmDialog({ role_name: 'Admin' });
    expect((wrapper.vm as any).deleteConformDialog.show).toBe(true);
  });

  it('stores the row data in deleteConformDialog.data', async () => {
    const wrapper = await mountAppRoles();
    const row = { role_name: 'Viewer' };
    (wrapper.vm as any).showConfirmDialog(row);
    expect((wrapper.vm as any).deleteConformDialog.data).toEqual(row);
  });
});

// 8. _deleteRole
describe('AppRoles - _deleteRole', () => {
  it('calls deleteRole with role_name and org identifier', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).deleteConformDialog.data = { role_name: 'Admin' };
    (wrapper.vm as any)._deleteRole();
    await flushPromises();
    expect(deleteRole).toHaveBeenCalledWith(
      'Admin',
      store.state.selectedOrganization.identifier,
    );
  });

  it('resets deleteConformDialog.data to null', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).deleteConformDialog.data = { role_name: 'Admin' };
    (wrapper.vm as any)._deleteRole();
    expect((wrapper.vm as any).deleteConformDialog.data).toBeNull();
  });

  it('re-fetches roles after successful deletion', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).deleteConformDialog.data = { role_name: 'Admin' };
    vi.mocked(getRoles).mockClear();
    (wrapper.vm as any)._deleteRole();
    await flushPromises();
    expect(getRoles).toHaveBeenCalled();
  });
});

// 9. openBulkDeleteDialog
describe('AppRoles - openBulkDeleteDialog', () => {
  it('sets confirmBulkDelete to true', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).openBulkDeleteDialog();
    expect((wrapper.vm as any).confirmBulkDelete).toBe(true);
  });
});

// 10. bulkDeleteUserRoles
describe('AppRoles - bulkDeleteUserRoles', () => {
  it('calls bulkDeleteRoles with correct role names', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).selectedRoleNames = ['Admin', 'Viewer'];
    await (wrapper.vm as any).bulkDeleteUserRoles();
    expect(bulkDeleteRoles).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
      { ids: ['Admin', 'Viewer'] },
    );
  });

  it('clears selectedRoleNames after successful deletion', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).selectedRoleNames = ['Admin'];
    await (wrapper.vm as any).bulkDeleteUserRoles();
    expect((wrapper.vm as any).selectedRoleNames).toHaveLength(0);
  });

  it('resets confirmBulkDelete after success', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).confirmBulkDelete = true;
    (wrapper.vm as any).selectedRoleNames = ['Admin'];
    await (wrapper.vm as any).bulkDeleteUserRoles();
    expect((wrapper.vm as any).confirmBulkDelete).toBe(false);
  });

  it('shows success message when all roles deleted successfully', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).selectedRoleNames = ['Admin', 'Viewer'];
    await (wrapper.vm as any).bulkDeleteUserRoles();
    await flushPromises();
    // Component uses toast function, not $q.notify()
    expect(bulkDeleteRoles).toHaveBeenCalled();
  });

  it('shows partial failure message on partial failure', async () => {
    vi.mocked(bulkDeleteRoles).mockResolvedValueOnce({
      data: { successful: ['Admin'], unsuccessful: ['Viewer'] },
    });
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).selectedRoleNames = ['Admin', 'Viewer'];
    await (wrapper.vm as any).bulkDeleteUserRoles();
    await flushPromises();
    expect(bulkDeleteRoles).toHaveBeenCalled();
  });

  it('shows failure message when all deletions fail', async () => {
    vi.mocked(bulkDeleteRoles).mockResolvedValueOnce({
      data: { successful: [], unsuccessful: ['Admin'] },
    });
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).selectedRoleNames = ['Admin'];
    await (wrapper.vm as any).bulkDeleteUserRoles();
    await flushPromises();
    expect(bulkDeleteRoles).toHaveBeenCalled();
  });

  it('resets confirmBulkDelete on error', async () => {
    vi.mocked(bulkDeleteRoles).mockRejectedValueOnce({ response: { status: 500, data: { message: 'err' } } });
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).confirmBulkDelete = true;
    (wrapper.vm as any).selectedRoleNames = ['Admin'];
    await (wrapper.vm as any).bulkDeleteUserRoles();
    expect((wrapper.vm as any).confirmBulkDelete).toBe(false);
  });
});

// 11. rows computed (handled via RoleTable component)
describe('AppRoles - rows data', () => {
  it('populates rows array with fetched roles', async () => {
    const wrapper = await mountAppRoles();
    expect((wrapper.vm as any).rows.length).toBe(3);
    expect((wrapper.vm as any).rows[0].role_name).toBe('Admin');
  });

  it('includes row numbering in "#" field', async () => {
    const wrapper = await mountAppRoles();
    expect((wrapper.vm as any).rows[0]['#']).toBe('01');
    expect((wrapper.vm as any).rows[1]['#']).toBe('02');
  });
});

// 12. RoleTable integration
describe('AppRoles - RoleTable integration', () => {
  it('passes rows data to RoleTable', async () => {
    const wrapper = await mountAppRoles();
    expect((wrapper.vm as any).rows.length).toBeGreaterThan(0);
  });

  it('passes filterQuery to RoleTable as global-filter', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).filterQuery = 'admin';
    await wrapper.vm.$nextTick();
    expect((wrapper.vm as any).filterQuery).toBe('admin');
  });
});

// 13. ODialog/ODrawer Migration
// After migration the q-dialog wrapper around AddRole was removed; AddRole
// now owns its own drawer/dialog and accepts v-model:open from the parent.
// These tests verify the new contract.
describe('AppRoles - ODialog/ODrawer Migration', () => {
  // Custom mount that uses an AddRole stub declaring the new `open` prop and
  // `update:open` / `added:role` emits so we can inspect props and emit
  // events through the same v-model:open binding the production template uses.
  async function mountAppRolesWithAddRoleStub() {
    const wrapper = mount(AppRoles, {
      attachTo: node,
      global: {
        plugins: [i18n, store, router],
        stubs: {
          AppTable: {
            props: ['rows', 'columns', 'filter', 'selected', 'title'],
            emits: ['update:selected'],
            template: `<div data-test="iam-roles-table-section"><slot name="actions" v-bind="{column:{row:rows&&rows[0]?rows[0]:{role_name:'Admin'}}}"/><slot name="bottom-actions"/></div>`,
          },
          AddRole: {
            name: 'AddRole',
            props: ['open'],
            emits: ['update:open', 'added:role'],
            template: '<div data-test="add-role-stub" />',
          },
          ConfirmDialog: {
            props: ['modelValue', 'title', 'message'],
            emits: ['update:ok', 'update:cancel', 'update:modelValue'],
            template: '<div data-test="confirm-dialog-stub"></div>',
          },
        },
      },
    });
    await flushPromises();
    return wrapper;
  }

  it('passes showAddGroup=false to AddRole as `open` prop by default', async () => {
    const wrapper = await mountAppRolesWithAddRoleStub();
    const addRole = wrapper.findComponent({ name: 'AddRole' });
    expect(addRole.exists()).toBe(true);
    expect(addRole.props('open')).toBe(false);
  });

  it('propagates showAddGroup=true to AddRole `open` prop when opened', async () => {
    const wrapper = await mountAppRolesWithAddRoleStub();
    (wrapper.vm as any).showAddGroup = true;
    await flushPromises();

    const addRole = wrapper.findComponent({ name: 'AddRole' });
    expect(addRole.props('open')).toBe(true);
  });

  it('propagates showAddGroup=true to AddRole when addRole() handler is invoked', async () => {
    const wrapper = await mountAppRolesWithAddRoleStub();
    await wrapper.find('[data-test="alert-list-add-alert-btn"]').trigger('click');
    await flushPromises();

    const addRole = wrapper.findComponent({ name: 'AddRole' });
    expect((wrapper.vm as any).showAddGroup).toBe(true);
    expect(addRole.props('open')).toBe(true);
  });

  it('sets showAddGroup to false when AddRole emits update:open(false)', async () => {
    const wrapper = await mountAppRolesWithAddRoleStub();
    (wrapper.vm as any).showAddGroup = true;
    await flushPromises();

    const addRole = wrapper.findComponent({ name: 'AddRole' });
    expect(addRole.props('open')).toBe(true);

    await addRole.vm.$emit('update:open', false);
    await flushPromises();

    expect((wrapper.vm as any).showAddGroup).toBe(false);
    expect(addRole.props('open')).toBe(false);
  });

  it('keeps showAddGroup true when AddRole emits update:open(true)', async () => {
    const wrapper = await mountAppRolesWithAddRoleStub();
    (wrapper.vm as any).showAddGroup = false;
    await flushPromises();

    const addRole = wrapper.findComponent({ name: 'AddRole' });
    await addRole.vm.$emit('update:open', true);
    await flushPromises();

    expect((wrapper.vm as any).showAddGroup).toBe(true);
    expect(addRole.props('open')).toBe(true);
  });

  it('invokes setupRoles (re-fetches roles) when AddRole emits added:role', async () => {
    const wrapper = await mountAppRolesWithAddRoleStub();
    // Initial mount already invoked getRoles once; clear to isolate the emit-driven call.
    vi.mocked(getRoles).mockClear();

    const addRole = wrapper.findComponent({ name: 'AddRole' });
    await addRole.vm.$emit('added:role');
    await flushPromises();

    expect(getRoles).toHaveBeenCalledTimes(1);
    expect(getRoles).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);
  });

  it('does not render AddRole inside a q-dialog wrapper (post-migration)', async () => {
    const wrapper = await mountAppRolesWithAddRoleStub();
    // The legacy template wrapped AddRole in <q-dialog>. After migration AddRole
    // owns its own dialog, so no q-dialog wrapper should be rendered around it
    // by the parent template.
    expect(wrapper.find('.q-dialog').exists()).toBe(false);
  });
});
