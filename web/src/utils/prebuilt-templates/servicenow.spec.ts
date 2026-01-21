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
import { servicenowTemplate, servicenowConfig, servicenowDestinationType } from '@/utils/prebuilt-templates/servicenow';

describe('servicenow template', () => {
  describe('servicenowTemplate', () => {
    it('has correct name', () => {
      expect(servicenowTemplate.name).toBe('system-prebuilt-servicenow');
    });

    it('has type as http', () => {
      expect(servicenowTemplate.type).toBe('http');
    });

    it('is not default', () => {
      expect(servicenowTemplate.isDefault).toBe(false);
    });

    it('has valid JSON body', () => {
      expect(() => JSON.parse(servicenowTemplate.body)).not.toThrow();
    });

    it('body contains incident fields', () => {
      const body = JSON.parse(servicenowTemplate.body);
      expect(body).toHaveProperty('short_description');
      expect(body).toHaveProperty('description');
    });
  });

  describe('servicenowConfig', () => {
    it('references correct template name', () => {
      expect(servicenowConfig.templateName).toBe('system-prebuilt-servicenow');
    });

    it('has correct headers', () => {
      expect(servicenowConfig.headers).toHaveProperty('Content-Type');
      expect(servicenowConfig.headers['Content-Type']).toBe('application/json');
    });

    it('uses POST method', () => {
      expect(servicenowConfig.method).toBe('post');
    });

    it('has URL validator', () => {
      expect(typeof servicenowConfig.urlValidator).toBe('function');
    });

    it('validates ServiceNow URLs', () => {
      expect(servicenowConfig.urlValidator('https://dev.service-now.com/api/now/table/incident')).toBe(true);
      expect(servicenowConfig.urlValidator('https://example.com')).toBe(false);
      expect(servicenowConfig.urlValidator('https://evil.service-now.com.attacker.com/api/now/table/incident')).toBe(false);
    });

    it('validates instanceUrl credential field', () => {
      const instanceField = servicenowConfig.credentialFields.find(f => f.key === 'instanceUrl');
      expect(instanceField?.validator).toBeDefined();

      if (instanceField?.validator) {
        // Valid URLs
        expect(instanceField.validator('https://dev.service-now.com/api/now/table/incident')).toBe(true);
        expect(instanceField.validator('https://company.service-now.com/api/now/table/incident')).toBe(true);

        // Invalid URLs
        expect(instanceField.validator('https://example.com')).not.toBe(true);
        expect(instanceField.validator('https://evil.service-now.com.attacker.com/api/now/table/incident')).not.toBe(true);
        expect(instanceField.validator('https://service-now.com/wrong/path')).not.toBe(true);
      }
    });

    it('has instance URL field', () => {
      const instanceField = servicenowConfig.credentialFields.find(f => f.key === 'instanceUrl');
      expect(instanceField).toBeDefined();
      expect(instanceField?.required).toBe(true);
    });

    it('has username field', () => {
      const usernameField = servicenowConfig.credentialFields.find(f => f.key === 'username');
      expect(usernameField).toBeDefined();
      expect(usernameField?.required).toBe(true);
      expect(usernameField?.type).toBe('text');
    });

    it('has password field', () => {
      const passwordField = servicenowConfig.credentialFields.find(f => f.key === 'password');
      expect(passwordField).toBeDefined();
      expect(passwordField?.required).toBe(true);
      expect(passwordField?.type).toBe('password');
    });
  });

  describe('servicenowDestinationType', () => {
    it('has correct ID', () => {
      expect(servicenowDestinationType.id).toBe('servicenow');
    });

    it('has display name', () => {
      expect(servicenowDestinationType.name).toBe('ServiceNow');
    });

    it('has correct category', () => {
      expect(servicenowDestinationType.category).toBe('incident');
    });
  });
});
