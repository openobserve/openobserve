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
import { emailTemplate, emailConfig, emailDestinationType } from '@/utils/prebuilt-templates/email';

describe('email template', () => {
  describe('emailTemplate', () => {
    it('has correct name', () => {
      expect(emailTemplate.name).toBe('system-prebuilt-email');
    });

    it('has type as email', () => {
      expect(emailTemplate.type).toBe('email');
    });

    it('is not default', () => {
      expect(emailTemplate.isDefault).toBe(false);
    });

    it('has body content', () => {
      expect(emailTemplate.body).toBeTruthy();
      expect(typeof emailTemplate.body).toBe('string');
    });

    it('body contains HTML structure', () => {
      expect(emailTemplate.body).toContain('html');
      expect(emailTemplate.body).toContain('body');
    });

    it('body contains alert placeholders', () => {
      expect(emailTemplate.body).toContain('{alert_name}');
    });
  });

  describe('emailConfig', () => {
    it('references correct template name', () => {
      expect(emailConfig.templateName).toBe('system-prebuilt-email');
    });

    it('has credential fields', () => {
      expect(emailConfig.credentialFields).toBeInstanceOf(Array);
      expect(emailConfig.credentialFields.length).toBeGreaterThan(0);
    });

    it('has recipients field', () => {
      const recipientsField = emailConfig.credentialFields.find(f => f.key === 'recipients');
      expect(recipientsField).toBeDefined();
      expect(recipientsField?.required).toBe(true);
      expect(recipientsField?.label).toBeTruthy();
    });

    it('recipients field has validator', () => {
      const recipientsField = emailConfig.credentialFields.find(f => f.key === 'recipients');
      expect(typeof recipientsField?.validator).toBe('function');
    });

    it('validates email addresses', () => {
      const recipientsField = emailConfig.credentialFields.find(f => f.key === 'recipients');
      const validator = recipientsField?.validator;

      if (validator) {
        // Valid email addresses
        expect(validator('test@example.com')).toBe(true);
        expect(validator('test@example.com,user@domain.com')).toBe(true);
        expect(validator('user@company.co.uk')).toBe(true);
        expect(validator('test.user+tag@example.com')).toBe(true);

        // Invalid email addresses
        expect(validator('invalid-email')).not.toBe(true);
        expect(validator('missing@domain')).not.toBe(true);
        expect(validator('@example.com')).not.toBe(true);
        expect(validator('test@')).not.toBe(true);
        expect(validator('test@example.com,invalid-email')).not.toBe(true);
      }
    });

    it('URL validator always returns false for email type', () => {
      // Email type doesn't use URLs - should always return false
      expect(emailConfig.urlValidator('https://example.com')).toBe(false);
      expect(emailConfig.urlValidator('invalid')).toBe(false);
      expect(emailConfig.urlValidator('')).toBe(false);
    });
  });

  describe('emailDestinationType', () => {
    it('has correct ID', () => {
      expect(emailDestinationType.id).toBe('email');
    });

    it('has display name', () => {
      expect(emailDestinationType.name).toBe('Email');
    });

    it('has description', () => {
      expect(emailDestinationType.description).toBeTruthy();
      expect(typeof emailDestinationType.description).toBe('string');
    });

    it('has correct category', () => {
      expect(emailDestinationType.category).toBe('email');
    });

    it('has icon', () => {
      expect(emailDestinationType.icon).toBeTruthy();
    });
  });
});
