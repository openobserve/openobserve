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
import { Quasar, QBanner, QIcon, QBtn, QExpansionItem, QSpinner } from 'quasar';
import DestinationTestResult from '@/components/alerts/DestinationTestResult.vue';
import type { TestResult } from '@/utils/prebuilt-templates/types';

const quasarConfig = {
  components: {
    QBanner,
    QIcon,
    QBtn,
    QExpansionItem,
    QSpinner
  }
};

// Mock the i18n composable
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}));

// Mock quasar date utility
vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    date: {
      formatDate: (date: Date, format: string) => 'Jan 16, 14:30:00'
    }
  };
});

describe('DestinationTestResult', () => {
  const createWrapper = (props = {}) => {
    return mount(DestinationTestResult, {
      props: {
        result: null,
        isLoading: false,
        ...props
      },
      global: {
        plugins: [[Quasar, quasarConfig]]
      }
    });
  };

  it('shows idle state by default', () => {
    const wrapper = createWrapper();

    expect(wrapper.find('[data-test="test-result-idle"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('alerts.testIdleMessage');
  });

  it('shows loading state when testing', () => {
    const wrapper = createWrapper({ isLoading: true });

    expect(wrapper.find('[data-test="test-result-loading"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('alerts.testInProgress');
    expect(wrapper.findComponent(QSpinner).exists()).toBe(true);
  });

  it('shows success state for successful test', () => {
    const successResult: TestResult = {
      success: true,
      statusCode: 200,
      timestamp: Date.now(),
      responseTime: 150
    };

    const wrapper = createWrapper({ result: successResult });

    expect(wrapper.find('[data-test="test-result-success"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="test-success-message"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="test-success-timestamp"]').exists()).toBe(true);

    // Should show status code and response time
    expect(wrapper.text()).toContain('200');
    expect(wrapper.text()).toContain('150ms');
  });

  it('shows failure state for failed test', () => {
    const failureResult: TestResult = {
      success: false,
      statusCode: 404,
      error: 'Not Found',
      timestamp: Date.now()
    };

    const wrapper = createWrapper({ result: failureResult });

    expect(wrapper.find('[data-test="test-result-failure"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="test-failure-message"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="test-retry-button"]').exists()).toBe(true);
  });

  it('shows error details when available', () => {
    const failureResult: TestResult = {
      success: false,
      statusCode: 500,
      error: 'Internal Server Error',
      responseBody: '{"error": "Something went wrong"}',
      timestamp: Date.now()
    };

    const wrapper = createWrapper({ result: failureResult });

    expect(wrapper.find('[data-test="test-failure-details-expansion"]').exists()).toBe(true);

    // Check that details container exists (even if collapsed)
    expect(wrapper.find('[data-test="test-failure-details"]').exists()).toBe(true);
  });

  it('emits retry event when retry button is clicked', async () => {
    const failureResult: TestResult = {
      success: false,
      error: 'Connection failed',
      timestamp: Date.now()
    };

    const wrapper = createWrapper({ result: failureResult });

    await wrapper.find('[data-test="test-retry-button"]').trigger('click');

    expect(wrapper.emitted('retry')).toBeTruthy();
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('formats timestamp correctly', () => {
    const wrapper = createWrapper();
    const component = wrapper.vm;

    const timestamp = new Date('2026-01-16T14:30:00Z').getTime();
    expect(component.formatTimestamp(timestamp)).toBe('Jan 16, 14:30:00');
  });

  it('formats JSON response body', () => {
    const wrapper = createWrapper();
    const component = wrapper.vm;

    const jsonBody = '{"error":"Not found","code":404}';
    const formatted = component.formatResponseBody(jsonBody);

    expect(formatted).toContain('{\n');
    expect(formatted).toContain('  "error": "Not found"');
  });

  it('returns plain text for non-JSON response body', () => {
    const wrapper = createWrapper();
    const component = wrapper.vm;

    const plainBody = 'Plain text error';
    const formatted = component.formatResponseBody(plainBody);

    expect(formatted).toBe('Plain text error');
  });

  describe('error messages', () => {
    it('shows DNS error message for ENOTFOUND', () => {
      const wrapper = createWrapper();
      const component = wrapper.vm;

      const result: TestResult = {
        success: false,
        error: 'getaddrinfo ENOTFOUND example.com'
      };

      expect(component.getFailureMessage(result)).toBe('alerts.testErrorDNS');
    });

    it('shows connection error for ECONNREFUSED', () => {
      const wrapper = createWrapper();
      const component = wrapper.vm;

      const result: TestResult = {
        success: false,
        error: 'connect ECONNREFUSED 127.0.0.1:8080'
      };

      expect(component.getFailureMessage(result)).toBe('alerts.testErrorConnection');
    });

    it('shows client error for 4xx status codes', () => {
      const wrapper = createWrapper();
      const component = wrapper.vm;

      const result: TestResult = {
        success: false,
        statusCode: 401
      };

      expect(component.getFailureMessage(result)).toBe('alerts.testErrorClientError');
    });
  });

  describe('suggested fixes', () => {
    it('suggests checking URL for ENOTFOUND error', () => {
      const wrapper = createWrapper();
      const component = wrapper.vm;

      const result: TestResult = {
        success: false,
        error: 'getaddrinfo ENOTFOUND example.com'
      };

      expect(component.getSuggestedFix(result)).toBe('alerts.suggestCheckUrl');
    });

    it('suggests checking credentials for 401 error', () => {
      const wrapper = createWrapper();
      const component = wrapper.vm;

      const result: TestResult = {
        success: false,
        statusCode: 401
      };

      expect(component.getSuggestedFix(result)).toBe('alerts.suggestCheckCredentials');
    });

    it('returns null for unknown errors', () => {
      const wrapper = createWrapper();
      const component = wrapper.vm;

      const result: TestResult = {
        success: false,
        statusCode: 200 // Success code but marked as failure
      };

      expect(component.getSuggestedFix(result)).toBe(null);
    });
  });
});