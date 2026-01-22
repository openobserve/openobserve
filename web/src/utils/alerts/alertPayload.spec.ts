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
import { getAlertPayload } from './alertPayload';

describe('alertPayload', () => {
  describe('getAlertPayload', () => {
    it('should transform form data to API payload', () => {
      const formData = {
        name: 'Test Alert',
        description: 'Test Description',
        is_real_time: 'false',
        trigger_condition: {
          threshold: 100,
          period: 5,
          frequency: 60,
          silence: 300
        },
        context_attributes: [
          { key: 'env', value: 'production' },
          { key: 'service', value: 'api' }
        ],
        query_condition: {
          type: 'sql',
          conditions: [],
          sql: 'SELECT * FROM logs'
        },
        stream_name: 'default',
        stream_type: 'logs',
        uuid: 'temp-uuid-123'
      };

      const context = {
        store: {
          state: {
            selectedOrganization: { identifier: 'test-org' },
            userInfo: { email: 'test@example.com' }
          }
        },
        isAggregationEnabled: { value: false },
        getSelectedTab: { value: 'sql' },
        beingUpdated: false
      };

      const payload = getAlertPayload(formData, context);

      expect(payload).toBeDefined();
      expect(payload.name).toBe('Test Alert');
      expect(payload.is_real_time).toBe(false);
      expect(payload.uuid).toBeUndefined(); // Should be deleted
      expect(payload.context_attributes).toHaveProperty('env');
      expect(payload.context_attributes.env).toBe('production');
    });

    it('should handle real-time alerts', () => {
      const formData = {
        name: 'RT Alert',
        description: '',
        is_real_time: 'true',
        trigger_condition: { threshold: 10, period: 1, frequency: 10, silence: 60 },
        context_attributes: [],
        query_condition: { type: 'sql', conditions: [], sql: 'SELECT count(*) FROM logs' },
        stream_name: 'default',
        stream_type: 'logs'
      };

      const context = {
        store: {
          state: {
            selectedOrganization: { identifier: 'test-org' },
            userInfo: { email: 'test@example.com' }
          }
        },
        isAggregationEnabled: { value: true },
        getSelectedTab: { value: 'promql' },
        beingUpdated: false
      };

      const payload = getAlertPayload(formData, context);

      expect(payload.is_real_time).toBe(true);
      expect(payload.query_condition.type).toBe('custom');
    });
  });
});
