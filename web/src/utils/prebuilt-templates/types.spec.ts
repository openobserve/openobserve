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

import { describe, it, expect } from 'vitest';
import type {
  PrebuiltTypeId,
  CredentialField,
  PrebuiltConfig,
  PrebuiltType,
  PrebuiltFormData,
  ValidationResult,
  TestResult,
  PrebuiltTemplate,
  DestinationWithPrebuilt
} from '@/utils/prebuilt-templates/types';

describe('Prebuilt Templates Types', () => {
  describe('PrebuiltTypeId', () => {
    it('should allow valid prebuilt type IDs', () => {
      const validIds: PrebuiltTypeId[] = [
        'slack',
        'discord',
        'msteams',
        'pagerduty',
        'servicenow',
        'email',
        'opsgenie'
      ];

      validIds.forEach(id => {
        expect(typeof id).toBe('string');
      });
    });
  });

  describe('CredentialField', () => {
    it('should have required properties', () => {
      const field: CredentialField = {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true
      };

      expect(field).toHaveProperty('key');
      expect(field).toHaveProperty('label');
      expect(field).toHaveProperty('type');
      expect(field).toHaveProperty('required');
    });

    it('should support optional hint property', () => {
      const field: CredentialField = {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        hint: 'Enter your API key here'
      };

      expect(field.hint).toBe('Enter your API key here');
    });

    it('should support optional validator function', () => {
      const validator = (value: string) => value.length > 0 || 'Required';
      const field: CredentialField = {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        validator
      };

      expect(typeof field.validator).toBe('function');
      expect(field.validator?.('test')).toBe(true);
      expect(field.validator?.('')).toBe('Required');
    });

    it('should support select type with options', () => {
      const field: CredentialField = {
        key: 'priority',
        label: 'Priority',
        type: 'select',
        required: true,
        options: [
          { label: 'High', value: 'high' },
          { label: 'Medium', value: 'medium', description: 'Normal priority' },
          { label: 'Low', value: 'low' }
        ]
      };

      expect(field.options).toHaveLength(3);
      expect(field.options?.[1]).toHaveProperty('description');
    });
  });

  describe('PrebuiltConfig', () => {
    it('should have all required properties', () => {
      const config: PrebuiltConfig = {
        templateName: 'system-prebuilt-slack',
        templateBody: '{"text": "test"}',
        headers: { 'Content-Type': 'application/json' },
        method: 'post',
        urlValidator: (url: string) => {
          try {
            const parsed = new URL(url);
            const hostname = parsed.hostname.toLowerCase();
            return hostname === 'slack.com' || hostname.endsWith('.slack.com');
          } catch {
            return false;
          }
        },
        credentialFields: [
          {
            key: 'webhookUrl',
            label: 'Webhook URL',
            type: 'text',
            required: true
          }
        ]
      };

      expect(config.templateName).toBeTruthy();
      expect(config.templateBody).toBeTruthy();
      expect(config.headers).toBeDefined();
      expect(['get', 'post', 'put']).toContain(config.method);
      expect(typeof config.urlValidator).toBe('function');
      expect(Array.isArray(config.credentialFields)).toBe(true);
    });
  });

  describe('PrebuiltType', () => {
    it('should have all required properties', () => {
      const type: PrebuiltType = {
        id: 'slack',
        name: 'Slack',
        description: 'Send notifications to Slack',
        icon: 'slack',
        category: 'messaging'
      };

      expect(type.id).toBeTruthy();
      expect(type.name).toBeTruthy();
      expect(type.description).toBeTruthy();
      expect(type.icon).toBeTruthy();
      expect(['messaging', 'incident', 'email', 'custom']).toContain(type.category);
    });

    it('should support optional properties', () => {
      const type: PrebuiltType = {
        id: 'slack',
        name: 'Slack',
        description: 'Send notifications to Slack',
        icon: 'slack',
        image: '/path/to/slack-logo.png',
        popular: true,
        category: 'messaging'
      };

      expect(type.image).toBeTruthy();
      expect(type.popular).toBe(true);
    });
  });

  describe('PrebuiltFormData', () => {
    it('should have required name and credentials', () => {
      const formData: PrebuiltFormData = {
        name: 'my-slack-destination',
        credentials: {
          webhookUrl: 'https://hooks.slack.com/services/xxx'
        }
      };

      expect(formData.name).toBeTruthy();
      expect(typeof formData.credentials).toBe('object');
    });

    it('should support advanced mode flag', () => {
      const formData: PrebuiltFormData = {
        name: 'my-destination',
        credentials: {},
        advancedMode: true
      };

      expect(formData.advancedMode).toBe(true);
    });
  });

  describe('ValidationResult', () => {
    it('should indicate validation success', () => {
      const result: ValidationResult = {
        isValid: true,
        errors: {}
      };

      expect(result.isValid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });

    it('should contain field-specific errors', () => {
      const result: ValidationResult = {
        isValid: false,
        errors: {
          webhookUrl: 'Invalid URL format',
          apiKey: 'Required field'
        }
      };

      expect(result.isValid).toBe(false);
      expect(Object.keys(result.errors)).toHaveLength(2);
      expect(result.errors.webhookUrl).toBeTruthy();
    });
  });

  describe('TestResult', () => {
    it('should indicate successful test', () => {
      const result: TestResult = {
        success: true,
        timestamp: Date.now(),
        statusCode: 200
      };

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.timestamp).toBeTruthy();
    });

    it('should include error information for failed test', () => {
      const result: TestResult = {
        success: false,
        timestamp: Date.now(),
        error: 'Connection timeout',
        statusCode: 408,
        responseBody: '{"error": "timeout"}'
      };

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.responseBody).toBeTruthy();
    });
  });

  describe('PrebuiltTemplate', () => {
    it('should have required properties', () => {
      const template: PrebuiltTemplate = {
        name: 'system-prebuilt-slack',
        body: '{"text": "Alert fired"}',
        type: 'http',
        isDefault: false
      };

      expect(template.name).toBeTruthy();
      expect(template.body).toBeTruthy();
      expect(['http', 'email']).toContain(template.type);
      expect(typeof template.isDefault).toBe('boolean');
    });
  });

  describe('DestinationWithPrebuilt', () => {
    it('should have all required destination properties', () => {
      const destination: DestinationWithPrebuilt = {
        name: 'my-destination',
        type: 'http',
        url: 'https://example.com/webhook',
        method: 'post',
        skip_tls_verify: false,
        template: 'system-prebuilt-slack',
        headers: { 'Content-Type': 'application/json' },
        emails: '',
        action_id: '',
        output_format: 'json'
      };

      expect(destination.name).toBeTruthy();
      expect(['http', 'email', 'action']).toContain(destination.type);
      expect(['get', 'post', 'put']).toContain(destination.method);
      expect(['json', 'ndjson']).toContain(destination.output_format);
    });

    it('should support prebuilt metadata', () => {
      const destination: DestinationWithPrebuilt = {
        name: 'my-slack',
        type: 'http',
        url: 'https://hooks.slack.com/services/xxx',
        method: 'post',
        skip_tls_verify: false,
        template: 'system-prebuilt-slack',
        headers: {},
        emails: '',
        action_id: '',
        output_format: 'json',
        metadata: {
          prebuilt_type: 'slack',
          credential_webhookUrl: 'https://hooks.slack.com/services/xxx'
        }
      };

      expect(destination.metadata).toBeDefined();
      expect(destination.metadata?.prebuilt_type).toBe('slack');
    });
  });
});
