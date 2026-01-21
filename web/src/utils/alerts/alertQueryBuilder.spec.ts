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
import { getFormattedCondition, generateSqlQuery } from './alertQueryBuilder';

describe('alertQueryBuilder', () => {
  describe('getFormattedCondition', () => {
    it('should format equality condition', () => {
      const condition = getFormattedCondition('status', '=', '200');
      expect(condition).toBe('status = 200');
    });

    it('should format contains condition', () => {
      const condition = getFormattedCondition('message', 'contains', 'error');
      expect(condition).toBe("message LIKE '%error%'");
    });

    it('should format not_contains condition', () => {
      const condition = getFormattedCondition('message', 'not_contains', 'debug');
      expect(condition).toBe("message NOT LIKE '%debug%'");
    });

    it('should format comparison operators', () => {
      expect(getFormattedCondition('count', '>', 100)).toBe('count > 100');
      expect(getFormattedCondition('count', '<=', 50)).toBe('count <= 50');
    });
  });

  describe('generateSqlQuery', () => {
    it('should generate basic SQL query without aggregation', () => {
      const formData = {
        stream_name: 'test_stream',
        query_condition: {
          conditions: { filterType: 'AND', conditions: [] },
          sql: '',
          promql: '',
          type: 'sql',
          aggregation: null,
          promql_condition: null,
          vrl_function: null,
          multi_time_range: []
        }
      };

      const query = generateSqlQuery(formData, {}, false);
      expect(query).toContain('SELECT histogram(_timestamp)');
      expect(query).toContain('FROM "test_stream"');
      expect(query).toContain('COUNT(*)');
    });

    it('should generate SQL query with aggregation', () => {
      const formData = {
        stream_name: 'test_stream',
        query_condition: {
          conditions: { filterType: 'AND', conditions: [] },
          sql: '',
          promql: '',
          type: 'sql',
          aggregation: {
            group_by: [],
            function: 'avg',
            having: { column: 'response_time', operator: '>', value: 100 }
          },
          promql_condition: null,
          vrl_function: null,
          multi_time_range: []
        }
      };

      const query = generateSqlQuery(formData, {}, true);
      expect(query).toContain('avg(response_time)');
      expect(query).toContain('zo_sql_val');
    });
  });
});
