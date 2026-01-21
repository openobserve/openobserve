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
import { buildQueryFromConditions } from './alertQueryBuilder';

describe('alertQueryBuilder', () => {
  describe('buildQueryFromConditions', () => {
    it('should build query from simple condition', () => {
      const conditions = [
        {
          column: 'status',
          operator: '=',
          value: '200'
        }
      ];

      const query = buildQueryFromConditions(conditions);

      expect(query).toBeDefined();
      expect(typeof query).toBe('string');
      expect(query).toContain('status');
    });

    it('should build query from multiple conditions', () => {
      const conditions = [
        {
          column: 'status',
          operator: '=',
          value: '200'
        },
        {
          column: 'method',
          operator: '=',
          value: 'GET',
          logicalOperator: 'AND'
        }
      ];

      const query = buildQueryFromConditions(conditions);

      expect(query).toBeDefined();
      expect(query).toContain('status');
      expect(query).toContain('method');
    });

    it('should handle empty conditions', () => {
      const conditions: any[] = [];

      const query = buildQueryFromConditions(conditions);

      expect(query).toBeDefined();
    });
  });
});
