import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { installQuasar } from '@/test/unit/helpers/install-quasar-plugin';
import { Notify } from 'quasar';
import i18n from '@/locales';
import store from '@/test/unit/helpers/store';

installQuasar({ plugins: [Notify] });

vi.mock('@/aws-exports', () => ({
  default: { isCloud: 'false', isEnterprise: 'true' },
}));

import PermissionsTable from '@/components/iam/roles/PermissionsTable.vue';

const makePermission = () => ({
  AllowAll: { show: true, value: false },
  AllowList: { show: true, value: false },
  AllowGet: { show: true, value: false },
  AllowDelete: { show: true, value: false },
  AllowPost: { show: true, value: false },
  AllowPut: { show: true, value: false },
});

const makeRow = (name: string, show = true, hasEntities = false, expand = false) => ({
  name,
  display_name: name,
  resourceName: name,
  type: 'Type',
  show,
  has_entities: hasEntities,
  expand,
  entities: [],
  permission: makePermission(),
  is_loading: false,
});

async function mountTable(props: Record<string, any> = {}) {
  const wrapper = mount(PermissionsTable, {
    global: {
      plugins: [i18n, store],
      stubs: {
        // Stub the recursive PermissionsTable to avoid infinite render
        PermissionsTable: {
          name: 'PermissionsTable',
          props: ['rows', 'level', 'parent', 'customFilteredPermissions', 'filter'],
          template: '<div data-test="nested-permissions-table-stub" />',
        },
        QVirtualScroll: {
          props: ['items', 'rows', 'columns', 'tableColspan'],
          template: `<div><slot name="before" /><slot v-for="item in items" :item="item" /></div>`,
        },
      },
    },
    props: {
      rows: [],
      level: 0,
      visibleResourceCount: 0,
      parent: { name: 'main', resourceName: 'main', expand: false, is_loading: false, has_entities: false },
      selectedPermissionsHash: new Set(),
      filter: {},
      customFilteredPermissions: {},
      ...props,
    },
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  vi.clearAllMocks();
});

// 1. Rendering at level 0
describe('PermissionsTable - level 0 rendering', () => {
  it('renders the permissions count title at level 0', async () => {
    const wrapper = await mountTable({ level: 0, visibleResourceCount: 5 });
    expect(wrapper.find('[data-test="edit-role-permissions-table-title"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="edit-role-permissions-table-title"]').text()).toContain('5');
  });

  it('does NOT render the title at level > 0', async () => {
    const wrapper = await mountTable({ level: 1 });
    expect(wrapper.find('[data-test="edit-role-permissions-table-title"]').exists()).toBe(false);
  });

  it('renders "No Permissions Selected" when rows are empty at level 0', async () => {
    const wrapper = await mountTable({ level: 0, rows: [] });
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-no-permissions-title"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-no-permissions-title"]').text(),
    ).toContain('No Permissions Selected');
  });

  it('does NOT render "No Permissions Selected" when rows are present at level 0', async () => {
    const rows = [makeRow('stream', true)];
    const wrapper = await mountTable({ level: 0, rows });
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-no-permissions-title"]').exists(),
    ).toBe(false);
  });
});

// 2. Rendering at level > 0
describe('PermissionsTable - level > 0 rendering', () => {
  it('renders "No Resources Present" when filtered rows are empty at level > 0', async () => {
    const parent = { name: 'stream', resourceName: 'stream', expand: true, is_loading: false, has_entities: true };
    // rows are all show=false so getFilteredRows is empty
    const rows = [makeRow('logs', false)];
    const wrapper = await mountTable({ level: 1, rows, parent });
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-no-resources-title"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-no-resources-title"]').text(),
    ).toContain('No Resources Present');
  });

  it('does NOT render "No Resources Present" when there are visible rows', async () => {
    const parent = { name: 'stream', resourceName: 'stream', expand: true, is_loading: false, has_entities: true };
    const rows = [makeRow('logs', true)];
    const wrapper = await mountTable({ level: 1, rows, parent });
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-no-resources-title"]').exists(),
    ).toBe(false);
  });

  it('renders loading indicator when parent.is_loading is true', async () => {
    const parent = { name: 'stream', resourceName: 'stream', expand: true, is_loading: true, has_entities: true };
    const wrapper = await mountTable({ level: 1, parent });
    expect(
      wrapper.find('[data-test="edit-role-permissions-table-loading-resources-loader"]').exists(),
    ).toBe(true);
  });

  it('does NOT render loading indicator when parent.is_loading is false', async () => {
    const parent = { name: 'stream', resourceName: 'stream', expand: false, is_loading: false, has_entities: true };
    const wrapper = await mountTable({ level: 1, parent });
    // Loading div exists but is v-show'd off - it still exists in DOM
    // Check that it's not visible
    const loader = wrapper.find('[data-test="edit-role-permissions-table-loading-resources-loader"]');
    if (loader.exists()) {
      expect(loader.isVisible()).toBe(false);
    }
  });
});

