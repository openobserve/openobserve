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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAlertPayload } from './alertPayload';

describe('alertPayload', () => {
  describe('getAlertPayload', () => {
    const createBaseFormData = () => ({
      name: 'Test Alert',
      description: '  Test Description  ',
      is_real_time: 'false',
      trigger_condition: {
        threshold: '100',
        period: '5',
        frequency: '60',
        silence: '300'
      },
      context_attributes: [
        { key: 'env', value: 'production' },
        { key: 'service', value: 'api' }
      ],
      query_condition: {
        type: 'sql',
        conditions: [],
        sql: 'SELECT * FROM logs',
        aggregation: { field: 'count' },
        promql_condition: { query: 'up' },
        vrl_function: ''
      },
      stream_name: 'default',
      stream_type: 'logs',
      uuid: 'temp-uuid-123'
    });

    const createBaseContext = (overrides = {}) => ({
      store: {
        state: {
          selectedOrganization: { identifier: 'test-org' },
          userInfo: { email: 'test@example.com' }
        }
      },
      isAggregationEnabled: { value: false },
      getSelectedTab: { value: 'sql' },
      beingUpdated: false,
      ...overrides
    });

    it('should transform form data to API payload', () => {
      const formData = createBaseFormData();
      const context = createBaseContext();

      const payload = getAlertPayload(formData, context);

      expect(payload).toBeDefined();
      expect(payload.name).toBe('Test Alert');
      expect(payload.is_real_time).toBe(false);
      expect(payload.uuid).toBeUndefined(); // Should be deleted
      expect(payload.context_attributes).toHaveProperty('env');
      expect(payload.context_attributes.env).toBe('production');
    });

    it('should convert string trigger conditions to integers', () => {
      const formData = createBaseFormData();
      const context = createBaseContext();

      const payload = getAlertPayload(formData, context);

      expect(payload.trigger_condition.threshold).toBe(100);
      expect(payload.trigger_condition.period).toBe(5);
      expect(payload.trigger_condition.frequency).toBe(60);
      expect(payload.trigger_condition.silence).toBe(300);
      expect(typeof payload.trigger_condition.threshold).toBe('number');
    });

    it('should trim the description', () => {
      const formData = createBaseFormData();
      const context = createBaseContext();

      const payload = getAlertPayload(formData, context);

      expect(payload.description).toBe('Test Description');
    });

    it('should handle real-time alerts and set type to custom', () => {
      const formData = createBaseFormData();
      formData.is_real_time = 'true';
      const context = createBaseContext();

      const payload = getAlertPayload(formData, context);

      expect(payload.is_real_time).toBe(true);
      expect(payload.query_condition.type).toBe('custom');
    });

    it('should clear aggregation when not enabled', () => {
      const formData = createBaseFormData();
      const context = createBaseContext({ isAggregationEnabled: { value: false } });

      const payload = getAlertPayload(formData, context);

      expect(payload.query_condition.aggregation).toBeNull();
    });

    it('should keep aggregation when enabled and tab is custom', () => {
      const formData = createBaseFormData();
      const context = createBaseContext({
        isAggregationEnabled: { value: true },
        getSelectedTab: { value: 'custom' }
      });

      const payload = getAlertPayload(formData, context);

      expect(payload.query_condition.aggregation).toEqual({ field: 'count' });
    });

    it('should clear aggregation when tab is not custom even if enabled', () => {
      const formData = createBaseFormData();
      const context = createBaseContext({
        isAggregationEnabled: { value: true },
        getSelectedTab: { value: 'sql' }
      });

      const payload = getAlertPayload(formData, context);

      expect(payload.query_condition.aggregation).toBeNull();
    });

    it('should clear conditions for sql tab', () => {
      const formData = createBaseFormData();
      formData.query_condition.conditions = [{ field: 'level', operator: '=', value: 'error' }];
      const context = createBaseContext({ getSelectedTab: { value: 'sql' } });

      const payload = getAlertPayload(formData, context);

      expect(payload.query_condition.conditions).toEqual([]);
    });

    it('should clear conditions for promql tab', () => {
      const formData = createBaseFormData();
      formData.query_condition.conditions = [{ field: 'level', operator: '=', value: 'error' }];
      const context = createBaseContext({ getSelectedTab: { value: 'promql' } });

      const payload = getAlertPayload(formData, context);

      expect(payload.query_condition.conditions).toEqual([]);
    });

    it('should clear promql_condition for sql tab', () => {
      const formData = createBaseFormData();
      const context = createBaseContext({ getSelectedTab: { value: 'sql' } });

      const payload = getAlertPayload(formData, context);

      expect(payload.query_condition.promql_condition).toBeNull();
    });

    it('should clear promql_condition for custom tab', () => {
      const formData = createBaseFormData();
      const context = createBaseContext({ getSelectedTab: { value: 'custom' } });

      const payload = getAlertPayload(formData, context);

      expect(payload.query_condition.promql_condition).toBeNull();
    });

    it('should clear sql for promql tab', () => {
      const formData = createBaseFormData();
      const context = createBaseContext({ getSelectedTab: { value: 'promql' } });

      const payload = getAlertPayload(formData, context);

      expect(payload.query_condition.sql).toBe('');
    });

    it('should base64 encode vrl_function when present', () => {
      const formData = createBaseFormData();
      formData.query_condition.vrl_function = '  .message = "test"  ';
      const context = createBaseContext();

      const payload = getAlertPayload(formData, context);

      // b64EncodeUnicode uses URL-safe base64 encoding with . instead of =
      // So btoa('.message = "test"') = "Lm1lc3NhZ2UgPSAidGVzdCI=" becomes "Lm1lc3NhZ2UgPSAidGVzdCI."
      expect(payload.query_condition.vrl_function).toBe('Lm1lc3NhZ2UgPSAidGVzdCI.');
    });

    it('should set createdAt and owner for new alerts', () => {
      const formData = createBaseFormData();
      const context = createBaseContext({ beingUpdated: false });

      const payload = getAlertPayload(formData, context);

      expect(payload.createdAt).toBeDefined();
      expect(payload.owner).toBe('test@example.com');
      expect(payload.lastTriggeredAt).toBeDefined();
      expect(payload.lastEditedBy).toBe('test@example.com');
    });

    it('should set updatedAt for existing alerts', () => {
      const formData = createBaseFormData();
      const context = createBaseContext({ beingUpdated: true });

      const payload = getAlertPayload(formData, context);

      expect(payload.updatedAt).toBeDefined();
      expect(payload.lastEditedBy).toBe('test@example.com');
      expect(payload.createdAt).toBeUndefined();
    });

    it('should filter out empty context attributes', () => {
      const formData = createBaseFormData();
      formData.context_attributes = [
        { key: 'valid', value: 'value' },
        { key: '', value: 'no-key' },
        { key: 'no-value', value: '' },
        { key: '  ', value: '  ' }
      ];
      const context = createBaseContext();

      const payload = getAlertPayload(formData, context);

      expect(Object.keys(payload.context_attributes)).toEqual(['valid']);
    });

    it('should handle empty context attributes array', () => {
      const formData = createBaseFormData();
      formData.context_attributes = [];
      const context = createBaseContext();

      const payload = getAlertPayload(formData, context);

      expect(payload.context_attributes).toEqual({});
    });

    it('should preserve original formData by using deep clone', () => {
      const formData = createBaseFormData();
      const originalUuid = formData.uuid;
      const context = createBaseContext();

      getAlertPayload(formData, context);

      // Original formData should not be modified
      expect(formData.uuid).toBe(originalUuid);
    });
  });
});
