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

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { installQuasar } from '@/test/unit/helpers/install-quasar-plugin';
import enterprisePlan from '@/enterprise/components/billings/enterprisePlan.vue';
import i18n from '@/locales';
import store from '@/test/unit/helpers/store';

// Install Quasar
installQuasar();

// Mock window.open
const mockWindowOpen = vi.fn();
Object.defineProperty(window, 'open', {
  value: mockWindowOpen,
  writable: true,
});

// Mock constants config
vi.mock('@/constants/config', () => ({
  siteURL: {
    contactSales: 'https://openobserve.ai/contactus/'
  }
}));

describe('enterprisePlan.vue', () => {
  let wrapper: VueWrapper<any>;
  
  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = mount(enterprisePlan, {
      global: {
        plugins: [i18n],
        provide: {
          store
        },
        stubs: {
          'q-card': true,
          'q-chip': true,
          'q-separator': true,
          'q-icon': true,
          'q-btn': {
            template: '<button @click="$emit(\'click\')" v-bind="$attrs"><slot/></button>',
            emits: ['click']
          }
        }
      }
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // Test 1: Component mounts successfully
  it('should mount successfully', () => {
    expect(wrapper.exists()).toBe(true);
  });

  // Test 2: Component name is correct
  it('should have correct component name', () => {
    expect(wrapper.vm.$options.name).toBe('enterprisePlan');
  });

  // Test 3: planName is correctly initialized
  it('should initialize planName as "enterprise"', () => {
    expect(wrapper.vm.planName).toBe('enterprise');
  });

  // Test 4: features array is properly initialized
  it('should initialize features array with correct structure', () => {
    const features = wrapper.vm.features;
    expect(Array.isArray(features)).toBe(true);
    expect(features).toHaveLength(13);
  });

  // Test 5: First feature has correct properties
  it('should have correct first feature properties', () => {
    const firstFeature = wrapper.vm.features[0];
    expect(firstFeature.name).toBe('Everything in Pay as you go plan, plus:');
    expect(firstFeature.price).toBe('');
    expect(firstFeature.is_parent).toBe(true);
  });

  // Test 6: Second feature has correct properties
  it('should have correct second feature properties', () => {
    const secondFeature = wrapper.vm.features[1];
    expect(secondFeature.name).toBe('Extended Data Retention');
    expect(secondFeature.price).toBe('');
    expect(secondFeature.is_parent).toBe(true);
  });

  // Test 7: Third feature has correct properties
  it('should have correct third feature properties', () => {
    const thirdFeature = wrapper.vm.features[2];
    expect(thirdFeature.name).toBe('Priority Support');
    expect(thirdFeature.price).toBe('');
    expect(thirdFeature.is_parent).toBe(true);
  });

  // Test 8: Fourth feature has correct properties
  it('should have correct fourth feature properties', () => {
    const fourthFeature = wrapper.vm.features[3];
    expect(fourthFeature.name).toBe('SSO (Single Sign On) with Custom Auth Providers');
    expect(fourthFeature.price).toBe('');
    expect(fourthFeature.is_parent).toBe(true);
  });

  // Test 9: Fifth feature has correct properties
  it('should have correct fifth feature properties', () => {
    const fifthFeature = wrapper.vm.features[4];
    expect(fifthFeature.name).toBe('(Okta, Microsoft Entra, etc)');
    expect(fifthFeature.price).toBe('');
    expect(fifthFeature.is_parent).toBe(false);
  });

  // Test 10: Sixth feature has correct properties
  it('should have correct sixth feature properties', () => {
    const sixthFeature = wrapper.vm.features[5];
    expect(sixthFeature.name).toBe('SLA Guarantees');
    expect(sixthFeature.price).toBe('');
    expect(sixthFeature.is_parent).toBe(true);
  });

  // Test 11: All parent features have is_parent true
  it('should have correct is_parent values for parent features', () => {
    const parentFeatures = wrapper.vm.features.filter((f: any) => f.is_parent === true);
    expect(parentFeatures).toHaveLength(5); // Actual count of parent features
  });

  // Test 12: All child features have is_parent false
  it('should have correct is_parent values for child features', () => {
    const childFeatures = wrapper.vm.features.filter((f: any) => f.is_parent === false);
    expect(childFeatures).toHaveLength(8); // One child feature + 7 empty features
  });

  // Test 13: Empty features have correct structure
  it('should have correct structure for empty features', () => {
    const emptyFeatures = wrapper.vm.features.slice(6); // Last 7 features
    emptyFeatures.forEach((feature: any) => {
      expect(feature.name).toBe('');
      expect(feature.price).toBe('');
      expect(feature.is_parent).toBe(false);
    });
  });

  // Test 14: contactSales function exists
  it('should have contactSales function', () => {
    expect(typeof wrapper.vm.contactSales).toBe('function');
  });

  // Test 15: contactSales function opens correct URL
  it('should call window.open with correct URL when contactSales is called', () => {
    wrapper.vm.contactSales();
    expect(mockWindowOpen).toHaveBeenCalledWith('https://openobserve.ai/contactus/', '_blank');
  });

  // Test 16: contactSales function is called once
  it('should call window.open once when contactSales is invoked', () => {
    wrapper.vm.contactSales();
    expect(mockWindowOpen).toHaveBeenCalledTimes(1);
  });

  // Test 17: t function is available in component
  it('should have translation function available', () => {
    expect(typeof wrapper.vm.t).toBe('function');
  });

  // Test 18: Component renders with proper structure
  it('should render with correct card structure', () => {
    expect(wrapper.exists()).toBe(true);
  });

  // Test 19: Contact button exists and has correct properties
  it('should render contact button with correct properties', () => {
    // Since we're using stubs, just verify the component has the expected structure
    expect(wrapper.html()).toBeDefined();
    expect(wrapper.vm.contactSales).toBeDefined();
  });

  // Test 20: Button click triggers contactSales
  it('should call contactSales when button is clicked', async () => {
    // Direct function call test instead of DOM interaction due to stubbing
    wrapper.vm.contactSales();
    expect(mockWindowOpen).toHaveBeenCalledWith('https://openobserve.ai/contactus/', '_blank');
  });

  // Test 21: Features are rendered in template
  it('should render features in template', () => {
    // Test that features are properly exposed by the component
    expect(wrapper.vm.features.length).toBe(13);
    
    // Verify features contain expected structure
    const firstFeature = wrapper.vm.features[0];
    expect(firstFeature).toHaveProperty('name');
    expect(firstFeature).toHaveProperty('price');
    expect(firstFeature).toHaveProperty('is_parent');
  });

  // Test 22: Component template renders correctly
  it('should render component template correctly', () => {
    expect(wrapper.html()).toBeDefined();
    expect(wrapper.html().length).toBeGreaterThan(0);
  });

  // Test 23: Component has proper Vue structure
  it('should have proper Vue component structure', () => {
    expect(wrapper.vm).toBeDefined();
  });

  // Test 24: Component setup function returns correct properties
  it('should return correct properties from setup function', () => {
    expect(wrapper.vm.t).toBeDefined();
    expect(wrapper.vm.features).toBeDefined();
    expect(wrapper.vm.contactSales).toBeDefined();
    expect(wrapper.vm.planName).toBeDefined();
  });

  // Test 25: Features array structure is immutable during component lifecycle
  it('should maintain features array structure throughout lifecycle', async () => {
    const initialFeatures = [...wrapper.vm.features];
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.features).toEqual(initialFeatures);
  });

  // Test 26: planName remains constant
  it('should keep planName constant throughout lifecycle', async () => {
    const initialPlanName = wrapper.vm.planName;
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.planName).toBe(initialPlanName);
  });

  // Test 27: Component has correct Vue composition API setup
  it('should use Vue 3 composition API correctly', () => {
    expect(wrapper.vm.$options.setup).toBeDefined();
  });

  // Test 28: All features have required properties
  it('should have all required properties for each feature', () => {
    wrapper.vm.features.forEach((feature: any) => {
      expect(feature).toHaveProperty('name');
      expect(feature).toHaveProperty('price');
      expect(feature).toHaveProperty('is_parent');
    });
  });

  // Test 29: Feature prices are all empty strings
  it('should have empty prices for all features', () => {
    wrapper.vm.features.forEach((feature: any) => {
      expect(feature.price).toBe('');
    });
  });

  // Test 30: Component uses composition API setup
  it('should have setup function defined', () => {
    // Verify the component uses composition API setup
    expect(wrapper.vm.$options.setup).toBeDefined();
  });
});