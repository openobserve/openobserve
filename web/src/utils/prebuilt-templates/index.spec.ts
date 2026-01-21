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
import {
  PREBUILT_DESTINATION_TYPES,
  PREBUILT_CONFIGS,
  getPrebuiltConfig,
  isPrebuiltType,
  detectPrebuiltTypeFromUrl,
  generateDestinationUrl,
  generateDestinationHeaders,
  getPopularPrebuiltTypes,
  getPrebuiltTypesByCategory
} from '@/utils/prebuilt-templates';

describe('Prebuilt Templates Index', () => {
  describe('PREBUILT_DESTINATION_TYPES', () => {
    it('should contain all expected destination types', () => {
      const expectedTypes = ['slack', 'discord', 'msteams', 'pagerduty', 'servicenow', 'email', 'opsgenie'];

      expect(PREBUILT_DESTINATION_TYPES).toHaveLength(7);

      const actualTypes = PREBUILT_DESTINATION_TYPES.map(type => type.id);
      expectedTypes.forEach(expectedType => {
        expect(actualTypes).toContain(expectedType);
      });
    });

    it('should have proper structure for each type', () => {
      PREBUILT_DESTINATION_TYPES.forEach(type => {
        expect(type).toHaveProperty('id');
        expect(type).toHaveProperty('name');
        expect(type).toHaveProperty('description');
        expect(type).toHaveProperty('icon');
        expect(type).toHaveProperty('category');
        expect(typeof type.popular).toBe('boolean');
        expect(typeof type.name).toBe('string');
        expect(typeof type.description).toBe('string');
        expect(['messaging', 'incident', 'email', 'custom']).toContain(type.category);
      });
    });
  });

  describe('PREBUILT_CONFIGS', () => {
    it('should have configs for all destination types', () => {
      const configTypes = Object.keys(PREBUILT_CONFIGS);
      const destinationTypes = PREBUILT_DESTINATION_TYPES.map(type => type.id);

      destinationTypes.forEach(type => {
        expect(configTypes).toContain(type);
      });
    });

    it('should have proper structure for each config', () => {
      Object.values(PREBUILT_CONFIGS).forEach(config => {
        expect(config).toHaveProperty('templateName');
        expect(config).toHaveProperty('templateBody');
        expect(config).toHaveProperty('headers');
        expect(config).toHaveProperty('method');
        expect(config).toHaveProperty('urlValidator');
        expect(config).toHaveProperty('credentialFields');

        expect(typeof config.templateName).toBe('string');
        expect(typeof config.templateBody).toBe('string');
        expect(typeof config.headers).toBe('object');
        expect(['get', 'post', 'put']).toContain(config.method);
        expect(typeof config.urlValidator).toBe('function');
        expect(Array.isArray(config.credentialFields)).toBe(true);
      });
    });
  });

  describe('getPrebuiltConfig', () => {
    it('should return config for valid types', () => {
      const slackConfig = getPrebuiltConfig('slack');
      expect(slackConfig).toBeDefined();
      expect(slackConfig?.templateName).toBe('system-prebuilt-slack');
    });

    it('should return null for invalid types', () => {
      const invalidConfig = getPrebuiltConfig('invalid-type');
      expect(invalidConfig).toBeNull();
    });

    it('should return different configs for different types', () => {
      const slackConfig = getPrebuiltConfig('slack');
      const teamsConfig = getPrebuiltConfig('msteams');

      expect(slackConfig).not.toEqual(teamsConfig);
      expect(slackConfig?.templateName).not.toBe(teamsConfig?.templateName);
    });
  });

  describe('isPrebuiltType', () => {
    it('should return true for valid prebuilt types', () => {
      expect(isPrebuiltType('slack')).toBe(true);
      expect(isPrebuiltType('msteams')).toBe(true);
      expect(isPrebuiltType('email')).toBe(true);
    });

    it('should return false for invalid types', () => {
      expect(isPrebuiltType('custom')).toBe(false);
      expect(isPrebuiltType('invalid')).toBe(false);
      expect(isPrebuiltType('')).toBe(false);
    });
  });

  describe('detectPrebuiltTypeFromUrl', () => {
    it('should detect Slack URLs', () => {
      const slackUrl = 'https://hooks.slack.com/services/T1234/B5678/xyz';
      expect(detectPrebuiltTypeFromUrl(slackUrl)).toBe('slack');
    });

    it('should detect Microsoft Teams URLs', () => {
      const teamsUrl = 'https://outlook.office.com/webhook/abc/IncomingWebhook/def';
      expect(detectPrebuiltTypeFromUrl(teamsUrl)).toBe('msteams');

      const teamsUrl2 = 'https://webhook.office.com/webhookb2/abc';
      expect(detectPrebuiltTypeFromUrl(teamsUrl2)).toBe('msteams');
    });

    it('should detect PagerDuty URLs', () => {
      const pagerdutyUrl = 'https://events.pagerduty.com/v2/enqueue';
      expect(detectPrebuiltTypeFromUrl(pagerdutyUrl)).toBe('pagerduty');
    });

    it('should detect ServiceNow URLs', () => {
      const servicenowUrl = 'https://dev123.service-now.com/api/now/table/incident';
      expect(detectPrebuiltTypeFromUrl(servicenowUrl)).toBe('servicenow');
    });

    it('should detect Opsgenie URLs', () => {
      const opsgenieUrl = 'https://api.opsgenie.com/v2/alerts';
      expect(detectPrebuiltTypeFromUrl(opsgenieUrl)).toBe('opsgenie');

      const opsgenieEuUrl = 'https://api.eu.opsgenie.com/v2/alerts';
      expect(detectPrebuiltTypeFromUrl(opsgenieEuUrl)).toBe('opsgenie');
    });

    it('should detect Discord URLs', () => {
      const discordUrl = 'https://discord.com/api/webhooks/123456789/abcdef';
      expect(detectPrebuiltTypeFromUrl(discordUrl)).toBe('discord');
    });

    it('should return null for custom URLs', () => {
      const customUrl = 'https://custom-webhook.example.com/webhook';
      expect(detectPrebuiltTypeFromUrl(customUrl)).toBeNull();
    });

    it('should return null for invalid URLs', () => {
      expect(detectPrebuiltTypeFromUrl('not-a-url')).toBeNull();
      expect(detectPrebuiltTypeFromUrl('')).toBeNull();
    });
  });

  describe('generateDestinationUrl', () => {
    it('should generate correct URLs for different types', () => {
      const slackCredentials = { webhookUrl: 'https://hooks.slack.com/test' };
      expect(generateDestinationUrl('slack', slackCredentials)).toBe('https://hooks.slack.com/test');

      const pagerdutyCredentials = {};
      expect(generateDestinationUrl('pagerduty', pagerdutyCredentials)).toBe('https://events.pagerduty.com/v2/enqueue');

      const opsgenieCredentials = { euRegion: true };
      expect(generateDestinationUrl('opsgenie', opsgenieCredentials)).toBe('https://api.eu.opsgenie.com/v2/alerts');

      const opsgenieCredentialsUs = { euRegion: false };
      expect(generateDestinationUrl('opsgenie', opsgenieCredentialsUs)).toBe('https://api.opsgenie.com/v2/alerts');
    });

    it('should return empty string for email type', () => {
      expect(generateDestinationUrl('email', {})).toBe('');
    });

    it('should return empty string for unknown types', () => {
      expect(generateDestinationUrl('unknown', {})).toBe('');
    });

    it('should handle null credentials gracefully', () => {
      // @ts-ignore - testing error handling
      expect(generateDestinationUrl('slack', null)).toBe('');
    });

    it('should generate URLs for all webhook types', () => {
      expect(generateDestinationUrl('discord', { webhookUrl: 'https://discord.com/api/webhooks/123/abc' })).toBe('https://discord.com/api/webhooks/123/abc');
      expect(generateDestinationUrl('msteams', { webhookUrl: 'https://outlook.office.com/webhook/xxx' })).toBe('https://outlook.office.com/webhook/xxx');
      expect(generateDestinationUrl('servicenow', { instanceUrl: 'https://dev.service-now.com/api/now/table/incident' })).toBe('https://dev.service-now.com/api/now/table/incident');
    });
  });

  describe('generateDestinationHeaders', () => {
    it('should generate headers for Opsgenie', () => {
      const credentials = { apiKey: 'test-api-key' };
      const headers = generateDestinationHeaders('opsgenie', credentials);

      expect(headers).toHaveProperty('Authorization');
      expect(headers.Authorization).toBe('GenieKey test-api-key');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should generate headers for ServiceNow', () => {
      const credentials = { username: 'admin', password: 'secret' };
      const headers = generateDestinationHeaders('servicenow', credentials);

      // ServiceNow credentials are passed separately to backend for secure handling
      // Frontend should not encode credentials
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Accept']).toBe('application/json');
    });

    it('should generate headers for PagerDuty', () => {
      const credentials = { integrationKey: 'test-integration-key-12345678' };
      const headers = generateDestinationHeaders('pagerduty', credentials);

      expect(headers).toHaveProperty('X-Routing-Key');
      expect(headers['X-Routing-Key']).toBe('test-integration-key-12345678');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should include base headers for all types', () => {
      const credentials = {};
      const slackHeaders = generateDestinationHeaders('slack', credentials);

      expect(slackHeaders['Content-Type']).toBe('application/json');
    });

    it('should return empty object for unknown types', () => {
      const headers = generateDestinationHeaders('unknown', {});
      expect(headers).toEqual({});
    });

    it('should not mutate original config headers', () => {
      const credentials = { apiKey: 'test-key' };
      const headers1 = generateDestinationHeaders('opsgenie', credentials);
      const headers2 = generateDestinationHeaders('opsgenie', { apiKey: 'different-key' });

      expect(headers1.Authorization).not.toBe(headers2.Authorization);
    });
  });

  describe('getPopularPrebuiltTypes', () => {
    it('should return only popular types', () => {
      const popularTypes = getPopularPrebuiltTypes();

      expect(Array.isArray(popularTypes)).toBe(true);
      popularTypes.forEach(type => {
        expect(type.popular).toBe(true);
      });
    });

    it('should include expected popular types', () => {
      const popularTypes = getPopularPrebuiltTypes();
      const popularIds = popularTypes.map(type => type.id);

      // Slack, Discord, Teams, Email should be popular
      expect(popularIds).toContain('slack');
      expect(popularIds).toContain('discord');
      expect(popularIds).toContain('msteams');
      expect(popularIds).toContain('email');
      expect(popularIds).toContain('pagerduty');
    });
  });

  describe('getPrebuiltTypesByCategory', () => {
    it('should group types by category', () => {
      const typesByCategory = getPrebuiltTypesByCategory();

      expect(typesByCategory).toHaveProperty('messaging');
      expect(typesByCategory).toHaveProperty('incident');
      expect(typesByCategory).toHaveProperty('email');
      expect(typesByCategory).toHaveProperty('custom');

      expect(Array.isArray(typesByCategory.messaging)).toBe(true);
      expect(Array.isArray(typesByCategory.incident)).toBe(true);
      expect(Array.isArray(typesByCategory.email)).toBe(true);
      expect(Array.isArray(typesByCategory.custom)).toBe(true);
    });

    it('should categorize types correctly', () => {
      const typesByCategory = getPrebuiltTypesByCategory();

      const messagingIds = typesByCategory.messaging.map(t => t.id);
      const incidentIds = typesByCategory.incident.map(t => t.id);
      const emailIds = typesByCategory.email.map(t => t.id);

      expect(messagingIds).toContain('slack');
      expect(messagingIds).toContain('discord');
      expect(messagingIds).toContain('msteams');
      expect(incidentIds).toContain('pagerduty');
      expect(incidentIds).toContain('opsgenie');
      expect(incidentIds).toContain('servicenow');
      expect(emailIds).toContain('email');
    });
  });

  describe('Template Content', () => {
    it('should have valid JSON templates for HTTP types', () => {
      const httpTypes = ['slack', 'msteams', 'pagerduty', 'servicenow', 'opsgenie'];

      httpTypes.forEach(type => {
        const config = getPrebuiltConfig(type);
        expect(config).toBeDefined();

        // Should be parseable JSON
        expect(() => JSON.parse(config!.templateBody)).not.toThrow();
      });
    });

    it('should have HTML template for email type', () => {
      const emailConfig = getPrebuiltConfig('email');
      expect(emailConfig).toBeDefined();

      // Should contain HTML
      expect(emailConfig!.templateBody).toContain('<!DOCTYPE html>');
      expect(emailConfig!.templateBody).toContain('<html>');
      expect(emailConfig!.templateBody).toContain('</html>');
    });

    it('should contain placeholder variables', () => {
      Object.values(PREBUILT_CONFIGS).forEach(config => {
        const template = config.templateBody;

        // Should contain at least one placeholder
        expect(template).toMatch(/\{[^}]+\}/);

        // Common placeholders that should be in most templates
        const commonPlaceholders = ['{alert_name}', '{stream_name}', '{alert_count}'];
        const hasCommonPlaceholder = commonPlaceholders.some(placeholder =>
          template.includes(placeholder)
        );
        expect(hasCommonPlaceholder).toBe(true);
      });
    });
  });

  describe('Credential Field Validation', () => {
    it('should have proper credential field structure', () => {
      Object.values(PREBUILT_CONFIGS).forEach(config => {
        config.credentialFields.forEach(field => {
          expect(field).toHaveProperty('key');
          expect(field).toHaveProperty('label');
          expect(field).toHaveProperty('type');
          expect(field).toHaveProperty('required');

          expect(typeof field.key).toBe('string');
          expect(typeof field.label).toBe('string');
          expect(['text', 'password', 'email', 'select', 'toggle']).toContain(field.type);
          expect(typeof field.required).toBe('boolean');
        });
      });
    });

    it('should have at least one required field per type', () => {
      Object.values(PREBUILT_CONFIGS).forEach(config => {
        const requiredFields = config.credentialFields.filter(field => field.required);
        expect(requiredFields.length).toBeGreaterThan(0);
      });
    });

    it('should have validators for required fields', () => {
      Object.values(PREBUILT_CONFIGS).forEach(config => {
        config.credentialFields.forEach(field => {
          if (field.required) {
            // Required fields should have some validation
            expect(field.validator || field.type === 'select').toBeTruthy();
          }
        });
      });
    });
  });
});