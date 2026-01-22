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
import { pagerdutyTemplate, pagerdutyConfig, pagerdutyDestinationType } from '@/utils/prebuilt-templates/pagerduty';

describe('pagerduty template', () => {
  describe('pagerdutyTemplate', () => {
    it('has correct name', () => {
      expect(pagerdutyTemplate.name).toBe('system-prebuilt-pagerduty');
    });

    it('has type as http', () => {
      expect(pagerdutyTemplate.type).toBe('http');
    });

    it('is not default', () => {
      expect(pagerdutyTemplate.isDefault).toBe(false);
    });

    it('has valid JSON body', () => {
      expect(() => JSON.parse(pagerdutyTemplate.body)).not.toThrow();
    });

    it('body contains PagerDuty event structure', () => {
      const body = JSON.parse(pagerdutyTemplate.body);
      expect(body).toHaveProperty('event_action');
      expect(body).toHaveProperty('payload');
    });

    it('body contains severity field', () => {
      const body = JSON.parse(pagerdutyTemplate.body);
      expect(body.payload).toHaveProperty('severity');
    });
  });

  describe('pagerdutyConfig', () => {
    it('references correct template name', () => {
      expect(pagerdutyConfig.templateName).toBe('system-prebuilt-pagerduty');
    });

    it('has correct headers', () => {
      expect(pagerdutyConfig.headers).toHaveProperty('Content-Type');
      expect(pagerdutyConfig.headers['Content-Type']).toBe('application/json');
    });

    it('uses POST method', () => {
      expect(pagerdutyConfig.method).toBe('post');
    });

    it('has URL validator', () => {
      expect(typeof pagerdutyConfig.urlValidator).toBe('function');
    });

    it('validates PagerDuty URLs', () => {
      expect(pagerdutyConfig.urlValidator('https://events.pagerduty.com/v2/enqueue')).toBe(true);
      expect(pagerdutyConfig.urlValidator('https://example.com')).toBe(false);
      expect(pagerdutyConfig.urlValidator('https://events.pagerduty.com/v2/other')).toBe(false);
      expect(pagerdutyConfig.urlValidator('invalid-url')).toBe(false);
    });

    it('integration key validator validates key length', () => {
      const integrationKeyField = pagerdutyConfig.credentialFields.find(f => f.key === 'integrationKey');
      const validator = integrationKeyField?.validator;
      expect(typeof validator).toBe('function');

      if (validator) {
        // Valid key (32 characters)
        expect(validator('12345678901234567890123456789012')).toBe(true);

        // Invalid keys
        expect(validator('short')).not.toBe(true);
        expect(validator('123456789012345678901234567890')).not.toBe(true);
      }
    });

    it('has routing key field', () => {
      const routingKeyField = pagerdutyConfig.credentialFields.find(f => f.key === 'integrationKey');
      expect(routingKeyField).toBeDefined();
      expect(routingKeyField?.required).toBe(true);
      expect(routingKeyField?.type).toBe('password');
    });

    it('has severity field', () => {
      const severityField = pagerdutyConfig.credentialFields.find(f => f.key === 'severity');
      expect(severityField).toBeDefined();
      expect(severityField?.type).toBe('select');
      expect(severityField?.options).toBeDefined();
    });
  });

  describe('pagerdutyDestinationType', () => {
    it('has correct ID', () => {
      expect(pagerdutyDestinationType.id).toBe('pagerduty');
    });

    it('has display name', () => {
      expect(pagerdutyDestinationType.name).toBe('PagerDuty');
    });

    it('has correct category', () => {
      expect(pagerdutyDestinationType.category).toBe('incident');
    });

    it('is marked as popular', () => {
      expect(pagerdutyDestinationType.popular).toBe(true);
    });
  });
});
