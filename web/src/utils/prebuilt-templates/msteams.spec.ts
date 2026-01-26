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
import { msteamsTemplate, msteamsConfig, msteamsDestinationType } from '@/utils/prebuilt-templates/msteams';

describe('msteams template', () => {
  describe('msteamsTemplate', () => {
    it('has correct name', () => {
      expect(msteamsTemplate.name).toBe('system-prebuilt-msteams');
    });

    it('has type as http', () => {
      expect(msteamsTemplate.type).toBe('http');
    });

    it('is not default', () => {
      expect(msteamsTemplate.isDefault).toBe(false);
    });

    it('has valid JSON body', () => {
      expect(() => JSON.parse(msteamsTemplate.body)).not.toThrow();
    });

    it('body contains MS Teams message card structure', () => {
      const body = JSON.parse(msteamsTemplate.body);
      expect(body).toHaveProperty('@type');
      expect(body).toHaveProperty('@context');
    });
  });

  describe('msteamsConfig', () => {
    it('references correct template name', () => {
      expect(msteamsConfig.templateName).toBe('system-prebuilt-msteams');
    });

    it('has correct headers', () => {
      expect(msteamsConfig.headers).toHaveProperty('Content-Type');
      expect(msteamsConfig.headers['Content-Type']).toBe('application/json');
    });

    it('uses POST method', () => {
      expect(msteamsConfig.method).toBe('post');
    });

    it('has URL validator function', () => {
      expect(typeof msteamsConfig.urlValidator).toBe('function');
    });

    it('URL validator accepts valid MS Teams webhook URLs', () => {
      expect(msteamsConfig.urlValidator('https://outlook.office.com/webhook/xxx')).toBe(true);
      expect(msteamsConfig.urlValidator('https://webhook.office.com/webhookb2/xxx')).toBe(true);
    });

    it('URL validator rejects invalid URLs', () => {
      expect(msteamsConfig.urlValidator('https://example.com/webhook')).toBe(false);
      expect(msteamsConfig.urlValidator('http://outlook.office.com/webhook/xxx')).toBe(false);
      expect(msteamsConfig.urlValidator('https://evil.com?outlook.office.com=fake')).toBe(false);
      expect(msteamsConfig.urlValidator('invalid-url')).toBe(false);
    });

    it('webhook URL validator validates MS Teams URLs', () => {
      const webhookField = msteamsConfig.credentialFields.find(f => f.key === 'webhookUrl');
      const validator = webhookField?.validator;
      expect(typeof validator).toBe('function');

      if (validator) {
        // Valid URLs
        expect(validator('https://outlook.office.com/webhook/xxx')).toBe(true);
        expect(validator('https://webhook.office.com/webhookb2/xxx')).toBe(true);

        // Invalid URLs
        expect(validator('https://example.com')).not.toBe(true);
        expect(validator('http://outlook.office.com/webhook/xxx')).not.toBe(true);
        expect(validator('invalid-url')).not.toBe(true);
      }
    });

    it('has credential fields', () => {
      expect(msteamsConfig.credentialFields).toBeInstanceOf(Array);
      expect(msteamsConfig.credentialFields.length).toBeGreaterThan(0);
    });

    it('webhook URL field is required', () => {
      const webhookField = msteamsConfig.credentialFields.find(f => f.key === 'webhookUrl');
      expect(webhookField).toBeDefined();
      expect(webhookField?.required).toBe(true);
    });
  });

  describe('msteamsDestinationType', () => {
    it('has correct ID', () => {
      expect(msteamsDestinationType.id).toBe('msteams');
    });

    it('has display name', () => {
      expect(msteamsDestinationType.name).toBe('Microsoft Teams');
    });

    it('has description', () => {
      expect(msteamsDestinationType.description).toBeTruthy();
    });

    it('has correct category', () => {
      expect(msteamsDestinationType.category).toBe('messaging');
    });

    it('is marked as popular', () => {
      expect(msteamsDestinationType.popular).toBe(true);
    });
  });
});