// 3. getFilteredRows computed
describe('PermissionsTable - getFilteredRows computed', () => {
  it('returns only rows where show is true', async () => {
    const rows = [
      makeRow('stream', true),
      makeRow('logs', false),
      makeRow('metrics', true),
    ];
    const wrapper = await mountTable({ rows });
    expect((wrapper.vm as any).getFilteredRows.length).toBe(2);
    expect((wrapper.vm as any).getFilteredRows.map((r: any) => r.name)).toEqual(['stream', 'metrics']);
  });

  it('returns empty array when all rows are hidden', async () => {
    const rows = [makeRow('stream', false), makeRow('logs', false)];
    const wrapper = await mountTable({ rows });
    expect((wrapper.vm as any).getFilteredRows.length).toBe(0);
  });

  it('returns all rows when all are shown', async () => {
    const rows = [makeRow('a', true), makeRow('b', true), makeRow('c', true)];
    const wrapper = await mountTable({ rows });
    expect((wrapper.vm as any).getFilteredRows.length).toBe(3);
  });

  it('handles rows with undefined show gracefully', async () => {
    const rows = [{ name: 'x', show: undefined }, { name: 'y', show: true }];
    const wrapper = await mountTable({ rows });
    // rows with show=undefined are falsy, filtered out
    expect((wrapper.vm as any).getFilteredRows.length).toBe(1);
  });
});

// 4. "Top 50" warning
describe('PermissionsTable - Top 50 warning', () => {
  it('shows the Top 50 banner when filtered rows count is exactly 50', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => makeRow(`resource-${i}`, true));
    const parent = { name: 'stream', resourceName: 'stream', expand: false, is_loading: false, has_entities: false };
    const wrapper = await mountTable({ level: 1, rows, parent });
    expect(wrapper.text()).toContain('Top 50');
  });

  it('does NOT show Top 50 banner when fewer than 50 filtered rows', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow(`resource-${i}`, true));
    const wrapper = await mountTable({ level: 1, rows });
    expect(wrapper.text()).not.toContain('Top 50');
  });
});

// 5. expandPermission emits
describe('PermissionsTable - expandPermission', () => {
  it('emits "expand:row" with the resource when called', async () => {
    const wrapper = await mountTable({ rows: [makeRow('stream', true, true)] });
    const resource = makeRow('stream', true, true);
    await (wrapper.vm as any).expandPermission(resource);
    const emitted = wrapper.emitted('expand:row');
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toEqual(resource);
  });
});

// 6. handlePermissionChange emits
describe('PermissionsTable - handlePermissionChange', () => {
  it('emits "updated:permission" with row and permission name', async () => {
    const wrapper = await mountTable({ rows: [makeRow('stream', true)] });
    const row = makeRow('stream', true);
    (wrapper.vm as any).handlePermissionChange(row, 'AllowGet');
    const emitted = wrapper.emitted('updated:permission');
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toEqual(row);
    expect(emitted![0][1]).toBe('AllowGet');
  });

  it('emits multiple times for multiple permission changes', async () => {
    const wrapper = await mountTable();
    const row = makeRow('logs', true);
    (wrapper.vm as any).handlePermissionChange(row, 'AllowAll');
    (wrapper.vm as any).handlePermissionChange(row, 'AllowList');
    (wrapper.vm as any).handlePermissionChange(row, 'AllowDelete');
    expect(wrapper.emitted('updated:permission')).toHaveLength(3);
  });
});

// 7. Table section data-test
describe('PermissionsTable - table section', () => {
  it('renders the main table section div', async () => {
    const parent = { name: 'main', resourceName: 'main', expand: false, is_loading: false, has_entities: false };
    const wrapper = await mountTable({ parent });
    expect(wrapper.find('[data-test="iam-main-permissions-table-section"]').exists()).toBe(true);
  });

  it('uses the parent name in the data-test attribute', async () => {
    const parent = { name: 'stream', resourceName: 'stream', expand: false, is_loading: false, has_entities: false };
    const wrapper = await mountTable({ parent });
    expect(wrapper.find('[data-test="iam-stream-permissions-table-section"]').exists()).toBe(true);
  });
});
