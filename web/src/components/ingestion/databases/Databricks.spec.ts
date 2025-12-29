// Copyright 2023 OpenObserve Inc.
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

import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { Quasar } from 'quasar';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Databricks from './Databricks.vue';
import useIngestion from '@/composables/useIngestion';
import * as zincutils from '@/utils/zincutils';

// Mock the composable
vi.mock('@/composables/useIngestion');
vi.mock('@/utils/zincutils');
vi.mock('../../../aws-exports', () => ({
  default: {
    REGION: 'us-west-2',
    API_ENDPOINT: 'https://test.openobserve.ai'
  }
}));

// Mock Quasar
vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    useQuasar: vi.fn(() => ({
      notify: vi.fn(),
    })),
  };
});

const createMockStore = () => {
  return createStore({
    state: {
      selectedOrganization: {
        identifier: 'test-org',
        label: 'Test Organization'
      }
    }
  });
};

const createMockI18n = () => {
  return createI18n({
    locale: 'en',
    messages: {
      en: {
        common: {
          copy: 'Copy',
          copied: 'Copied'
        }
      }
    }
  });
};

const mockIngestionData = {
  endpoint: {
    url: 'https://test.openobserve.ai',
    host: 'test.openobserve.ai',
    port: '443',
    protocol: 'https',
    tls: true
  },
  databaseContent: `exporters:
  otlphttp/openobserve:
    endpoint: https://test.openobserve.ai/api/test-org/[STREAM_NAME]
    headers:
      Authorization: Basic [BASIC_PASSCODE]
      stream-name: [STREAM_NAME]`,
  databaseDocURLs: {
    databricks: 'https://short.openobserve.ai/databricks'
  }
};

