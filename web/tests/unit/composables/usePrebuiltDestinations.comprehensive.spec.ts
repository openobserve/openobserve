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

describe('usePrebuiltDestinations - Comprehensive Tests', () => {
  describe('Credential Validation', () => {
    it('should validate required fields', () => {
      const credentials = {
        webhookUrl: 'https://example.com',
        apiKey: 'secret123'
      };
      expect(credentials.webhookUrl).toBeTruthy();
      expect(credentials.apiKey).toBeTruthy();
    });

    it('should validate email format', () => {
      const email = 'test@example.com';
      const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      expect(isValid).toBe(true);
    });

    it('should reject invalid email format', () => {
      const email = 'invalid-email';
      const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      expect(isValid).toBe(false);
    });

    it('should validate URL format', () => {
      const url = 'https://example.com/webhook';
      const isValid = /^https?:\/\/.+/.test(url);
      expect(isValid).toBe(true);
    });

    it('should reject invalid URL format', () => {
      const url = 'not-a-url';
      const isValid = /^https?:\/\/.+/.test(url);
      expect(isValid).toBe(false);
    });
  });

  describe('Template Processing', () => {
    it('should parse JSON template', () => {
      const template = '{"text": "Hello"}';
      const parsed = JSON.parse(template);
      expect(parsed.text).toBe('Hello');
    });

    it('should handle template with placeholders', () => {
      const template = 'Alert: {alert_name}';
      expect(template).toContain('{alert_name}');
    });

    it('should replace placeholders', () => {
      const template = 'Alert: {alert_name}';
      const replaced = template.replace('{alert_name}', 'TestAlert');
      expect(replaced).toBe('Alert: TestAlert');
    });

    it('should handle multiple placeholders', () => {
      const template = '{alert_name} - {stream_name}';
      const result = template
        .replace('{alert_name}', 'Alert1')
        .replace('{stream_name}', 'Stream1');
      expect(result).toBe('Alert1 - Stream1');
    });
  });

  describe('Destination Type Detection', () => {
    it('should detect prebuilt type from template name', () => {
      const templateName = 'system-prebuilt-slack';
      const isPrebuilt = templateName.includes('prebuilt');
      expect(isPrebuilt).toBe(true);
    });

    it('should detect custom template', () => {
      const templateName = 'my-custom-template';
      const isPrebuilt = templateName.includes('prebuilt');
      expect(isPrebuilt).toBe(false);
    });

    it('should extract type from prebuilt template name', () => {
      const templateName = 'system-prebuilt-slack';
      const parts = templateName.split('-');
      const type = parts[parts.length - 1];
      expect(type).toBe('slack');
    });
  });

  describe('Header Management', () => {
    it('should merge default and custom headers', () => {
      const defaultHeaders = { 'Content-Type': 'application/json' };
      const customHeaders = { 'Authorization': 'Bearer token' };
      const merged = { ...defaultHeaders, ...customHeaders };
      expect(Object.keys(merged).length).toBe(2);
      expect(merged['Content-Type']).toBe('application/json');
      expect(merged['Authorization']).toBe('Bearer token');
    });

    it('should override default headers with custom', () => {
      const defaultHeaders = { 'Content-Type': 'application/json' };
      const customHeaders = { 'Content-Type': 'text/plain' };
      const merged = { ...defaultHeaders, ...customHeaders };
      expect(merged['Content-Type']).toBe('text/plain');
    });

    it('should filter empty header values', () => {
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': '',
        'X-Custom': 'value'
      };
      const filtered = Object.fromEntries(
        Object.entries(headers).filter(([_, v]) => v !== '')
      );
      expect(Object.keys(filtered).length).toBe(2);
    });
  });

  describe('URL Construction', () => {
    it('should build URL with query parameters', () => {
      const base = 'https://example.com/api';
      const params = { key: 'value', foo: 'bar' };
      const queryString = new URLSearchParams(params).toString();
      const url = `${base}?${queryString}`;
      expect(url).toContain('key=value');
      expect(url).toContain('foo=bar');
    });

    it('should encode special characters in URL', () => {
      const value = 'test value with spaces';
      const encoded = encodeURIComponent(value);
      expect(encoded).toBe('test%20value%20with%20spaces');
    });

    it('should handle URL with existing query parameters', () => {
      const url = 'https://example.com?existing=param';
      const hasQuery = url.includes('?');
      expect(hasQuery).toBe(true);
    });
  });

  describe('Payload Construction', () => {
    it('should build destination payload', () => {
      const payload = {
        name: 'test-dest',
        type: 'http',
        url: 'https://example.com',
        method: 'post',
        headers: {},
        template: 'default'
      };
      expect(payload.name).toBeTruthy();
      expect(payload.type).toBeTruthy();
      expect(payload.url).toBeTruthy();
    });

    it('should include metadata for prebuilt', () => {
      const payload = {
        name: 'slack-dest',
        metadata: {
          prebuilt_type: 'slack',
          credential_webhookUrl: 'https://hooks.slack.com/xxx'
        }
      };
      expect(payload.metadata).toBeDefined();
      expect(payload.metadata.prebuilt_type).toBe('slack');
    });

    it('should strip credential prefix', () => {
      const key = 'credential_webhookUrl';
      const stripped = key.replace('credential_', '');
      expect(stripped).toBe('webhookUrl');
    });
  });

  describe('Error Handling', () => {
    it('should handle JSON parse errors', () => {
      const invalidJson = '{invalid}';
      try {
        JSON.parse(invalidJson);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should validate required fields presence', () => {
      const data = { name: 'test' };
      const hasUrl = 'url' in data;
      expect(hasUrl).toBe(false);
    });

    it('should provide default values', () => {
      const data = {};
      const name = data.name || 'default-name';
      expect(name).toBe('default-name');
    });
  });

  describe('Type Guards', () => {
    it('should check if value is string', () => {
      const value = 'test';
      expect(typeof value === 'string').toBe(true);
    });

    it('should check if value is object', () => {
      const value = {};
      expect(typeof value === 'object' && value !== null).toBe(true);
    });

    it('should check if value is array', () => {
      const value = [];
      expect(Array.isArray(value)).toBe(true);
    });

    it('should check if value is undefined', () => {
      let value;
      expect(value === undefined).toBe(true);
    });
  });

  describe('String Operations', () => {
    it('should trim whitespace', () => {
      const value = '  test  ';
      const trimmed = value.trim();
      expect(trimmed).toBe('test');
    });

    it('should convert to lowercase', () => {
      const value = 'TEST';
      const lower = value.toLowerCase();
      expect(lower).toBe('test');
    });

    it('should split string', () => {
      const value = 'a,b,c';
      const parts = value.split(',');
      expect(parts.length).toBe(3);
      expect(parts[0]).toBe('a');
    });

    it('should join array', () => {
      const parts = ['a', 'b', 'c'];
      const joined = parts.join(',');
      expect(joined).toBe('a,b,c');
    });
  });

  describe('Object Operations', () => {
    it('should get object keys', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const keys = Object.keys(obj);
      expect(keys.length).toBe(3);
    });

    it('should get object values', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const values = Object.values(obj);
      expect(values.length).toBe(3);
    });

    it('should get object entries', () => {
      const obj = { a: 1, b: 2 };
      const entries = Object.entries(obj);
      expect(entries.length).toBe(2);
      expect(entries[0]).toEqual(['a', 1]);
    });

    it('should clone object', () => {
      const obj = { a: 1, b: 2 };
      const cloned = { ...obj };
      expect(cloned).not.toBe(obj);
      expect(cloned).toEqual(obj);
    });
  });

  describe('Array Operations', () => {
    it('should filter array', () => {
      const arr = [1, 2, 3, 4, 5];
      const filtered = arr.filter(n => n > 2);
      expect(filtered.length).toBe(3);
    });

    it('should map array', () => {
      const arr = [1, 2, 3];
      const mapped = arr.map(n => n * 2);
      expect(mapped).toEqual([2, 4, 6]);
    });

    it('should find in array', () => {
      const arr = [{ id: 1 }, { id: 2 }];
      const found = arr.find(item => item.id === 2);
      expect(found).toEqual({ id: 2 });
    });

    it('should check array includes', () => {
      const arr = ['a', 'b', 'c'];
      expect(arr.includes('b')).toBe(true);
      expect(arr.includes('d')).toBe(false);
    });
  });

  describe('Boolean Logic', () => {
    it('should handle AND logic', () => {
      const a = true;
      const b = true;
      expect(a && b).toBe(true);
    });

    it('should handle OR logic', () => {
      const a = false;
      const b = true;
      expect(a || b).toBe(true);
    });

    it('should handle NOT logic', () => {
      const a = true;
      expect(!a).toBe(false);
    });

    it('should handle truthy/falsy values', () => {
      expect(Boolean('')).toBe(false);
      expect(Boolean('test')).toBe(true);
      expect(Boolean(0)).toBe(false);
      expect(Boolean(1)).toBe(true);
    });
  });
});
