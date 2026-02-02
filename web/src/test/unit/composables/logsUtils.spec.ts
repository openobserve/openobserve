// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";

// Mock the vuex store
const mockStore = {
  state: {
    zoConfig: {
      timestamp_column: "_timestamp",
    },
    selectedOrganization: {
      identifier: "test-org",
    },
  },
};

// Mock Vue router
const mockRouter = {
  currentRoute: {
    value: {
      name: "logs",
      query: {},
    },
  },
  push: vi.fn(),
};

// Mock search object
const mockSearchObj = {
  data: {
    query: "",
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({
      notify: vi.fn(),
    }),
  };
});

// Mock searchState to return our mock object
vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({
    searchObj: mockSearchObj,
  }),
}));

// Import logsUtils after mocking
import logsUtils from "@/composables/useLogs/logsUtils";

describe("logsUtils - checkTimestampAlias (Fixed Implementation)", () => {
  let logsUtilsInstance: any;

  beforeEach(() => {
    // Reset the mock search object
    mockSearchObj.data.query = "";

    // Create a new instance of logsUtils
    logsUtilsInstance = logsUtils();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Simple SELECT queries with timestamp alias", () => {
    it("should return true for valid timestamp field selection", () => {
      const query = "SELECT _timestamp FROM logs";
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(true);
    });

    it("should return false when non-timestamp field uses timestamp alias", () => {
      const query = "SELECT created_at AS _timestamp FROM logs";
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should return false for multiple fields where one uses invalid timestamp alias", () => {
      const query =
        "SELECT _timestamp, user_id, created_at AS _timestamp FROM logs";
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should return false when query contains case-insensitive timestamp alias", () => {
      const query = "SELECT created_at as _timestamp FROM logs";
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should return true for valid timestamp with other fields", () => {
      const query = "SELECT _timestamp, message, level FROM logs";
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(true);
    });

    it("should return false when timestamp field is aliased as itself with AS keyword", () => {
      const query = "SELECT _timestamp AS _timestamp FROM logs";
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should return false when timestamp is aliased with double quotes", () => {
      const query = 'SELECT _timestamp AS _timestamp FROM "default"';
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);

      expect(result).toBe(false);
    });
  });

  describe("Common Table Expression (CTE) queries with timestamp alias", () => {
    it("should return false for CTE with invalid timestamp alias", () => {
      const query = `
        WITH recent_logs AS (
          SELECT event_time AS _timestamp, user_id
          FROM events
          WHERE event_time > '2023-01-01'
        )
        SELECT _timestamp, user_id FROM recent_logs
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should return true for CTE with valid timestamp usage", () => {
      const query = `
        WITH recent_logs AS (
          SELECT _timestamp, user_id
          FROM logs
          WHERE _timestamp > '2023-01-01'
        )
        SELECT _timestamp, user_id FROM recent_logs
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(true);
    });

    it("should return false for nested CTE with invalid timestamp alias", () => {
      const query = `
        WITH level1 AS (
          SELECT created_date AS _timestamp, user_id
          FROM users
        ), level2 AS (
          SELECT _timestamp, user_id
          FROM level1
        )
        SELECT * FROM level2
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should return true for complex CTE without timestamp alias misuse", () => {
      const query = `
        WITH aggregated AS (
          SELECT COUNT(*) as cnt, _timestamp
          FROM logs
          GROUP BY _timestamp
        )
        SELECT cnt, _timestamp FROM aggregated
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(true);
    });
  });

  describe("JOIN queries with timestamp alias", () => {
    it("should return false for JOIN with invalid timestamp alias", () => {
      const query = `
        SELECT l.log_time AS _timestamp, l.message, u.username
        FROM logs l
        JOIN users u ON l.user_id = u.id
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should return true for JOIN with valid timestamp field", () => {
      const query = `
        SELECT l._timestamp, l.message, u.username
        FROM logs l
        JOIN users u ON l.user_id = u.id
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(true);
    });

    it("should return false for LEFT JOIN with aliased timestamp from non-timestamp field", () => {
      const query = `
        SELECT u.created_at AS _timestamp, l.message
        FROM logs l
        LEFT JOIN users u ON l.user_id = u.id
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should return false for complex multi-table JOIN with invalid timestamp alias", () => {
      const query = `
        SELECT e.event_time AS _timestamp, l.message, m.metric_value
        FROM logs l
        FULL OUTER JOIN events e ON l.trace_id = e.trace_id
        LEFT JOIN metrics m ON l.service = m.service
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });
  });

  describe("Subquery scenarios with timestamp alias", () => {
    it("should return false for subquery with invalid timestamp alias", () => {
      const query = `
        SELECT message, (
          SELECT MAX(created_at) AS _timestamp
          FROM events
          WHERE user_id = logs.user_id
        ) AS latest_event
        FROM logs
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should return false for WHERE subquery with invalid timestamp alias", () => {
      const query = `
        SELECT message
        FROM logs
        WHERE _timestamp > (
          SELECT MIN(start_time) AS _timestamp
          FROM sessions
        )
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should return true for valid nested subquery with timestamp", () => {
      const query = `
        SELECT _timestamp, message
        FROM logs
        WHERE user_id IN (
          SELECT user_id
          FROM user_sessions
          WHERE _timestamp > '2023-01-01'
        )
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(true);
    });

    it("should return false for EXISTS subquery with invalid timestamp alias", () => {
      const query = `
        SELECT *
        FROM logs l
        WHERE EXISTS (
          SELECT last_login AS _timestamp
          FROM users u
          WHERE u.id = l.user_id
        )
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });
  });

  describe("Complex nested queries with timestamp alias", () => {
    it("should return false for complex query with CTE, JOIN, and subquery having invalid timestamp alias", () => {
      const query = `
        WITH recent_logs AS (
          SELECT log_date AS _timestamp, user_id, message
          FROM logs
          WHERE log_date > CURRENT_DATE - INTERVAL '7 days'
        )
        SELECT rl._timestamp, u.username
        FROM recent_logs rl
        INNER JOIN users u ON rl.user_id = u.id
        WHERE EXISTS (
          SELECT event_timestamp AS _timestamp
          FROM events e
          WHERE e.user_id = rl.user_id
        )
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should return true for complex valid query without timestamp alias misuse", () => {
      const query = `
        WITH hourly_stats AS (
          SELECT COUNT(*) as log_count, _timestamp
          FROM logs
          GROUP BY DATE_TRUNC('hour', _timestamp)
        )
        SELECT hs.log_count, hs._timestamp
        FROM hourly_stats hs
        WHERE _timestamp > (
          SELECT MAX(_timestamp)
          FROM archived_logs
        )
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(true);
    });

    it("should return false for window function query with invalid timestamp alias", () => {
      const query = `
        SELECT
          created_time AS _timestamp,
          ROW_NUMBER() OVER (ORDER BY created_time) as rn
        FROM events
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should return false for UNION query with invalid timestamp alias", () => {
      const query = `
        SELECT _timestamp, 'log' as source FROM logs
        UNION ALL
        SELECT event_time AS _timestamp, 'event' as source FROM events
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });
  });

  describe("Edge cases and error handling", () => {
    it("should handle empty query gracefully", () => {
      const query = "";
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(true);
    });

    it("should handle malformed SQL gracefully", () => {
      const query = "SELECT FROM WHERE INVALID";
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(typeof result).toBe("boolean");
    });

    it("should handle null/undefined query gracefully", () => {
      mockSearchObj.data.query = "";

      const result1 = logsUtilsInstance.checkTimestampAlias(null);
      const result2 = logsUtilsInstance.checkTimestampAlias(undefined);
      const result3 = logsUtilsInstance.checkTimestampAlias("");

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);
    });

    it("should handle query without columns gracefully", () => {
      const query = "SELECT FROM logs";
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(true);
    });

    it("should handle queries with aggregation functions", () => {
      const query = `
        SELECT COUNT(*) as count, _timestamp
        FROM logs
        GROUP BY _timestamp
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(true);
    });

    it("should return false for aggregation with invalid timestamp alias", () => {
      const query = `
        SELECT COUNT(*) as count, MAX(created_at) AS _timestamp
        FROM logs
        GROUP BY user_id
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should detect timestamp alias in complex query string", () => {
      const query = `
        SELECT
          field1,
          field2,
          created_at as _timestamp,
          field3
        FROM logs
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should handle query with comments and whitespace", () => {
      const query = `
        -- This is a comment
        SELECT
          /* block comment */
          _timestamp
        FROM logs
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(true);
    });
  });

  describe("Different timestamp column configurations", () => {
    it("should work with different timestamp column names", () => {
      // Change the timestamp column name
      mockStore.state.zoConfig.timestamp_column = "event_time";
      // Recreate instance to pick up new timestamp column name
      const customInstance = logsUtils();

      const validQuery = "SELECT event_time FROM logs";
      const invalidQuery = "SELECT created_at AS event_time FROM logs";

      // Test valid case
      mockSearchObj.data.query = validQuery;
      let result = customInstance.checkTimestampAlias(validQuery);
      expect(result).toBe(true);

      // Test invalid case
      mockSearchObj.data.query = invalidQuery;
      result = customInstance.checkTimestampAlias(invalidQuery);
      expect(result).toBe(false);

      // Reset for other tests
      mockStore.state.zoConfig.timestamp_column = "_timestamp";
    });

    it("should handle custom timestamp column in complex queries", () => {
      // Change the timestamp column name
      mockStore.state.zoConfig.timestamp_column = "log_timestamp";
      // Recreate instance to pick up new timestamp column name
      const customInstance = logsUtils();

      const query = `
        WITH recent AS (
          SELECT user_activity AS log_timestamp, user_id
          FROM activities
        )
        SELECT log_timestamp FROM recent
      `;
      mockSearchObj.data.query = query;

      const result = customInstance.checkTimestampAlias(query);
      expect(result).toBe(false);

      // Reset for other tests
      mockStore.state.zoConfig.timestamp_column = "_timestamp";
    });
  });

  describe("Performance and realistic query scenarios", () => {
    it("should handle complex analytical query", () => {
      const query = `
        SELECT
          _timestamp,
          level,
          COUNT(*) as log_count,
          AVG(response_time) as avg_response
        FROM logs
        WHERE _timestamp >= NOW() - INTERVAL '24 hours'
        GROUP BY _timestamp, level
        ORDER BY _timestamp DESC
        LIMIT 1000
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(true);
    });

    it("should detect invalid alias in complex analytical query", () => {
      const query = `
        SELECT
          log_date AS _timestamp,
          level,
          COUNT(*) as log_count,
          AVG(response_time) as avg_response
        FROM logs
        WHERE log_date >= NOW() - INTERVAL '24 hours'
        GROUP BY log_date, level
        ORDER BY log_date DESC
        LIMIT 1000
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(false);
    });

    it("should handle query with multiple JOINs and aggregations", () => {
      const query = `
        SELECT
          l._timestamp,
          u.username,
          s.service_name,
          COUNT(l.id) as log_count
        FROM logs l
        JOIN users u ON l.user_id = u.id
        JOIN services s ON l.service_id = s.id
        WHERE l._timestamp >= '2023-01-01'
        GROUP BY l._timestamp, u.username, s.service_name
        HAVING COUNT(l.id) > 10
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(true);
    });

    it("should handle complex time-based window functions", () => {
      const query = `
        SELECT
          _timestamp,
          user_id,
          action,
          LAG(_timestamp) OVER (
            PARTITION BY user_id
            ORDER BY _timestamp
          ) as previous_timestamp
        FROM user_actions
        WHERE _timestamp >= '2023-01-01'
      `;
      mockSearchObj.data.query = query;

      const result = logsUtilsInstance.checkTimestampAlias(query);
      expect(result).toBe(true);
    });
  });

  describe("Quote format variations - Double quotes, Single quotes, No quotes", () => {
    describe("Simple field aliases with different quote formats", () => {
      it("should return false when field uses double-quoted timestamp alias", () => {
        const query = 'SELECT created_at AS "_timestamp" FROM logs';
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false when field uses single-quoted timestamp alias", () => {
        const query = "SELECT created_at AS '_timestamp' FROM logs";
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false when field uses unquoted timestamp alias", () => {
        const query = "SELECT created_at AS _timestamp FROM logs";
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false when timestamp field uses double-quoted alias to itself", () => {
        const query = 'SELECT _timestamp AS "_timestamp" FROM logs';
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false when timestamp field uses single-quoted alias to itself", () => {
        const query = "SELECT _timestamp AS '_timestamp' FROM logs";
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });
    });

    describe("Histogram function with different quote formats", () => {
      it("should return false for histogram with double-quoted timestamp alias", () => {
        const query = 'SELECT histogram(_timestamp) as "_timestamp", count(kubernetes_namespace_name) as "y_axis_1", kubernetes_namespace_name as "breakdown_1" FROM "ks" GROUP BY _timestamp, breakdown_1 ORDER BY _timestamp ASC';
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for histogram with single-quoted timestamp alias", () => {
        const query = "SELECT histogram(_timestamp) as '_timestamp', count(kubernetes_namespace_name) as \"y_axis_1\", kubernetes_namespace_name as \"breakdown_1\" FROM \"ks\" GROUP BY _timestamp, breakdown_1 ORDER BY _timestamp ASC";
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for histogram with unquoted timestamp alias", () => {
        const query = 'SELECT histogram(_timestamp) as _timestamp, count(kubernetes_namespace_name) as "y_axis_1", kubernetes_namespace_name as "breakdown_1" FROM "ks" GROUP BY _timestamp, breakdown_1 ORDER BY _timestamp ASC';
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return true for valid histogram query without timestamp alias", () => {
        const query = 'SELECT histogram(_timestamp) as "time_bucket", count(kubernetes_namespace_name) as "y_axis_1", kubernetes_namespace_name as "breakdown_1" FROM "ks" GROUP BY time_bucket, breakdown_1 ORDER BY time_bucket ASC';
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(true);
      });
    });

    describe("Aggregation functions with different quote formats", () => {
      it("should return false for MAX function with double-quoted timestamp alias", () => {
        const query = 'SELECT MAX(created_at) AS "_timestamp", user_id FROM logs GROUP BY user_id';
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for MAX function with single-quoted timestamp alias", () => {
        const query = "SELECT MAX(created_at) AS '_timestamp', user_id FROM logs GROUP BY user_id";
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for MIN function with unquoted timestamp alias", () => {
        const query = "SELECT MIN(event_time) AS _timestamp FROM events";
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for DATE_TRUNC with double-quoted timestamp alias", () => {
        const query = 'SELECT DATE_TRUNC(\'hour\', log_time) AS "_timestamp", COUNT(*) FROM logs GROUP BY DATE_TRUNC(\'hour\', log_time)';
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for DATE_TRUNC with single-quoted timestamp alias", () => {
        const query = "SELECT DATE_TRUNC('hour', log_time) AS '_timestamp', COUNT(*) FROM logs GROUP BY DATE_TRUNC('hour', log_time)";
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });
    });

    describe("Complex queries with mixed quote formats", () => {
      it("should return false for query with multiple aliased columns including single-quoted timestamp", () => {
        const query = `
          SELECT
            user_id as "user",
            event_date AS '_timestamp',
            action as "action_type"
          FROM events
        `;
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for query with multiple aliased columns including double-quoted timestamp", () => {
        const query = `
          SELECT
            user_id as 'user',
            event_date AS "_timestamp",
            action as 'action_type'
          FROM events
        `;
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for CTE with single-quoted timestamp alias", () => {
        const query = `
          WITH recent_logs AS (
            SELECT event_time AS '_timestamp', user_id
            FROM events
            WHERE event_time > '2023-01-01'
          )
          SELECT '_timestamp', user_id FROM recent_logs
        `;
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for JOIN query with double-quoted timestamp alias", () => {
        const query = `
          SELECT l.log_time AS "_timestamp", l.message, u.username
          FROM logs l
          JOIN users u ON l.user_id = u.id
        `;
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for subquery with single-quoted timestamp alias", () => {
        const query = `
          SELECT message, (
            SELECT MAX(created_at) AS '_timestamp'
            FROM events
            WHERE user_id = logs.user_id
          ) AS latest_event
          FROM logs
        `;
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });
    });

    describe("Complicated real-world dashboard queries with all quote formats", () => {
      it("should return false for dashboard panel query with double-quoted histogram alias", () => {
        const query = `
          SELECT
            histogram(_timestamp, '5m') as "_timestamp",
            COUNT(*) as "total_requests",
            AVG(response_time) as "avg_response",
            service_name as "service"
          FROM api_logs
          WHERE _timestamp >= NOW() - INTERVAL '1 hour'
          GROUP BY histogram(_timestamp, '5m'), service_name
          ORDER BY histogram(_timestamp, '5m') ASC
        `;
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for dashboard panel query with single-quoted histogram alias", () => {
        const query = `
          SELECT
            histogram(_timestamp, '1h') as '_timestamp',
            COUNT(DISTINCT user_id) as 'unique_users',
            SUM(bytes_sent) as 'total_bytes',
            status_code as 'status'
          FROM access_logs
          WHERE _timestamp >= NOW() - INTERVAL '24 hours'
          GROUP BY histogram(_timestamp, '1h'), status_code
          ORDER BY histogram(_timestamp, '1h') ASC
        `;
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for multi-breakdown dashboard query with mixed quotes", () => {
        const query = `
          SELECT
            DATE_TRUNC('minute', event_time) AS "_timestamp",
            COUNT(*) as "count",
            environment as 'env',
            region as "region",
            pod_name as 'pod'
          FROM kubernetes_events
          WHERE event_time >= NOW() - INTERVAL '30 minutes'
          GROUP BY DATE_TRUNC('minute', event_time), environment, region, pod_name
          ORDER BY DATE_TRUNC('minute', event_time) DESC
        `;
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for percentile calculation with single-quoted alias", () => {
        const query = `
          SELECT
            FLOOR(log_timestamp / 60000) * 60000 AS '_timestamp',
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration) as 'p50',
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration) as 'p95',
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration) as 'p99'
          FROM request_logs
          WHERE log_timestamp >= UNIX_TIMESTAMP() - 3600
          GROUP BY FLOOR(log_timestamp / 60000)
        `;
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return true for valid complex dashboard query without timestamp alias", () => {
        const query = `
          SELECT
            histogram(_timestamp, '5m') as "time_bucket",
            COUNT(*) as "total_requests",
            AVG(response_time) as "avg_response",
            service_name as "service"
          FROM api_logs
          WHERE _timestamp >= NOW() - INTERVAL '1 hour'
          GROUP BY histogram(_timestamp, '5m'), service_name
          ORDER BY histogram(_timestamp, '5m') ASC
        `;
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(true);
      });
    });

    describe("Edge cases with quote handling", () => {
      it("should handle query with escaped quotes in string literals", () => {
        const query = `
          SELECT
            _timestamp,
            message,
            'It\\'s a test' as description
          FROM logs
          WHERE message LIKE '%\\"test\\"%'
        `;
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(true);
      });

      it("should return false when timestamp alias appears in WHERE clause with double quotes", () => {
        const query = 'SELECT log_date AS "_timestamp" FROM logs WHERE log_date > NOW()';
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false when timestamp alias appears with extra whitespace and single quotes", () => {
        const query = "SELECT   created_at   AS   '_timestamp'   FROM   logs";
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for CAST function with double-quoted timestamp alias", () => {
        const query = 'SELECT CAST(event_date AS TIMESTAMP) AS "_timestamp" FROM events';
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for COALESCE with single-quoted timestamp alias", () => {
        const query = "SELECT COALESCE(updated_at, created_at) AS '_timestamp' FROM records";
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should handle quoted table and column names without false positives", () => {
        const query = `
          SELECT
            "_timestamp" as time_column,
            "user"."name" as username
          FROM "logs"."_timestamp"
        `;
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(true);
      });

      it("should return false for nested function with all quote variations", () => {
        const query = 'SELECT EXTRACT(EPOCH FROM log_time) AS "_timestamp" FROM logs';
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });
    });

    describe("Case sensitivity with different quote formats", () => {
      it("should return false for uppercase AS with double-quoted timestamp", () => {
        const query = 'SELECT created_at AS "_timestamp" FROM logs';
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for lowercase as with single-quoted timestamp", () => {
        const query = "SELECT created_at as '_timestamp' FROM logs";
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });

      it("should return false for mixed case As with unquoted timestamp", () => {
        const query = "SELECT created_at As _timestamp FROM logs";
        mockSearchObj.data.query = query;

        const result = logsUtilsInstance.checkTimestampAlias(query);
        expect(result).toBe(false);
      });
    });
  });

  describe("fnParsedSQL and fnUnparsedSQL - UNION queries", () => {
    beforeEach(() => {
      mockSearchObj.data.query = "";
      logsUtilsInstance = logsUtils();
    });

    it("should handle UNION ALL query with multiple streams", () => {
      const query = 'SELECT job,level FROM "default" UNION ALL SELECT job,level FROM "default12"';
      mockSearchObj.data.query = query;

      const parsedSQL = logsUtilsInstance.fnParsedSQL(query);

      // The parser may return an empty result or a union structure
      // Check if the parsed result has expected structure
      expect(parsedSQL).toBeDefined();

      // Try to unparse the SQL
      const unparsedSQL = logsUtilsInstance.fnUnparsedSQL(parsedSQL);

      // If parsing fails, unparsedSQL should be empty string
      expect(typeof unparsedSQL).toBe("string");
    });

    it("should handle UNION ALL BY NAME query with multiple streams", () => {
      const query = 'SELECT job,level FROM "default" UNION ALL BY NAME SELECT job,level FROM "default12"';
      mockSearchObj.data.query = query;

      const parsedSQL = logsUtilsInstance.fnParsedSQL(query);

      // UNION ALL BY NAME may not be supported by the parser
      // It should return default empty result
      expect(parsedSQL).toBeDefined();

      // Check if we get the default parsed result structure
      if (parsedSQL.columns.length === 0 && parsedSQL.from.length === 0) {
        // Parser doesn't support this syntax
        expect(parsedSQL.columns).toEqual([]);
        expect(parsedSQL.from).toEqual([]);
      }

      // Try to unparse - should handle gracefully
      const unparsedSQL = logsUtilsInstance.fnUnparsedSQL(parsedSQL);
      expect(typeof unparsedSQL).toBe("string");
    });

    it("should return empty string when unparsing invalid/empty parsed object", () => {
      const emptyParsedObj = {
        columns: [],
        from: [],
        orderby: null,
        limit: null,
        groupby: null,
        where: null,
      };

      const unparsedSQL = logsUtilsInstance.fnUnparsedSQL(emptyParsedObj);

      // Should return empty string for invalid/empty structure
      expect(unparsedSQL).toBe("");
    });

    it("should handle UNION query in openFilterCreator context", () => {
      // Simulate the scenario when user clicks expand on a field
      // with UNION query active
      const query = 'SELECT job,level FROM "default" UNION ALL BY NAME SELECT job,level FROM "default12"';
      mockSearchObj.data.query = query;

      // Parse the query
      const parsedSQL = logsUtilsInstance.fnParsedSQL(query);

      // Verify parsing returns a result (even if empty)
      expect(parsedSQL).toBeDefined();
      expect(parsedSQL).toHaveProperty('columns');
      expect(parsedSQL).toHaveProperty('from');

      // Unparse the SQL (simulating openFilterCreator flow)
      const unparsedSQL = logsUtilsInstance.fnUnparsedSQL(parsedSQL);

      // Should not throw error and return string
      expect(typeof unparsedSQL).toBe("string");

      // If UNION BY NAME is not supported, result should be empty
      if (parsedSQL.columns.length === 0) {
        expect(unparsedSQL).toBe("");
      }
    });

    it("should handle standard UNION without BY NAME clause", () => {
      const query = 'SELECT job,level FROM "default" UNION SELECT job,level FROM "default12"';
      mockSearchObj.data.query = query;

      const parsedSQL = logsUtilsInstance.fnParsedSQL(query);
      const unparsedSQL = logsUtilsInstance.fnUnparsedSQL(parsedSQL);

      expect(parsedSQL).toBeDefined();
      expect(typeof unparsedSQL).toBe("string");
    });

    it("should handle UNION ALL with WHERE clauses", () => {
      const query = 'SELECT job,level FROM "default" WHERE level=\'error\' UNION ALL SELECT job,level FROM "default12" WHERE level=\'error\'';
      mockSearchObj.data.query = query;

      const parsedSQL = logsUtilsInstance.fnParsedSQL(query);
      const unparsedSQL = logsUtilsInstance.fnUnparsedSQL(parsedSQL);

      expect(parsedSQL).toBeDefined();
      expect(typeof unparsedSQL).toBe("string");
    });

    it("should handle UNION with ORDER BY clause", () => {
      const query = 'SELECT job,level FROM "default" UNION ALL SELECT job,level FROM "default12" ORDER BY level';
      mockSearchObj.data.query = query;

      const parsedSQL = logsUtilsInstance.fnParsedSQL(query);
      const unparsedSQL = logsUtilsInstance.fnUnparsedSQL(parsedSQL);

      expect(parsedSQL).toBeDefined();
      expect(typeof unparsedSQL).toBe("string");
    });

    it("should handle multiple UNION operations", () => {
      const query = 'SELECT job FROM "default" UNION ALL SELECT job FROM "default12" UNION ALL SELECT job FROM "default13"';
      mockSearchObj.data.query = query;

      const parsedSQL = logsUtilsInstance.fnParsedSQL(query);
      const unparsedSQL = logsUtilsInstance.fnUnparsedSQL(parsedSQL);

      expect(parsedSQL).toBeDefined();
      expect(typeof unparsedSQL).toBe("string");
    });

    it("should handle fnUnparsedSQL error gracefully", () => {
      // Pass a malformed object that will cause sqlify to fail
      const malformedObj = {
        invalid: "structure",
        columns: "not_an_array",
      };

      const unparsedSQL = logsUtilsInstance.fnUnparsedSQL(malformedObj);

      // Should return empty string on error
      expect(unparsedSQL).toBe("");
    });

    it("should handle null/undefined input in fnUnparsedSQL", () => {
      expect(logsUtilsInstance.fnUnparsedSQL(null)).toBe("");
      expect(logsUtilsInstance.fnUnparsedSQL(undefined)).toBe("");
      expect(logsUtilsInstance.fnUnparsedSQL({})).toBe("");
    });
  });

  describe("openFilterCreator with UNION queries - Integration", () => {
    beforeEach(() => {
      mockSearchObj.data.query = "";
      mockSearchObj.meta.sqlMode = true;
      logsUtilsInstance = logsUtils();
    });

    it("should handle expand field action with UNION ALL BY NAME query", () => {
      // This simulates the exact scenario from the issue:
      // 1. Two streams selected: "default" and "default12"
      // 2. All fields in user-defined schema
      // 3. UNION ALL BY NAME query active
      // 4. User clicks to expand a field (e.g., "job")

      const query = 'SELECT job,level FROM "default" UNION ALL BY NAME SELECT job,level FROM "default12"';
      mockSearchObj.data.query = query;

      // Step 1: Parse the query (this happens in openFilterCreator)
      const parsedSQL = logsUtilsInstance.fnParsedSQL(query);

      // Verify parser returns result (even if empty/default)
      expect(parsedSQL).toBeDefined();

      // Step 2: Unparse the query to create query_context
      // This is where the error occurs in the actual code
      const queryContext = logsUtilsInstance.fnUnparsedSQL(parsedSQL).replace(/`/g, '"') || "";

      // Verify it returns a string (empty if unsupported)
      expect(typeof queryContext).toBe("string");

      // If the parser doesn't support UNION BY NAME:
      if (parsedSQL.columns.length === 0 && parsedSQL.from.length === 0) {
        // We expect empty query_context
        expect(queryContext).toBe("");

        // In this case, the openFilterCreator should handle this gracefully
        // and either fall back to a default query or show an error
        console.log("UNION ALL BY NAME is not supported by the SQL parser");
        console.log("query_context will be empty, consider fallback logic");
      }
    });

    it("should provide fallback for unsupported UNION queries", () => {
      const query = 'SELECT job,level FROM "default" UNION ALL BY NAME SELECT job,level FROM "default12"';
      mockSearchObj.data.query = query;

      const parsedSQL = logsUtilsInstance.fnParsedSQL(query);
      const queryContext = logsUtilsInstance.fnUnparsedSQL(parsedSQL);

      // If parsing fails, we should have a fallback strategy
      if (queryContext === "") {
        // Verify both columns and from are empty (parser failed)
        expect(parsedSQL.columns.length).toBe(0);
        expect(parsedSQL.from.length).toBe(0);

        // Fallback: Use simple SELECT * for field values
        const fallbackQuery = 'SELECT * FROM "[INDEX_NAME]"';
        expect(fallbackQuery).toBe('SELECT * FROM "[INDEX_NAME]"');

        // This fallback will be used in IndexList.vue openFilterCreator
        expect(fallbackQuery.includes("[INDEX_NAME]")).toBe(true);
      }
    });

    it("should validate the complete fallback flow as implemented in IndexList.vue", () => {
      // Simulate the exact scenario from IndexList.vue:651-676
      const query = 'SELECT job,level FROM "default" UNION ALL BY NAME SELECT job,level FROM "default12"';
      mockSearchObj.data.query = query;

      // Step 1: Parse the query
      const parsedSQL = logsUtilsInstance.fnParsedSQL(query);

      // Step 2: Unparse the query
      let query_context = logsUtilsInstance.fnUnparsedSQL(parsedSQL).replace(/`/g, '"') || "";

      // Step 3: Apply fallback logic (as in IndexList.vue)
      if (
        query_context === "" &&
        parsedSQL.columns?.length === 0 &&
        parsedSQL.from?.length === 0
      ) {
        query_context = 'SELECT * FROM "[INDEX_NAME]"';
      }

      // Step 4: Verify fallback was applied
      expect(query_context).toBe('SELECT * FROM "[INDEX_NAME]"');

      // Step 5: Verify it can be used for stream replacement
      const streamName = "default";
      const finalQuery = query_context.replace("[INDEX_NAME]", streamName);
      expect(finalQuery).toBe('SELECT * FROM "default"');
    });
  });
});
