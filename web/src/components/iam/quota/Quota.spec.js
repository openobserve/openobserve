import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { installQuasar } from '@/test/unit/helpers/install-quasar-plugin';
import { Dialog, Notify } from 'quasar';
import i18n from '@/locales';

// Stub route guard and utils before router/component are imported
vi.mock('@/utils/zincutils', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // minimal overrides used in Quota.vue and router guards
    getImageURL: vi.fn(() => '#'),
    getUUID: vi.fn(() => 'uuid-1'),
    routeGuard: vi.fn((_to, _from, next) => next()),
  };
});

// Basic DOM/URL mocks similar to reference style
// @ts-expect-error - Partial URL mock for testing
global.URL = global.URL || {};
// @ts-expect-error - Attach functions if missing
if (typeof global.URL.createObjectURL !== 'function') {
  // @ts-expect-error
  global.URL.createObjectURL = vi.fn(() => 'blob://test');
}
// @ts-expect-error
if (typeof global.URL.revokeObjectURL !== 'function') {
  // @ts-expect-error
  global.URL.revokeObjectURL = vi.fn();
}

import router from '@/test/unit/helpers/router';
import store from '@/test/unit/helpers/store';

// Avoid waiting for router.isReady() in tests
// @ts-ignore
router.isReady = () => Promise.resolve();
import Quota from '@/components/iam/quota/Quota.vue';

installQuasar({ plugins: [Dialog, Notify] });

// Mocks
vi.mock('@/services/organizations', () => ({
  default: {
    os_list: vi.fn(async () => ({
      data: {
        data: [
          { name: 'Org A', identifier: 'org_a' },
          { name: 'Org B', identifier: 'org_b' },
        ],
      },
    })),
  },
}));
vi.mock('@/services/iam', () => ({ getRoles: vi.fn(async () => ({ data: ['admin', 'member'] })) }));
vi.mock('@/services/rate_limit', () => ({
  default: {
    update_batch: vi.fn(async () => ({ status: 200, data: { message: 'Saved' } })),
    download_template: vi.fn(async () => ({ status: 200, data: { some: 'json' } })),
    upload_template: vi.fn(async () => ({ status: 200, data: { message: 'Uploaded' } })),
  },
}));
vi.mock('@/composables/useRateLimiter', () => {
  const getApiLimitsByOrganization = vi.fn(async () => ([
    { module_name: 'module_1', list: 10, get: 20, create: 30, update: 40, delete: 50 },
    { module_name: 'module_2', list: 10, get: '-', create: '-', update: 5, delete: 1 },
  ]));
  const getRoleLimitsByOrganization = vi.fn(async () => ([
    { module_name: 'module_1', list: 11, get: 21, create: 31, update: 41, delete: 51 },
  ]));
  const getModulesToDisplay = vi.fn(async () => ([
    { label: 'module_1', value: 'module_1' },
    { label: 'module_2', value: 'module_2' },
  ]));
  return {
    default: () => ({ getApiLimitsByOrganization, getRoleLimitsByOrganization, getModulesToDisplay }),
  };
});

const orgSvc = (await import('@/services/organizations')).default;
const iamSvc = await import('@/services/iam');
const rateSvc = (await import('@/services/rate_limit')).default;
const rateLimiter = (await import('@/composables/useRateLimiter')).default();

const mountQuota = async (routeQuery = {}) => {
  // ensure required store shape
  store.state.modulesToDisplay = store.state.modulesToDisplay || {};
  store.state.allApiLimitsByOrgId = store.state.allApiLimitsByOrgId || {};
  store.state.allRoleLimitsByOrgIdByRole = store.state.allRoleLimitsByOrgIdByRole || {};
  store.state.organizations = store.state.organizations || [];
  store.state.theme = store.state.theme || 'light';

  await router.push({ name: 'quota', query: routeQuery });
  await router.isReady();
  await flushPromises();

  return mount(Quota, {
    global: {
      plugins: [i18n, router, store],
      stubs: {
        QueryEditor: { template: '<div data-test="query-editor-stub" />' },
        ConfirmDialog: { props: ['modelValue', 'title', 'message'], template: '<div class="confirm-dialog-stub" />' },
        NoOrganizationSelected: { template: '<div data-test="no-org-selected" />' },
        NoData: { template: '<div data-test="no-data" />' },
        AppTabs: { template: '<div data-test="app-tabs-stub" />' },
        QTablePagination: { template: '<div data-test="pagination-stub" />' },
      },
    },
  });
};

