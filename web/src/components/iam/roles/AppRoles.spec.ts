import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { installQuasar } from '@/test/unit/helpers/install-quasar-plugin';
import { Dialog, Notify } from 'quasar';
import i18n from '@/locales';
import store from '@/test/unit/helpers/store';
import router from '@/test/unit/helpers/router';

installQuasar({ plugins: [Dialog, Notify] });

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
    expect(wrapper.find('[data-test="iam-roles-section-title"]').exists()).toBe(true);
  });

  it('renders the search input', async () => {
    const wrapper = await mountAppRoles();
    expect(wrapper.find('[data-test="iam-roles-search-input"]').exists()).toBe(true);
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

// 5. filterRoles
describe('AppRoles - filterRoles', () => {
  it('filters rows by role_name substring (case-insensitive)', async () => {
    const wrapper = await mountAppRoles();
    const rows = [{ role_name: 'Admin' }, { role_name: 'Viewer' }, { role_name: 'Editor' }];
    const result = (wrapper.vm as any).filterRoles(rows, 'admin');
    expect(result).toHaveLength(1);
    expect(result[0].role_name).toBe('Admin');
  });

  it('returns all matching rows for partial term', async () => {
    const wrapper = await mountAppRoles();
    const rows = [{ role_name: 'AdminA' }, { role_name: 'AdminB' }, { role_name: 'Viewer' }];
    const result = (wrapper.vm as any).filterRoles(rows, 'admin');
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no rows match', async () => {
    const wrapper = await mountAppRoles();
    const rows = [{ role_name: 'Admin' }, { role_name: 'Viewer' }];
    expect((wrapper.vm as any).filterRoles(rows, 'xyz')).toHaveLength(0);
  });

  it('treats uppercase and lowercase the same', async () => {
    const wrapper = await mountAppRoles();
    const rows = [{ role_name: 'Admin' }];
    expect((wrapper.vm as any).filterRoles(rows, 'ADMIN')).toHaveLength(1);
    expect((wrapper.vm as any).filterRoles(rows, 'admin')).toHaveLength(1);
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
    (wrapper.vm as any).selectedRoles = [{ role_name: 'Admin' }, { role_name: 'Viewer' }];
    await (wrapper.vm as any).bulkDeleteUserRoles();
    expect(bulkDeleteRoles).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
      { ids: ['Admin', 'Viewer'] },
    );
  });

  it('clears selectedRoles after successful deletion', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).selectedRoles = [{ role_name: 'Admin' }];
    await (wrapper.vm as any).bulkDeleteUserRoles();
    expect((wrapper.vm as any).selectedRoles).toHaveLength(0);
  });

  it('resets confirmBulkDelete after success', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).confirmBulkDelete = true;
    (wrapper.vm as any).selectedRoles = [{ role_name: 'Admin' }];
    await (wrapper.vm as any).bulkDeleteUserRoles();
    expect((wrapper.vm as any).confirmBulkDelete).toBe(false);
  });

  it('notifies with positive color when all roles deleted successfully', async () => {
    const wrapper = await mountAppRoles();
    const notifySpy = vi.spyOn((wrapper.vm as any).$q, 'notify');
    (wrapper.vm as any).selectedRoles = [{ role_name: 'Admin' }];
    await (wrapper.vm as any).bulkDeleteUserRoles();
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ color: 'positive' }));
  });

  it('notifies with warning color on partial failure', async () => {
    vi.mocked(bulkDeleteRoles).mockResolvedValueOnce({
      data: { successful: ['Admin'], unsuccessful: ['Viewer'] },
    });
    const wrapper = await mountAppRoles();
    const notifySpy = vi.spyOn((wrapper.vm as any).$q, 'notify');
    (wrapper.vm as any).selectedRoles = [{ role_name: 'Admin' }, { role_name: 'Viewer' }];
    await (wrapper.vm as any).bulkDeleteUserRoles();
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ color: 'warning' }));
  });

  it('notifies with negative color when all deletions fail', async () => {
    vi.mocked(bulkDeleteRoles).mockResolvedValueOnce({
      data: { successful: [], unsuccessful: ['Admin'] },
    });
    const wrapper = await mountAppRoles();
    const notifySpy = vi.spyOn((wrapper.vm as any).$q, 'notify');
    (wrapper.vm as any).selectedRoles = [{ role_name: 'Admin' }];
    await (wrapper.vm as any).bulkDeleteUserRoles();
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ color: 'negative' }));
  });

  it('resets confirmBulkDelete on error', async () => {
    vi.mocked(bulkDeleteRoles).mockRejectedValueOnce({ response: { status: 500, data: { message: 'err' } } });
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).confirmBulkDelete = true;
    (wrapper.vm as any).selectedRoles = [{ role_name: 'Admin' }];
    await (wrapper.vm as any).bulkDeleteUserRoles();
    expect((wrapper.vm as any).confirmBulkDelete).toBe(false);
  });
});

// 11. visibleRows computed
describe('AppRoles - visibleRows computed', () => {
  it('returns all rows when filterQuery is empty', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).filterQuery = '';
    expect((wrapper.vm as any).visibleRows.length).toBe(3);
  });

  it('returns filtered rows when filterQuery has a value', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).filterQuery = 'admin';
    expect((wrapper.vm as any).visibleRows.length).toBe(1);
    expect((wrapper.vm as any).visibleRows[0].role_name).toBe('Admin');
  });

  it('returns empty array when no match', async () => {
    const wrapper = await mountAppRoles();
    (wrapper.vm as any).filterQuery = 'zzznomatch';
    expect((wrapper.vm as any).visibleRows.length).toBe(0);
  });
});

// 12. hasVisibleRows computed
describe('AppRoles - hasVisibleRows computed', () => {
  it('returns true when rows exist', async () => {
    const wrapper = await mountAppRoles();
    expect((wrapper.vm as any).hasVisibleRows).toBe(true);
  });

  it('returns false when no rows', async () => {
    vi.mocked(getRoles).mockResolvedValueOnce({ data: [] });
    const wrapper = await mountAppRoles();
    expect((wrapper.vm as any).hasVisibleRows).toBe(false);
  });
});
