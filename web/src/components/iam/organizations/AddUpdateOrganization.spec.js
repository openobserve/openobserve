import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { installQuasar } from '@/test/unit/helpers/install-quasar-plugin';
import { Dialog, Notify } from 'quasar';
import i18n from '@/locales';
import router from '@/test/unit/helpers/router';
import store from '@/test/unit/helpers/store';
import AddUpdateOrganization from '@/components/iam/organizations/AddUpdateOrganization.vue';

installQuasar({ plugins: [Dialog, Notify] });

vi.mock('@/services/organizations', () => ({
  default: {
    create: vi.fn(async (data) => {
      return { status: 200, data: { data: { id: '1', name: data.name, identifier: 'org-1' } } };
    }),
  },
}));

const orgService = (await import('@/services/organizations')).default;

const mountComp = (props = {}) =>
  mount(AddUpdateOrganization, {
    global: {
      plugins: [i18n, router, store],
    },
    props: { modelValue: { id: '', name: '' }, ...props },
  });

describe('AddUpdateOrganization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders create organization title when not updating', () => {
    const wrapper = mountComp();
    expect(wrapper.find('[data-test="create-org"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="update-org"]').exists()).toBe(false);
  });

  it('renders update organization title when beingUpdated', () => {
    const wrapper = mountComp({ modelValue: { id: '123', name: 'Acme' } });
    expect(wrapper.find('[data-test="update-org"]').exists()).toBe(true);
  });

  it('disables save when name is empty (no proPlanRequired)', async () => {
    const wrapper = mountComp();
    await flushPromises();
    const btn = wrapper.find('[data-test="add-org"]');
    expect(btn.attributes('disabled')).toBeDefined();
  });

  it('trims name on submit and calls organizations.create, success path resets form and emits updated', async () => {
    const wrapper = mountComp();
    await wrapper.find('[data-test="org-name"]').setValue('  My Org  ');

    // stub form validate to resolve true
    wrapper.vm.addOrganizationForm = { validate: vi.fn().mockResolvedValue(true), resetValidation: vi.fn() };

    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(orgService.create).toHaveBeenCalledWith({ name: 'My Org' });
    expect(wrapper.emitted('updated')).toBeTruthy();
    expect(wrapper.vm.organizationData.name).toBe('');
  });

  it('when create returns non-200, shows pro plan required flow and navigates to subscribe', async () => {
    vi.spyOn(orgService, 'create').mockResolvedValueOnce({ status: 402, data: { message: 'Need Pro', identifier: 'org-new', data: { identifier: 'org-new' } } });

    const pushSpy = vi.spyOn(router, 'push');
    const wrapper = mountComp();
    await wrapper.find('[data-test="org-name"]').setValue('Test Org');
    wrapper.vm.addOrganizationForm = { validate: vi.fn().mockResolvedValue(true), resetValidation: vi.fn() };

    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(wrapper.vm.proPlanRequired).toBe(true);
    expect(wrapper.vm.proPlanMsg).toBe('Need Pro');
    expect(wrapper.vm.newOrgIdentifier).toBe('org-new');
    expect(pushSpy).toHaveBeenCalledWith({
      name: 'organizations',
      query: expect.objectContaining({ action: 'subscribe' }),
    });
  });

  it('handles create error and shows notify negative', async () => {
    vi.spyOn(orgService, 'create').mockRejectedValueOnce({ response: { data: { message: 'Organization creation failed.' } } });

    const wrapper = mountComp();
    await wrapper.find('[data-test="org-name"]').setValue('Err Org');
    wrapper.vm.addOrganizationForm = { validate: vi.fn().mockResolvedValue(true), resetValidation: vi.fn() };

    // mock notify
    const notifySpy = vi.spyOn(wrapper.vm.$q, 'notify');

    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
  });

  it('completeSubscriptionProcess navigates to billing plans with newOrgIdentifier', async () => {
    const wrapper = mountComp();
    wrapper.vm.newOrgIdentifier = 'org-123';
    const pushSpy = vi.spyOn(router, 'push');

    wrapper.vm.completeSubscriptionProcess();
    expect(pushSpy).toHaveBeenCalledWith('/billings/plans?org_identifier=org-123');
  });
});
