// Copyright 2026 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar, QDialog, QCard, QCardSection, QSeparator, QBtn, QSpace } from 'quasar';
import DestinationPreview from '@/components/alerts/DestinationPreview.vue';

const quasarConfig = {
  components: {
    QDialog,
    QCard,
    QCardSection,
    QSeparator,
    QBtn,
    QSpace
  }
};

// Mock the i18n composable
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}));

// Mock Quasar notify
const mockNotify = vi.fn();
vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    useQuasar: () => ({
      notify: mockNotify
    })
  };
});

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn()
  }
});

describe('DestinationPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createWrapper = (props = {}) => {
    return mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: 'slack',
        templateContent: '{"text": "test"}',
        ...props
      },
      global: {
        plugins: [[Quasar, quasarConfig]]
      }
    });
  };

  it('renders dialog when modelValue is true', () => {
    const wrapper = createWrapper();
    expect(wrapper.find('[data-test="destination-preview-dialog"]').exists()).toBe(true);
  });

  it('does not render dialog when modelValue is false', () => {
    const wrapper = createWrapper({ modelValue: false });
    expect(wrapper.find('[data-test="destination-preview-dialog"]').exists()).toBe(false);
  });

  it('emits update:modelValue when close button is clicked', async () => {
    const wrapper = createWrapper();
    await wrapper.find('[data-test="preview-close-button"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false]);
  });

  describe('destination type names', () => {
    it('displays correct name for slack', () => {
      const wrapper = createWrapper({ type: 'slack' });
      expect(wrapper.find('[data-test="preview-title"]').text()).toContain('Slack');
    });

    it('displays correct name for msteams', () => {
      const wrapper = createWrapper({ type: 'msteams' });
      expect(wrapper.find('[data-test="preview-title"]').text()).toContain('Microsoft Teams');
    });

    it('displays correct name for email', () => {
      const wrapper = createWrapper({ type: 'email' });
      expect(wrapper.find('[data-test="preview-title"]').text()).toContain('Email');
    });

    it('displays correct name for pagerduty', () => {
      const wrapper = createWrapper({ type: 'pagerduty' });
      expect(wrapper.find('[data-test="preview-title"]').text()).toContain('PagerDuty');
    });

    it('displays correct name for servicenow', () => {
      const wrapper = createWrapper({ type: 'servicenow' });
      expect(wrapper.find('[data-test="preview-title"]').text()).toContain('ServiceNow');
    });

    it('displays correct name for opsgenie', () => {
      const wrapper = createWrapper({ type: 'opsgenie' });
      expect(wrapper.find('[data-test="preview-title"]').text()).toContain('Opsgenie');
    });

    it('displays type as-is for unknown types', () => {
      const wrapper = createWrapper({ type: 'custom-type' });
      expect(wrapper.find('[data-test="preview-title"]').text()).toContain('custom-type');
    });
  });

  describe('preview rendering', () => {
    it('renders slack preview when type is slack', () => {
      const wrapper = createWrapper({ type: 'slack' });
      expect(wrapper.find('[data-test="slack-preview"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="slack-bot-name"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="slack-message-body"]').exists()).toBe(true);
    });

    it('renders msteams preview when type is msteams', () => {
      const wrapper = createWrapper({ type: 'msteams' });
      expect(wrapper.find('[data-test="msteams-preview"]').exists()).toBe(true);
    });

    it('renders email preview when type is email', () => {
      const wrapper = createWrapper({ type: 'email' });
      expect(wrapper.find('[data-test="email-preview"]').exists()).toBe(true);
    });

    it('renders pagerduty preview when type is pagerduty', () => {
      const wrapper = createWrapper({ type: 'pagerduty' });
      expect(wrapper.find('[data-test="pagerduty-preview"]').exists()).toBe(true);
    });

    it('renders servicenow preview when type is servicenow', () => {
      const wrapper = createWrapper({ type: 'servicenow' });
      expect(wrapper.find('[data-test="servicenow-preview"]').exists()).toBe(true);
    });

    it('renders opsgenie preview when type is opsgenie', () => {
      const wrapper = createWrapper({ type: 'opsgenie' });
      expect(wrapper.find('[data-test="opsgenie-preview"]').exists()).toBe(true);
    });
  });

  describe('getCurrentTime function', () => {
    it('returns a formatted time string', () => {
      const wrapper = createWrapper();
      const component = wrapper.vm as any;
      const time = component.getCurrentTime();
      expect(typeof time).toBe('string');
      expect(time.length).toBeGreaterThan(0);
    });
  });

  describe('getDestinationTypeName function', () => {
    it('returns correct names for all known types', () => {
      const wrapper = createWrapper();
      const component = wrapper.vm as any;

      expect(component.getDestinationTypeName('slack')).toBe('Slack');
      expect(component.getDestinationTypeName('msteams')).toBe('Microsoft Teams');
      expect(component.getDestinationTypeName('email')).toBe('Email');
      expect(component.getDestinationTypeName('pagerduty')).toBe('PagerDuty');
      expect(component.getDestinationTypeName('servicenow')).toBe('ServiceNow');
      expect(component.getDestinationTypeName('opsgenie')).toBe('Opsgenie');
    });

    it('returns the input type for unknown types', () => {
      const wrapper = createWrapper();
      const component = wrapper.vm as any;
      expect(component.getDestinationTypeName('unknown')).toBe('unknown');
    });
  });

  describe('copyTemplate function', () => {
    it('copies template to clipboard and shows success notification', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator.clipboard, { writeText: writeTextMock });

      const wrapper = createWrapper({ templateContent: '{"test": "content"}' });
      const component = wrapper.vm as any;

      await component.copyTemplate();

      expect(writeTextMock).toHaveBeenCalledWith('{"test": "content"}');
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'positive',
        message: 'Template copied to clipboard',
        timeout: 2000
      });
    });

    it('shows error notification when copy fails', async () => {
      const writeTextMock = vi.fn().mockRejectedValue(new Error('Copy failed'));
      Object.assign(navigator.clipboard, { writeText: writeTextMock });

      const wrapper = createWrapper();
      const component = wrapper.vm as any;

      await component.copyTemplate();

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Failed to copy template',
        timeout: 2000
      });
    });
  });

  describe('v-model binding', () => {
    it('updates isOpen when modelValue prop changes', async () => {
      const wrapper = createWrapper({ modelValue: true });
      expect(wrapper.find('[data-test="destination-preview-dialog"]').exists()).toBe(true);

      await wrapper.setProps({ modelValue: false });
      expect(wrapper.find('[data-test="destination-preview-dialog"]').exists()).toBe(false);
    });

    it('emits update:modelValue when isOpen changes', async () => {
      const wrapper = createWrapper({ modelValue: true });
      const component = wrapper.vm as any;

      component.isOpen = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    });
  });
});
