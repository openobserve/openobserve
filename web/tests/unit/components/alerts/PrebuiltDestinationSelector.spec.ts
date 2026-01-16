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

import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar, QInput, QIcon, QBtn, QBadge } from 'quasar';
import PrebuiltDestinationSelector from '@/components/alerts/PrebuiltDestinationSelector.vue';

const quasarConfig = {
  components: {
    QInput,
    QIcon,
    QBtn,
    QBadge
  }
};

// Mock the i18n composable
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}));

// Mock the prebuilt templates
vi.mock('@/utils/prebuilt-templates', () => ({
  PREBUILT_DESTINATION_TYPES: [
    {
      id: 'slack',
      name: 'Slack',
      description: 'Send alerts to Slack channels',
      icon: 'slack',
      category: 'messaging',
      popular: true
    },
    {
      id: 'email',
      name: 'Email',
      description: 'Send alerts via email',
      icon: 'email',
      category: 'email',
      popular: false
    }
  ]
}));

describe('PrebuiltDestinationSelector', () => {
  const createWrapper = (props = {}) => {
    return mount(PrebuiltDestinationSelector, {
      props: {
        modelValue: null,
        searchQuery: '',
        ...props
      },
      global: {
        plugins: [[Quasar, quasarConfig]]
      }
    });
  };

  it('renders correctly', () => {
    const wrapper = createWrapper();
    expect(wrapper.find('[data-test="prebuilt-destination-selector"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="destination-search-input"]').exists()).toBe(true);
  });

  it('displays destination type cards', () => {
    const wrapper = createWrapper();
    const cards = wrapper.findAll('[data-test="destination-type-card"]');
    expect(cards.length).toBe(3); // 2 prebuilt + 1 custom

    // Check Slack card
    const slackCard = wrapper.find('[data-type="slack"]');
    expect(slackCard.exists()).toBe(true);
    expect(slackCard.text()).toContain('Slack');

    // Check custom card
    const customCard = wrapper.find('[data-type="custom"]');
    expect(customCard.exists()).toBe(true);
    expect(customCard.text()).toContain('alerts.customDestination');
  });

  it('shows popular badge for popular destinations', () => {
    const wrapper = createWrapper();
    const slackCard = wrapper.find('[data-type="slack"]');
    expect(slackCard.find('[data-test="destination-popular-badge"]').exists()).toBe(true);
  });

  it('emits select event when card is clicked', async () => {
    const wrapper = createWrapper();

    await wrapper.find('[data-type="slack"]').trigger('click');

    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')[0]).toEqual(['slack']);
  });

  it('shows selected state correctly', () => {
    const wrapper = createWrapper({ modelValue: 'slack' });

    const slackCard = wrapper.find('[data-type="slack"]');
    expect(slackCard.classes()).toContain('selected');
    expect(slackCard.find('.selection-indicator').exists()).toBe(true);
  });

  it('filters destinations based on search query', async () => {
    const wrapper = createWrapper({ searchQuery: 'slack' });

    // Should show only Slack and custom options
    const visibleCards = wrapper.findAll('[data-test="destination-type-card"]:not(.q-field)');
    expect(visibleCards.length).toBe(1); // Only Slack matches search
  });

  it('shows empty state when no results found', async () => {
    const wrapper = createWrapper();

    // Search for something that doesn't exist
    await wrapper.find('[data-test="destination-search-input"]').setValue('nonexistent');

    expect(wrapper.find('[data-test="destination-search-empty"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('alerts.noDestinationTypesFound');
  });

  it('clears search when clear search button is clicked', async () => {
    const wrapper = createWrapper();

    // Set search query to show empty state
    await wrapper.find('[data-test="destination-search-input"]').setValue('nonexistent');

    // Click clear search button
    await wrapper.find('[data-test="destination-search-empty"] .q-btn').trigger('click');

    expect(wrapper.emitted('update:searchQuery')).toBeTruthy();
    expect(wrapper.emitted('update:searchQuery').slice(-1)[0]).toEqual(['']);
  });

  it('maps icons correctly', () => {
    const wrapper = createWrapper();
    const component = wrapper.vm;

    expect(component.getIconName('slack')).toBe('chat');
    expect(component.getIconName('email')).toBe('email');
    expect(component.getIconName('unknown')).toBe('unknown'); // fallback
  });
});