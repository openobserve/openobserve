import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import i18n from '@/locales';
import store from '@/test/unit/helpers/store';


vi.mock('@/aws-exports', () => ({
  default: { isCloud: 'false', isEnterprise: 'true' },
}));

import EntityPermissionTable from '@/components/iam/roles/EntityPermissionTable.vue';

const makePermission = (val = false) => ({
  AllowAll: { show: true, value: val },
  AllowList: { show: true, value: val },
  AllowGet: { show: true, value: val },
  AllowDelete: { show: true, value: val },
  AllowPost: { show: true, value: val },
  AllowPut: { show: true, value: val },
});

const makeEntity = (name: string, withPerm = false) => ({
  name,
  type: 'stream',
  permission: makePermission(withPerm),
});

function makeResource(expand = true, showSelected = false) {
  return {
    expand,
    entities: [
      makeEntity('app-logs', false),
      makeEntity('sys-logs', true),
      makeEntity('infra-metrics', false),
    ],
  };
}

async function mountComponent(props = {}) {
  const wrapper = mount(EntityPermissionTable, {
    global: {
      plugins: [i18n, store],
      stubs: {
        OTable: {
          props: ['data', 'columns', 'globalFilter', 'hideHeader', 'style'],
          template: `<div data-test="o-table-stub" :data-global-filter="globalFilter">
            <div v-for="row in data" :key="row.name" :data-test="'entity-row-'+row.name">
              <slot :name="'cell-AllowAll'" :row="row" />
            </div>
          </div>`,
        },
        OCheckbox: {
          props: ['modelValue', 'value'],
          template: '<input type="checkbox" :data-test="\'checkbox-\'+value" :checked="modelValue" />',
        },
        NoData: true,
      },
    },
    props: {
      resource: makeResource(),
      showSelected: false,
      searchKey: '',
      ...props,
    },
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  vi.clearAllMocks();
});

// 1. Rendering
describe('EntityPermissionTable - rendering', () => {
  it('mounts without errors', async () => {
    const wrapper = await mountComponent();
    expect(wrapper.exists()).toBe(true);
  });

  it('renders OTable with entity rows when resource is expanded', async () => {
    const wrapper = await mountComponent({ resource: makeResource(true) });
    expect(wrapper.find('[data-test="o-table-stub"]').exists()).toBe(true);
  });

  it('does NOT populate rows when resource.expand is false initially', async () => {
    const wrapper = await mountComponent({ resource: makeResource(false) });
    // rows remain empty until expand becomes true
    expect((wrapper.vm as any).rows.length).toBe(0);
  });

  it('populates rows when resource.expand is true', async () => {
    const wrapper = await mountComponent({ resource: makeResource(true) });
    expect((wrapper.vm as any).rows.length).toBe(3);
  });
});

// 2. watcher on resource.expand
describe('EntityPermissionTable - resource.expand watcher', () => {
  it('loads entities when expand becomes true', async () => {
    const resource = makeResource(false);
    const wrapper = await mountComponent({ resource });
    expect((wrapper.vm as any).rows.length).toBe(0);
    await wrapper.setProps({ resource: { ...resource, expand: true } });
    await flushPromises();
    expect((wrapper.vm as any).rows.length).toBe(3);
  });

  it('does not clear rows when expand becomes false', async () => {
    const resource = makeResource(true);
    const wrapper = await mountComponent({ resource });
    expect((wrapper.vm as any).rows.length).toBe(3);
    resource.expand = false;
    await flushPromises();
    // rows remain until re-populated (watcher only fires on true)
    expect((wrapper.vm as any).rows.length).toBe(3);
  });
});

// 3. showSelected prop
describe('EntityPermissionTable - showSelected prop', () => {
  it('returns all entities when showSelected is false', async () => {
    const wrapper = await mountComponent({
      resource: makeResource(true),
      showSelected: false,
    });
    expect((wrapper.vm as any).rows.length).toBe(3);
  });

  it('returns only entities with at least one permission when showSelected is true', async () => {
    const resource = makeResource(true);
    // Only sys-logs has a truthy permission
    const wrapper = await mountComponent({
      resource,
      showSelected: true,
    });
    // Only sys-logs has value=true
    expect((wrapper.vm as any).rows.length).toBe(1);
    expect((wrapper.vm as any).rows[0].name).toBe('sys-logs');
  });

  it('returns empty array when showSelected is true but no permissions set', async () => {
    const resource = {
      expand: true,
      entities: [makeEntity('app-logs', false), makeEntity('sys-logs', false)],
    };
    const wrapper = await mountComponent({ resource, showSelected: true });
    expect((wrapper.vm as any).rows.length).toBe(0);
  });
});

// 4. searchKey / filtering
// Filtering is delegated entirely to OTable via its global-filter prop.
// These tests verify that searchKey is forwarded to OTable and that rows
// are fully populated before OTable applies its own client-side filter.
describe('EntityPermissionTable - searchKey prop forwarding', () => {
  it('passes empty searchKey to OTable global-filter by default', async () => {
    const wrapper = await mountComponent({ resource: makeResource(true), searchKey: '' });

    const tableStub = wrapper.find('[data-test="o-table-stub"]');
    expect(tableStub.attributes('data-global-filter')).toBe('');
  });

  it('passes a non-empty searchKey to OTable global-filter', async () => {
    const wrapper = await mountComponent({ resource: makeResource(true), searchKey: 'logs' });

    const tableStub = wrapper.find('[data-test="o-table-stub"]');
    expect(tableStub.attributes('data-global-filter')).toBe('logs');
  });

  it('updates OTable global-filter when searchKey prop changes', async () => {
    const wrapper = await mountComponent({ resource: makeResource(true), searchKey: '' });

    await wrapper.setProps({ searchKey: 'sys' });

    const tableStub = wrapper.find('[data-test="o-table-stub"]');
    expect(tableStub.attributes('data-global-filter')).toBe('sys');
  });

  it('populates all rows regardless of searchKey (filtering is OTable responsibility)', async () => {
    // Rows should always reflect the full entity list so OTable can filter them client-side.
    const wrapper = await mountComponent({ resource: makeResource(true), searchKey: 'logs' });

    expect((wrapper.vm as any).rows.length).toBe(3);
  });

  it('passes updated searchKey to OTable after prop change without altering rows count', async () => {
    const wrapper = await mountComponent({ resource: makeResource(true), searchKey: 'app' });

    await wrapper.setProps({ searchKey: 'zzz-no-match' });

    // rows is unaffected — OTable does the actual filtering
    expect((wrapper.vm as any).rows.length).toBe(3);
    expect(wrapper.find('[data-test="o-table-stub"]').attributes('data-global-filter')).toBe('zzz-no-match');
  });
});

// 5. handlePermissionChange emit
describe('EntityPermissionTable - handlePermissionChange', () => {
  it('emits "updated:permission" with row and permission name', async () => {
    const wrapper = await mountComponent({ resource: makeResource(true) });
    const entity = makeEntity('app-logs');
    (wrapper.vm as any).handlePermissionChange(entity, 'AllowGet');
    const emitted = wrapper.emitted('updated:permission');
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toEqual(entity);
    expect(emitted![0][1]).toBe('AllowGet');
  });

  it('emits for multiple permission changes', async () => {
    const wrapper = await mountComponent({ resource: makeResource(true) });
    const entity = makeEntity('sys-logs');
    (wrapper.vm as any).handlePermissionChange(entity, 'AllowAll');
    (wrapper.vm as any).handlePermissionChange(entity, 'AllowDelete');
    expect(wrapper.emitted('updated:permission')).toHaveLength(2);
  });
});
