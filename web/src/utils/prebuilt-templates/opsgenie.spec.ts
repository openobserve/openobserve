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
import { opsgenieTemplate, opsgenieConfig, opsgenieDestinationType } from '@/utils/prebuilt-templates/opsgenie';

describe('opsgenie template', () => {
  describe('opsgenieTemplate', () => {
    it('has correct name', () => {
      expect(opsgenieTemplate.name).toBe('system-prebuilt-opsgenie');
    });

    it('has type as http', () => {
      expect(opsgenieTemplate.type).toBe('http');
    });

    it('is not default', () => {
      expect(opsgenieTemplate.isDefault).toBe(false);
    });

    it('has valid JSON body', () => {
      expect(() => JSON.parse(opsgenieTemplate.body)).not.toThrow();
    });

    it('body contains alert fields', () => {
      const body = JSON.parse(opsgenieTemplate.body);
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('description');
      expect(body).toHaveProperty('priority');
    });
  });

  describe('opsgenieConfig', () => {
    it('references correct template name', () => {
      expect(opsgenieConfig.templateName).toBe('system-prebuilt-opsgenie');
    });

    it('has correct headers', () => {
      expect(opsgenieConfig.headers).toHaveProperty('Content-Type');
      expect(opsgenieConfig.headers['Content-Type']).toBe('application/json');
    });

    it('uses POST method', () => {
      expect(opsgenieConfig.method).toBe('post');
    });

    it('has URL validator', () => {
      expect(typeof opsgenieConfig.urlValidator).toBe('function');
    });

    it('validates Opsgenie URLs', () => {
      expect(opsgenieConfig.urlValidator('https://api.opsgenie.com/v2/alerts')).toBe(true);
      expect(opsgenieConfig.urlValidator('https://api.eu.opsgenie.com/v2/alerts')).toBe(true);
      expect(opsgenieConfig.urlValidator('https://example.com')).toBe(false);
      expect(opsgenieConfig.urlValidator('https://api.opsgenie.com/v2/other')).toBe(false);
      expect(opsgenieConfig.urlValidator('invalid-url')).toBe(false);
    });

    it('API key validator validates key length', () => {
      const apiKeyField = opsgenieConfig.credentialFields.find(f => f.key === 'apiKey');
      const validator = apiKeyField?.validator;
      expect(typeof validator).toBe('function');

      if (validator) {
        // Valid key (> 30 characters)
        expect(validator('1234567890123456789012345678901')).toBe(true);
        expect(validator('12345678901234567890123456789012345')).toBe(true);

        // Invalid keys
        expect(validator('short')).not.toBe(true);
        expect(validator('123456789012345678901234567890')).not.toBe(true);
      }
    });

    it('has API key field', () => {
      const apiKeyField = opsgenieConfig.credentialFields.find(f => f.key === 'apiKey');
      expect(apiKeyField).toBeDefined();
      expect(apiKeyField?.required).toBe(true);
      expect(apiKeyField?.type).toBe('password');
    });

    it('has priority field', () => {
      const priorityField = opsgenieConfig.credentialFields.find(f => f.key === 'priority');
      expect(priorityField).toBeDefined();
      expect(priorityField?.type).toBe('select');
      expect(priorityField?.options).toBeDefined();
      expect(priorityField?.options?.length).toBeGreaterThan(0);
    });
  });

  describe('opsgenieDestinationType', () => {
    it('has correct ID', () => {
      expect(opsgenieDestinationType.id).toBe('opsgenie');
    });

    it('has display name', () => {
      expect(opsgenieDestinationType.name).toBe('Opsgenie');
    });

    it('has correct category', () => {
      expect(opsgenieDestinationType.category).toBe('incident');
    });

    it('is marked as popular', () => {
      expect(opsgenieDestinationType.popular).toBe(true);
    });
  });
});