describe.skip('Quota page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // reset mock implementations
    orgSvc.os_list.mockResolvedValue({
      data: { data: [ { name: 'Org A', identifier: 'org_a' }, { name: 'Org B', identifier: 'org_b' } ] },
    });
    rateSvc.update_batch.mockResolvedValue({ status: 200, data: { message: 'Saved' } });
    rateSvc.download_template.mockResolvedValue({ status: 200, data: { some: 'json' } });
    rateSvc.upload_template.mockResolvedValue({ status: 200, data: { message: 'Uploaded' } });
  });

  it('renders header title', async () => {
    const wrapper = await mountQuota();
    expect(wrapper.find('[data-test="user-title-text"]').exists()).toBe(true);
  });

  it('shows organization select and tabs', async () => {
    const wrapper = await mountQuota();
    expect(wrapper.find('.org-select').exists()).toBe(true);
    expect(wrapper.find('[data-test="quota-tabs"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test="quota-api-limit-tab"]').length).toBe(1);
    expect(wrapper.findAll('[data-test="quota-role-limit-tab"]').length).toBe(1);
  });

  it('initializes organizations via service and selects first when no quota_org in route', async () => {
    const wrapper = await mountQuota();
    await flushPromises();
    expect(orgSvc.os_list).toHaveBeenCalled();
    expect(wrapper.vm.selectedOrganization).toBeTruthy();
    expect(['org_a', 'org_b']).toContain(wrapper.vm.selectedOrganization.value);
  });

  it('uses router query quota_org when present', async () => {
    const wrapper = await mountQuota({ quota_org: 'org_b' });
    await flushPromises();
    expect(wrapper.vm.selectedOrganization.value).toBe('org_b');
  });

  it('organizationToDisplay prepends global rules for api-limits tab', async () => {
    const wrapper = await mountQuota();
    const list = wrapper.vm.organizationToDisplay;
    expect(list[0].value).toBe('global_rules');
  });

  it('generateColumns returns empty when no org selected', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.selectedOrganization = null;
    expect(wrapper.vm.generateColumns()).toEqual([]);
  });

  it('generateColumns returns columns when org present', async () => {
    const wrapper = await mountQuota();
    await flushPromises();
    expect(wrapper.vm.generateColumns().length).toBeGreaterThan(0);
  });

  it('updateOrganization fetches API limits when not cached and updates route', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.selectedOrganization = { label: 'Org A', value: 'org_a' };
    const pushSpy = vi.spyOn(router, 'push');
    await wrapper.vm.updateOrganization();
    expect(pushSpy).toHaveBeenCalled();
    expect(rateLimiter.getApiLimitsByOrganization).toHaveBeenCalledWith('org_a');
  });

  it('selectedOrganization watcher updates apiCategories from store cache', async () => {
    const wrapper = await mountQuota();
    store.state.modulesToDisplay['org_a'] = [{ label: 'm', value: 'm' }];
    wrapper.vm.selectedOrganization = { label: 'Org A', value: 'org_a' };
    await flushPromises();
    expect(wrapper.vm.apiCategories).toEqual([{ label: 'm', value: 'm' }]);
  });

  it('selectedOrganization watcher calls getModulesToDisplay when cache missing', async () => {
    const wrapper = await mountQuota();
    delete store.state.modulesToDisplay['org_a'];
    wrapper.vm.selectedOrganization = { label: 'Org A', value: 'org_a' };
    await flushPromises();
    expect(rateLimiter.getModulesToDisplay).toHaveBeenCalledWith('org_a');
  });

  it('updateActiveTab switches to role-limits and fetches roles', async () => {
    const wrapper = await mountQuota();
    await wrapper.vm.updateActiveTab('role-limits');
    await flushPromises();
    expect(wrapper.vm.activeTab).toBe('role-limits');
    expect(iamSvc.getRoles).toHaveBeenCalled();
  });

  it('updateActiveTab switches to api-limits and refreshes api limits', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.selectedOrganization = { label: 'Org A', value: 'org_a' };
    await wrapper.vm.updateActiveTab('api-limits');
    await flushPromises();
    expect(wrapper.vm.activeTab).toBe('api-limits');
    expect(rateLimiter.getApiLimitsByOrganization).toHaveBeenCalled();
  });

  it('updateActiveTab opens confirm dialog if there are unsaved changes', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.changedValues = { m1: { list: 1 } };
    await wrapper.vm.updateActiveTab('role-limits');
    expect(wrapper.vm.showConfirmDialogTabSwitch).toBe(true);
  });

  it('switchTab handles global_rules and resets selectedOrganization for role-limits', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.organizations = [{ label: 'Org A', value: 'org_a' }];
    await router.push({ name: 'quota', query: { quota_org: 'global_rules' } });
    wrapper.vm.selectedOrganization = { label: 'global rules', value: 'global_rules' };
    await wrapper.vm.updateActiveTab('role-limits');
    await flushPromises();
    expect(wrapper.vm.selectedOrganization.value).toBe('org_a');
  });

  it('discardChangesTabSwitch resets without saving', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.changedValues = { m1: { list: 1 } };
    wrapper.vm.editTable = true;
    wrapper.vm.nextTab = 'role-limits';
    await wrapper.vm.discardChangesTabSwitch();
    expect(wrapper.vm.changedValues).toEqual({});
    expect(wrapper.vm.editTable).toBe(false);
  });

  it('editTableWithInput toggles editTable', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.editTableWithInput();
    expect(wrapper.vm.editTable).toBe(true);
  });

  it('getRolesByOrganization populates rolesLimitRows and resultTotal', async () => {
    const wrapper = await mountQuota();
    await wrapper.vm.updateActiveTab('role-limits');
    await flushPromises();
    expect(wrapper.vm.rolesLimitRows.length).toBeGreaterThan(0);
    expect(wrapper.vm.resultTotal).toBe(wrapper.vm.rolesLimitRows.length);
  });

  it('restrictToNumbers prevents invalid keypress', async () => {
    const wrapper = await mountQuota();
    const ev = { keyCode: 'A'.charCodeAt(0), preventDefault: vi.fn() };
    wrapper.vm.restrictToNumbers(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('handleInputChange cleans input and updates changedValues', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.handleInputChange('', 'module_1', {}, 'get', '12x');
    expect(wrapper.vm.changedValues.module_1.get).toBe(12);
    expect(wrapper.vm.isEdited('module_1', 'get')).toBe(true);
  });

  it('saveChanges validates and notifies on empty values', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.changedValues = { module_1: { get: '' } };
    const notifySpy = vi.spyOn(wrapper.vm.$q, 'notify');
    await wrapper.vm.saveChanges();
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
  });

  it('saveChanges saves api-limits, refreshes and clears state', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.selectedOrganization = { label: 'Org A', value: 'org_a' };
    wrapper.vm.changedValues = { module_1: { get: 10 } };
    await wrapper.vm.saveChanges();
    expect(rateSvc.update_batch).toHaveBeenCalledWith('org_a', { module_1: { get: 10 } }, 'module');
    expect(wrapper.vm.changedValues).toEqual({});
  });

  it('saveChanges saves role-limits with role and refreshes', async () => {
    const wrapper = await mountQuota();
    await wrapper.vm.updateActiveTab('role-limits');
    wrapper.vm.selectedOrganization = { label: 'Org A', value: 'org_a' };
    wrapper.vm.expandedRole = 'admin';
    wrapper.vm.changedValues = { module_1: { get: 10 } };
    await wrapper.vm.saveChanges();
    expect(rateSvc.update_batch).toHaveBeenCalledWith('org_a', { module_1: { get: 10 } }, 'role', 'admin');
  });

  it('cancelChanges resets editTable and changedValues', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.changedValues = { module_1: { get: 1 } };
    wrapper.vm.editTable = true;
    wrapper.vm.cancelChanges();
    expect(wrapper.vm.changedValues).toEqual({});
    expect(wrapper.vm.editTable).toBe(false);
  });

  it('saveJsonChanges updates via module path and notifies positive', async () => {
    const wrapper = await mountQuota();
    // ensure notify returns a dismiss function for any spinner notifications
    wrapper.vm.$q.notify = vi.fn(() => vi.fn());
    wrapper.vm.activeTab = 'api-limits';
    wrapper.vm.selectedOrganization = { label: 'Org A', value: 'org_a' };
    wrapper.vm.jsonStrToDisplay = JSON.stringify({ module_1: { get: 1 } });
    const notifySpy = vi.spyOn(wrapper.vm.$q, 'notify');
    await wrapper.vm.saveJsonChanges();
    expect(rateSvc.update_batch).toHaveBeenCalledWith('org_a', { module_1: { get: 1 } }, 'module');
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }));
  });

  it('saveJsonChanges updates via role path and notifies positive', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.$q.notify = vi.fn(() => vi.fn());
    wrapper.vm.activeTab = 'role-limits';
    wrapper.vm.expandedRole = 'member';
    wrapper.vm.selectedOrganization = { label: 'Org A', value: 'org_a' };
    wrapper.vm.jsonStrToDisplay = JSON.stringify({ module_1: { get: 1 } });
    await wrapper.vm.saveJsonChanges();
    expect(rateSvc.update_batch).toHaveBeenCalledWith('org_a', { module_1: { get: 1 } }, 'role', 'member');
  });


  it('isEdited returns true only when value exists in changedValues', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.changedValues = { module_1: { list: 1 } };
    expect(wrapper.vm.isEdited('module_1', 'list')).toBe(true);
    expect(wrapper.vm.isEdited('module_1', 'get')).toBe(false);
  });

  it('downloadTemplate calls service', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.selectedOrganization = { label: 'Org A', value: 'org_a' };
    await wrapper.vm.downloadTemplate();
    expect(rateSvc.download_template).toHaveBeenCalledWith('org_a');
  });

  it('uploadTemplate handles error and sets uploadError', async () => {
    const wrapper = await mountQuota();
    const notifyStub = vi.spyOn(wrapper.vm.$q, 'notify').mockImplementation(() => ({}));
    wrapper.vm.selectedOrganization = { label: 'Org A', value: 'org_a' };
    wrapper.vm.uploadedRules = [new Blob([JSON.stringify({ module_1: { get: 1 } })], { type: 'application/json' })];
    rateSvc.upload_template.mockRejectedValueOnce(new Error('upload failed'));
    await wrapper.vm.uploadTemplate();
    expect(wrapper.vm.uploadError).toBe('Error while uploading rules');
    notifyStub.mockRestore();
  });

  it('closeBulkUpdate resets related flags', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.isBulkUpdate = true;
    wrapper.vm.uploadedRules = [{}];
    wrapper.vm.uploadError = 'x';
    wrapper.vm.closeBulkUpdate();
    expect(wrapper.vm.isBulkUpdate).toBe(false);
    expect(wrapper.vm.uploadedRules).toBeNull();
    expect(wrapper.vm.uploadError).toBe('');
  });

  it('onFocus sets focusedInputId using generateUniqueId', async () => {
    const wrapper = await mountQuota();
    const row = { api_group_name: 'n', api_group_operation: 'op' };
    wrapper.vm.onFocus(row);
    expect(wrapper.vm.focusedInputId).toBe('n_op');
  });

  it('generateUniqueId concatenates fields', async () => {
    const wrapper = await mountQuota();
    const id = wrapper.vm.generateUniqueId({ api_group_name: 'a', api_group_operation: 'b' });
    expect(id).toBe('a_b');
  });

  it('filteredData filters by module_name for api-limits', async () => {
    const wrapper = await mountQuota();
    const rows = [ { module_name: 'alpha' }, { module_name: 'beta' } ];
    const out = wrapper.vm.filteredData(rows, 'alp');
    expect(out.length).toBe(1);
  });

  it('filteredData filters by role_name for role-limits', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.activeTab = 'role-limits';
    const rows = [ { role_name: 'admin' }, { role_name: 'dev' } ];
    const out = wrapper.vm.filteredData(rows, 'adm');
    expect(out.length).toBe(1);
  });

  it('triggerExpand toggles expandedRow and loads role level rows from service', async () => {
    const wrapper = await mountQuota();
    await wrapper.vm.updateActiveTab('role-limits');
    const props = { row: { role_name: 'admin', uuid: '1' } };
    await wrapper.vm.triggerExpand(props);
    expect(wrapper.vm.expandedRow).toBe('1');
    await wrapper.vm.triggerExpand(props);
    expect(wrapper.vm.expandedRow).toBe(null);
  });

  it('triggerExpand shows confirm dialog when there are unsaved changes', async () => {
    const wrapper = await mountQuota();
    await wrapper.vm.updateActiveTab('role-limits');
    wrapper.vm.changedValues = { m1: { list: 1 } };
    const props = { row: { role_name: 'admin', uuid: '1' } };
    await wrapper.vm.triggerExpand(props);
    expect(wrapper.vm.showConfirmDialogRowSwitch).toBe(true);
    expect(wrapper.vm.toBeExpandedRow).toEqual(props.row);
  });

  it('preventNonNumericPaste stops non-digit paste', async () => {
    const wrapper = await mountQuota();
    const ev = { clipboardData: { getData: () => 'abc' }, preventDefault: vi.fn() };
    wrapper.vm.preventNonNumericPaste(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('validateChanges detects empty values and returns false', async () => {
    const wrapper = await mountQuota();
    const notifySpy = vi.spyOn(wrapper.vm.$q, 'notify');
    const res = wrapper.vm.validateChanges({ module_1: { list: '' } });
    expect(res).toBe(false);
    expect(notifySpy).toHaveBeenCalled();
  });

  it('transformData converts array to object with filtered keys', async () => {
    const wrapper = await mountQuota();
    const res = wrapper.vm.transformData([
      { module_name: 'm1', list: 1, get: '-' },
      { module_name: 'm2', list: 2, get: 3 },
    ]);
    expect(Object.keys(res)).toEqual(['m1', 'm2']);
    expect(res.m1).toEqual({ list: 1 });
  });

  it('updateActiveType shows confirm dialog when switching to json with unsaved changes', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.changedValues = { m1: { list: 1 } };
    wrapper.vm.editTable = true;
    wrapper.vm.updateActiveType('json');
    expect(wrapper.vm.showConfirmDialogTypeSwitch).toBe(true);
  });

  it('updateActiveType switches to json and populates json when no changes', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.updateActiveType('json');
    expect(wrapper.vm.activeType).toBe('json');
    expect(wrapper.vm.jsonStrToDisplay).toContain('{');
  });

  it('updateActiveType switches to table when no changes in json', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.jsonStrToDisplay = JSON.stringify(wrapper.vm.transformData(wrapper.vm.apiLimitsRows), null, 2);
    wrapper.vm.editTable = true;
    wrapper.vm.updateActiveType('table');
    expect(wrapper.vm.activeType).toBe('table');
  });

  it('discardChangesRoleSwitch sets expansion to queued row', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.toBeExpandedRow = { role_name: 'admin', uuid: 'uuid-2' };
    await wrapper.vm.discardChangesRoleSwitch();
    expect(wrapper.vm.expandedRole).toBe('admin');
    expect(wrapper.vm.expandedRow).toBe('uuid-2');
  });

  it('jsonDiff checks difference correctly', async () => {
    const wrapper = await mountQuota();
    expect(wrapper.vm.jsonDiff('{"a":1}', { a: 1 })).toBe(true);
    const same = JSON.stringify({ a: 1 });
    expect(wrapper.vm.jsonDiff(same, { a: 1 })).toBe(true);
  });

  it('filterOrganizations updates filteredOrganizations by search', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.organizations = [ { label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' } ];
    wrapper.vm.filterOrganizations('alp', () => {});
    expect(wrapper.vm.filteredOrganizations).toEqual([ { label: 'Alpha', value: 'a' } ]);
  });

  it('filterApiCategoriesToDisplayOptions updates filteredApiCategoryToDisplayOptions', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.apiCategories = [ { label: 'module_1', value: 'module_1' }, { label: 'module_2', value: 'module_2' } ];
    wrapper.vm.filterApiCategoriesToDisplayOptions('module_1', () => {});
    expect(wrapper.vm.filteredApiCategoryToDisplayOptions).toEqual([ { label: 'module_1', value: 'module_1' } ]);
  });

  it('changePagination updates pagination and table', async () => {
    const wrapper = await mountQuota();
    wrapper.vm.qTable = { setPagination: vi.fn() };
    wrapper.vm.changePagination({ label: '20', value: 20 });
    expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    expect(wrapper.vm.qTable.setPagination).toHaveBeenCalled();
  });

  it('filterModulesBasedOnCategory filters role-level rows by selected category', async () => {
    const wrapper = await mountQuota();
    await wrapper.vm.updateActiveTab('role-limits');
    wrapper.vm.roleLevelModuleRows = [
      { module_name: 'module_1', list: 1 },
      { module_name: 'module_2', list: 2 },
    ];
    wrapper.vm.selectedApiCategory = { value: 'module_1' };
    wrapper.vm.filterModulesBasedOnCategory();
    expect(wrapper.vm.filteredRoleLevelModuleRows).toEqual([{ module_name: 'module_1', list: 1 }]);
    wrapper.vm.selectedApiCategory = null;
    wrapper.vm.filterModulesBasedOnCategory();
    expect(wrapper.vm.filteredRoleLevelModuleRows.length).toBe(2);
  });
});
