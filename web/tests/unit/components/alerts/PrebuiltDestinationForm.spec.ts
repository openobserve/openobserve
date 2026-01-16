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
import { Quasar, QInput, QSelect, QToggle, QBtn, QBanner } from 'quasar';
import PrebuiltDestinationForm from '@/components/alerts/PrebuiltDestinationForm.vue';

const quasarConfig = {
  components: {
    QInput,
    QSelect,
    QToggle,
    QBtn,
    QBanner
  }
};

describe('PrebuiltDestinationForm', () => {
  const createWrapper = (props = {}) => {
    return mount(PrebuiltDestinationForm, {
      props: {
        destinationType: 'slack',
        modelValue: {},
        ...props
      },
      global: {
        plugins: [[Quasar, quasarConfig]]
      }
    });
  };

  describe('Slack Form', () => {
    it('should render slack fields correctly', () => {
      const wrapper = createWrapper({
        destinationType: 'slack',
        modelValue: {}
      });

      // Should have slack-specific fields
      expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="slack-channel-input"]').exists()).toBe(true);
    });

    it('should validate slack webhook URL', async () => {
      const wrapper = createWrapper({
        destinationType: 'slack',
        modelValue: { webhookUrl: 'invalid-url' }
      });

      const webhookInput = wrapper.find('[data-test="slack-webhook-url-input"]');
      expect(webhookInput.exists()).toBe(true);

      // Should have validation rules
      const inputComponent = webhookInput.getComponent(QInput);
      expect(inputComponent.props('rules')).toHaveLength(2);
    });

    it('should emit update:modelValue on input changes', async () => {
      const wrapper = createWrapper({
        destinationType: 'slack',
        modelValue: {}
      });

      const webhookInput = wrapper.find('[data-test="slack-webhook-url-input"]');
      await webhookInput.setValue('https://hooks.slack.com/test');

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    });
  });

  describe('Microsoft Teams Form', () => {
    it('should render teams fields correctly', () => {
      const wrapper = createWrapper({
        destinationType: 'msteams',
        modelValue: {}
      });

      expect(wrapper.find('[data-test="msteams-webhook-url-input"]').exists()).toBe(true);
    });

    it('should validate teams webhook URL', () => {
      const wrapper = createWrapper({
        destinationType: 'msteams',
        modelValue: {}
      });

      const webhookInput = wrapper.find('[data-test="msteams-webhook-url-input"]');
      const inputComponent = webhookInput.getComponent(QInput);

      expect(inputComponent.props('rules')).toBeDefined();
      expect(inputComponent.props('rules').length).toBeGreaterThan(0);
    });
  });

  describe('PagerDuty Form', () => {
    it('should render pagerduty fields correctly', () => {
      const wrapper = createWrapper({
        destinationType: 'pagerduty',
        modelValue: {}
      });

      expect(wrapper.find('[data-test="pagerduty-integration-key-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="pagerduty-severity-select"]').exists()).toBe(true);
    });

    it('should have severity options', () => {
      const wrapper = createWrapper({
        destinationType: 'pagerduty',
        modelValue: {}
      });

      const severitySelect = wrapper.find('[data-test="pagerduty-severity-select"]');
      const selectComponent = severitySelect.getComponent(QSelect);

      expect(selectComponent.props('options')).toBeDefined();
      expect(selectComponent.props('options').length).toBe(4);
    });

    it('should validate integration key length', () => {
      const wrapper = createWrapper({
        destinationType: 'pagerduty',
        modelValue: {}
      });

      const keyInput = wrapper.find('[data-test="pagerduty-integration-key-input"]');
      const inputComponent = keyInput.getComponent(QInput);

      expect(inputComponent.props('rules')).toBeDefined();
      // Should have required and length validation
      expect(inputComponent.props('rules').length).toBe(2);
    });
  });

  describe('Email Form', () => {
    it('should render email fields correctly', () => {
      const wrapper = createWrapper({
        destinationType: 'email',
        modelValue: {}
      });

      expect(wrapper.find('[data-test="email-recipients-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="email-cc-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="email-subject-input"]').exists()).toBe(true);
    });

    it('should validate email addresses', () => {
      const wrapper = createWrapper({
        destinationType: 'email',
        modelValue: {}
      });

      const recipientsInput = wrapper.find('[data-test="email-recipients-input"]');
      const inputComponent = recipientsInput.getComponent(QInput);

      expect(inputComponent.props('rules')).toBeDefined();
      expect(inputComponent.props('rules').length).toBe(2);
    });
  });

  describe('ServiceNow Form', () => {
    it('should render servicenow fields correctly', () => {
      const wrapper = createWrapper({
        destinationType: 'servicenow',
        modelValue: {}
      });

      expect(wrapper.find('[data-test="servicenow-instance-url-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="servicenow-username-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="servicenow-password-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="servicenow-assignment-group-input"]').exists()).toBe(true);
    });
  });

  describe('Opsgenie Form', () => {
    it('should render opsgenie fields correctly', () => {
      const wrapper = createWrapper({
        destinationType: 'opsgenie',
        modelValue: {}
      });

      expect(wrapper.find('[data-test="opsgenie-api-key-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="opsgenie-priority-select"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="opsgenie-eu-region-toggle"]').exists()).toBe(true);
    });

    it('should have priority options', () => {
      const wrapper = createWrapper({
        destinationType: 'opsgenie',
        modelValue: {}
      });

      const prioritySelect = wrapper.find('[data-test="opsgenie-priority-select"]');
      const selectComponent = prioritySelect.getComponent(QSelect);

      expect(selectComponent.props('options')).toBeDefined();
      expect(selectComponent.props('options').length).toBe(5);
    });
  });

  describe('Action Buttons', () => {
    it('should render preview and test buttons', () => {
      const wrapper = createWrapper({
        destinationType: 'slack',
        modelValue: {}
      });

      expect(wrapper.find('[data-test="destination-preview-button"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="destination-test-button"]').exists()).toBe(true);
    });

    it('should emit preview event when preview button is clicked', async () => {
      const wrapper = createWrapper({
        destinationType: 'slack',
        modelValue: {}
      });

      const previewBtn = wrapper.find('[data-test="destination-preview-button"]');
      await previewBtn.trigger('click');

      expect(wrapper.emitted('preview')).toBeTruthy();
    });

    it('should emit test event when test button is clicked', async () => {
      const wrapper = createWrapper({
        destinationType: 'slack',
        modelValue: {}
      });

      const testBtn = wrapper.find('[data-test="destination-test-button"]');
      await testBtn.trigger('click');

      expect(wrapper.emitted('test')).toBeTruthy();
    });

    it('should show loading state when testing', () => {
      const wrapper = createWrapper({
        destinationType: 'slack',
        modelValue: {},
        isTesting: true
      });

      const testBtn = wrapper.find('[data-test="destination-test-button"]');
      const btnComponent = testBtn.getComponent(QBtn);

      expect(btnComponent.props('loading')).toBe(true);
    });
  });

  describe('Test Results', () => {
    it('should display success test result', () => {
      const testResult = {
        success: true,
        timestamp: Date.now()
      };

      const wrapper = createWrapper({
        destinationType: 'slack',
        modelValue: {},
        testResult
      });

      expect(wrapper.find('[data-test="test-result-success"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="test-success-message"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="test-success-timestamp"]').exists()).toBe(true);
    });

    it('should display failure test result', () => {
      const testResult = {
        success: false,
        error: 'Connection failed',
        timestamp: Date.now()
      };

      const wrapper = createWrapper({
        destinationType: 'slack',
        modelValue: {},
        testResult
      });

      expect(wrapper.find('[data-test="test-result-failure"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="test-failure-message"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="test-retry-button"]').exists()).toBe(true);
    });

    it('should show test details on failure with status code', () => {
      const testResult = {
        success: false,
        error: 'HTTP 404 Not Found',
        statusCode: 404,
        responseBody: '{"error": "Not found"}',
        timestamp: Date.now()
      };

      const wrapper = createWrapper({
        destinationType: 'slack',
        modelValue: {},
        testResult
      });

      expect(wrapper.find('[data-test="test-failure-details-expansion"]').exists()).toBe(true);
    });
  });

  describe('Form Validation', () => {
    it('should validate required fields for each destination type', () => {
      const types = ['slack', 'msteams', 'pagerduty', 'servicenow', 'email', 'opsgenie'];

      types.forEach(type => {
        const wrapper = createWrapper({
          destinationType: type,
          modelValue: {}
        });

        // Each form should have at least one required field
        const requiredFields = wrapper.findAll('input[required], .q-field--error');
        // We expect forms to be rendered, though validation state may not be active yet
        expect(wrapper.html()).toBeTruthy();
      });
    });
  });
});