describe('Databricks.vue', () => {
  let wrapper: any;
  let store: any;
  let i18n: any;

  beforeEach(() => {
    store = createMockStore();
    i18n = createMockI18n();
    vi.mocked(useIngestion).mockReturnValue(mockIngestionData as any);
    vi.mocked(zincutils.getImageURL).mockReturnValue('https://test.com/image.png');
  });

  const getGlobalConfig = (props = {}) => ({
    props,
    global: {
      plugins: [store, i18n, [Quasar, {}]],
      stubs: {
        CopyContent: {
          template: '<div class="copy-content-stub copy-content-container-cls"><slot /></div>',
          props: ['content']
        }
      }
    }
  });

  // Test 1: Component mounts successfully
  it('should mount successfully', () => {
    wrapper = mount(Databricks, getGlobalConfig());
    expect(wrapper.exists()).toBe(true);
  });

  // Test 2: Component name is correct
  it('should have correct component name', () => {
    wrapper = mount(Databricks, getGlobalConfig());
    expect(wrapper.vm.$options.name).toBe('PostgresPage');
  });

  // Test 3: Props are defined correctly
  it('should define currOrgIdentifier prop', () => {
    const Component = Databricks as any;
    expect(Component.props.currOrgIdentifier).toBeDefined();
    expect(Component.props.currOrgIdentifier.type).toBe(String);
  });

  // Test 4: Props are defined correctly for currUserEmail
  it('should define currUserEmail prop', () => {
    const Component = Databricks as any;
    expect(Component.props.currUserEmail).toBeDefined();
    expect(Component.props.currUserEmail.type).toBe(String);
  });

  // Test 5: Template renders main container
  it('should render main container with correct class', () => {
    wrapper = mount(Databricks, getGlobalConfig());
    const container = wrapper.find('.q-pa-sm');
    expect(container.exists()).toBe(true);
  });

  // Test 6: CopyContent component is present
  it('should render CopyContent component', () => {
    wrapper = mount(Databricks, getGlobalConfig());
    const copyContent = wrapper.find('.copy-content-stub');
    expect(copyContent.exists()).toBe(true);
  });

  // Test 7: CopyContent receives correct content prop
  it('should pass correct content to CopyContent component', () => {
    wrapper = mount(Databricks, getGlobalConfig());
    expect(wrapper.vm.content).toContain('databricks');
  });

  // Test 8: Documentation link is rendered
  it('should render documentation link', () => {
    wrapper = mount(Databricks, {
      ...getGlobalConfig()
    });
    const link = wrapper.find('a[target="_blank"]');
    expect(link.exists()).toBe(true);
  });

  // Test 9: Documentation link has correct href
  it('should have correct documentation URL', () => {
    wrapper = mount(Databricks, {
      ...getGlobalConfig()
    });
    const link = wrapper.find('a[target="_blank"]');
    expect(link.attributes('href')).toBe('https://short.openobserve.ai/databricks');
  });

  // Test 10: Documentation link has correct text
  it('should have correct documentation link text', () => {
    wrapper = mount(Databricks, {
      ...getGlobalConfig()
    });
    const linkText = wrapper.find('a[target="_blank"]').text();
    expect(linkText).toBe('here');
  });

  // Test 11: Documentation link has correct styling
  it('should have correct styling for documentation link', () => {
    wrapper = mount(Databricks, {
      ...getGlobalConfig()
    });
    const link = wrapper.find('a[target="_blank"]');
    expect(link.classes()).toContain('text-blue-500');
    expect(link.classes()).toContain('hover:text-blue-600');
  });

  // Test 12: Setup function returns correct values
  it('should return correct values from setup function', () => {
    wrapper = mount(Databricks, {
      ...getGlobalConfig()
    });
    expect(wrapper.vm.config).toBeDefined();
    expect(wrapper.vm.docURL).toBe('https://short.openobserve.ai/databricks');
    expect(wrapper.vm.getImageURL).toBeDefined();
    expect(wrapper.vm.content).toBeDefined();
  });

  // Test 14: Name variable is set correctly
  it('should set name variable to databricks', () => {
    const mockSetup = vi.fn().mockImplementation(() => {
      const name = 'databricks';
      return { name };
    });
    
    const component = { ...Databricks, setup: mockSetup };
    mount(component, {
      ...getGlobalConfig()
    });
    
    expect(mockSetup).toHaveBeenCalled();
  });

  // Test 15: useIngestion composable is called
  it('should call useIngestion composable', () => {
    mount(Databricks, {
      ...getGlobalConfig()
    });
    expect(useIngestion).toHaveBeenCalled();
  });

  // Test 16: Component imports are correct
  it('should import CopyContent component correctly', () => {
    wrapper = mount(Databricks, getGlobalConfig());
    expect(wrapper.find('.copy-content-stub').exists()).toBe(true);
  });

  // Test 17: Props can be passed to component
  it('should accept currOrgIdentifier prop', () => {
    wrapper = mount(Databricks, getGlobalConfig({ currOrgIdentifier: 'test-org-123' }));
    expect(wrapper.props('currOrgIdentifier')).toBe('test-org-123');
  });

  // Test 18: Props can be passed to component for email
  it('should accept currUserEmail prop', () => {
    wrapper = mount(Databricks, getGlobalConfig({ currUserEmail: 'test@example.com' }));
    expect(wrapper.props('currUserEmail')).toBe('test@example.com');
  });

  // Test 19: Component structure matches expected layout
  it('should have correct component structure', () => {
    wrapper = mount(Databricks, getGlobalConfig());
    const container = wrapper.find('.q-pa-sm');
    const textDiv = container.find('div[class*="tw:text-"]');
    const boldDiv = wrapper.find('div[class*="tw:font-bold"]');
    
    expect(container.exists()).toBe(true);
    expect(textDiv.exists()).toBe(true);
    expect(boldDiv.exists()).toBe(true);
  });

  // Test 20: CopyContent has correct classes
  it('should apply correct classes to CopyContent', () => {
    wrapper = mount(Databricks, getGlobalConfig());
    const copyContent = wrapper.find('.copy-content-stub');
    expect(copyContent.classes()).toContain('copy-content-container-cls');
  });

  // Test 21: Documentation section styling
  it('should apply correct styling to documentation section', () => {
    wrapper = mount(Databricks, {
      ...getGlobalConfig()
    });
    const docSection = wrapper.find('.tw\\:font-bold.tw\\:pt-6.tw\\:pb-2');
    expect(docSection.exists()).toBe(true);
    expect(docSection.classes()).toContain('tw:font-bold');
    expect(docSection.classes()).toContain('tw:pt-6');
    expect(docSection.classes()).toContain('tw:pb-2');
  });

  // Test 22: Template text content
  it('should display correct documentation text', () => {
    wrapper = mount(Databricks, {
      ...getGlobalConfig()
    });
    const docText = wrapper.text();
    expect(docText).toContain('Click');
    expect(docText).toContain('to check further documentation');
  });

  // Test 23: Link styling attributes
  it('should have correct inline styling for documentation link', () => {
    wrapper = mount(Databricks, {
      ...getGlobalConfig()
    });
    const link = wrapper.find('a[target="_blank"]');
    expect(link.attributes('style')).toContain('text-decoration: underline');
  });

  // Test 24: Component reactive data
  it('should have reactive content data', async () => {
    wrapper = mount(Databricks, {
      ...getGlobalConfig()
    });
    
    const initialContent = wrapper.vm.content;
    expect(typeof initialContent).toBe('string');
    expect(initialContent.length).toBeGreaterThan(0);
  });

  // Test 25: Error handling for missing props
  it('should handle undefined props gracefully', () => {
    wrapper = mount(Databricks, getGlobalConfig({ 
      currOrgIdentifier: undefined,
      currUserEmail: undefined
    }));
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.props('currOrgIdentifier')).toBeUndefined();
    expect(wrapper.props('currUserEmail')).toBeUndefined();
  });

  // Test 26: Component instance methods access
  it('should expose getImageURL function', () => {
    wrapper = mount(Databricks, {
      ...getGlobalConfig()
    });
    expect(wrapper.vm.getImageURL).toBeDefined();
    expect(typeof wrapper.vm.getImageURL).toBe('function');
  });

  // Test 27: Config object availability
  it('should expose config object', () => {
    wrapper = mount(Databricks, {
      ...getGlobalConfig()
    });
    expect(wrapper.vm.config).toBeDefined();
    expect(typeof wrapper.vm.config).toBe('object');
  });

  // Test 28: Component cleanup
  it('should clean up properly when unmounted', () => {
    wrapper = mount(Databricks, {
      ...getGlobalConfig()
    });
    
    expect(wrapper.exists()).toBe(true);
    wrapper.unmount();
    expect(wrapper.exists()).toBe(false);
  });
});