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
import { defineComponent } from 'vue';
import { Quasar } from 'quasar';
import { usePrebuiltDestinations } from '@/composables/usePrebuiltDestinations';

// Mock the services
vi.mock('@/services/alert_destination', () => ({
  default: {
    create: vi.fn(),
    update: vi.fn(),
    get_by_name: vi.fn(),
    test: vi.fn()
  }
}));

vi.mock('@/services/alert_templates', () => ({
  default: {
    create: vi.fn(),
    get_by_name: vi.fn()
  }
}));

// Mock the store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: 'test-org'
    }
  }
};

vi.mock('vuex', () => ({
  useStore: () => mockStore
}));

// Create a test component to use the composable
const TestComponent = defineComponent({
  setup() {
    return usePrebuiltDestinations();
  },
  template: '<div></div>'
});

describe('usePrebuiltDestinations', () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(TestComponent, {
      global: {
        plugins: [Quasar]
      }
    });
  });

  describe('availableTypes', () => {
    it('should return all prebuilt destination types', () => {
      const { availableTypes } = wrapper.vm;

      expect(availableTypes).toBeDefined();
      expect(Array.isArray(availableTypes)).toBe(true);
      expect(availableTypes.length).toBeGreaterThan(0);

      // Check for expected types
      const typeIds = availableTypes.map((t: any) => t.id);
      expect(typeIds).toContain('slack');
      expect(typeIds).toContain('msteams');
      expect(typeIds).toContain('email');
      expect(typeIds).toContain('pagerduty');
      expect(typeIds).toContain('servicenow');
      expect(typeIds).toContain('opsgenie');
    });

    it('should have proper structure for each type', () => {
      const { availableTypes } = wrapper.vm;

      availableTypes.forEach((type: any) => {
        expect(type).toHaveProperty('id');
        expect(type).toHaveProperty('name');
        expect(type).toHaveProperty('description');
        expect(type).toHaveProperty('icon');
        expect(type).toHaveProperty('category');
        expect(typeof type.popular).toBe('boolean');
      });
    });
  });

  describe('validateCredentials', () => {
    it('should validate slack credentials correctly', () => {
      const { validateCredentials } = wrapper.vm;

      // Valid credentials
      const validCredentials = {
        webhookUrl: 'https://hooks.slack.com/services/test/webhook/url'
      };

      const validResult = validateCredentials('slack', validCredentials);
      expect(validResult.isValid).toBe(true);
      expect(Object.keys(validResult.errors)).toHaveLength(0);

      // Invalid credentials
      const invalidCredentials = {
        webhookUrl: 'invalid-url'
      };

      const invalidResult = validateCredentials('slack', invalidCredentials);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors).toHaveProperty('webhookUrl');
    });

    it('should validate email credentials correctly', () => {
      const { validateCredentials } = wrapper.vm;

      // Valid email
      const validCredentials = {
        recipients: 'test@example.com,admin@example.com'
      };

      const validResult = validateCredentials('email', validCredentials);
      expect(validResult.isValid).toBe(true);

      // Invalid email
      const invalidCredentials = {
        recipients: 'invalid-email'
      };

      const invalidResult = validateCredentials('email', invalidCredentials);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors).toHaveProperty('recipients');
    });

    it('should require mandatory fields', () => {
      const { validateCredentials } = wrapper.vm;

      const emptyCredentials = {};
      const result = validateCredentials('slack', emptyCredentials);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveProperty('webhookUrl');
    });
  });

  describe('generatePreview', () => {
    it('should generate preview content for slack', () => {
      const { generatePreview } = wrapper.vm;

      const preview = generatePreview('slack');
      expect(preview).toBeDefined();
      expect(typeof preview).toBe('string');
      expect(preview.length).toBeGreaterThan(0);

      // Should contain sample data
      expect(preview).toContain('High CPU Usage');
      expect(preview).toContain('system-metrics');
    });

    it('should generate different previews for different types', () => {
      const { generatePreview } = wrapper.vm;

      const slackPreview = generatePreview('slack');
      const emailPreview = generatePreview('email');

      expect(slackPreview).not.toBe(emailPreview);
    });
  });

  describe('detectPrebuiltType', () => {
    it('should detect slack destinations', () => {
      const { detectPrebuiltType } = wrapper.vm;

      const slackDestination = {
        url: 'https://hooks.slack.com/services/test/webhook/url',
        metadata: { prebuilt_type: 'slack' }
      };

      const detectedType = detectPrebuiltType(slackDestination);
      expect(detectedType).toBe('slack');
    });

    it('should detect from URL patterns', () => {
      const { detectPrebuiltType } = wrapper.vm;

      const teamsDestination = {
        url: 'https://outlook.office.com/webhook/test'
      };

      const detectedType = detectPrebuiltType(teamsDestination);
      expect(detectedType).toBe('msteams');
    });

    it('should return null for custom destinations', () => {
      const { detectPrebuiltType } = wrapper.vm;

      const customDestination = {
        url: 'https://custom-webhook.example.com/webhook'
      };

      const detectedType = detectPrebuiltType(customDestination);
      expect(detectedType).toBeNull();
    });
  });

  describe('popularTypes', () => {
    it('should return only popular types', () => {
      const { popularTypes, availableTypes } = wrapper.vm;

      expect(Array.isArray(popularTypes)).toBe(true);
      expect(popularTypes.length).toBeLessThanOrEqual(availableTypes.length);

      // All popular types should have popular: true
      popularTypes.forEach((type: any) => {
        expect(type.popular).toBe(true);
      });
    });
  });

  describe('typesByCategory', () => {
    it('should group types by category', () => {
      const { typesByCategory } = wrapper.vm;

      expect(typesByCategory).toHaveProperty('messaging');
      expect(typesByCategory).toHaveProperty('incident');
      expect(typesByCategory).toHaveProperty('email');
      expect(typesByCategory).toHaveProperty('custom');

      expect(Array.isArray(typesByCategory.messaging)).toBe(true);
      expect(Array.isArray(typesByCategory.incident)).toBe(true);
      expect(Array.isArray(typesByCategory.email)).toBe(true);
    });

    it('should categorize types correctly', () => {
      const { typesByCategory } = wrapper.vm;

      const messagingTypes = typesByCategory.messaging.map((t: any) => t.id);
      const incidentTypes = typesByCategory.incident.map((t: any) => t.id);
      const emailTypes = typesByCategory.email.map((t: any) => t.id);

      expect(messagingTypes).toContain('slack');
      expect(messagingTypes).toContain('msteams');
      expect(incidentTypes).toContain('pagerduty');
      expect(incidentTypes).toContain('opsgenie');
      expect(emailTypes).toContain('email');
    });
  });
});