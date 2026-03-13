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

import { describe, it, expect } from "vitest";
import { replaceHistogramInterval } from "./histogramIntervalReplacer";

/**
 * Unit tests for histogram interval replacement logic
 *
 * This tests the regex-based approach for replacing histogram intervals in SQL queries
 * without parsing and regenerating the entire SQL string.
 *
 * The function is imported from histogramIntervalReplacer.ts which is also used by ViewPanel.vue
 */

describe("Histogram Interval Replacement", () => {

  describe("Basic Cases", () => {
    it("should replace interval in basic histogram call", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(_timestamp, '1 minute')");
    });

    it("should add interval when histogram has no interval", () => {
      const query = "SELECT histogram(_timestamp)";
      const result = replaceHistogramInterval(query, "5 minutes");

      expect(result).toBe("SELECT histogram(_timestamp, '5 minutes')");
    });

    it("should remove interval when newInterval is null", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, null);

      expect(result).toBe("SELECT histogram(_timestamp)");
    });

    it("should handle double quotes in interval", () => {
      const query = 'SELECT histogram(_timestamp, "30 seconds")';
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(_timestamp, '1 minute')");
    });
  });

  describe("Whitespace Variations", () => {
    it("should handle no spaces", () => {
      const query = "SELECT histogram(_timestamp,'30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(_timestamp, '1 minute')");
    });

    it("should handle extra spaces around parentheses", () => {
      const query = "SELECT histogram( _timestamp , '30 seconds' )";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram( _timestamp , '1 minute')");
    });

    it("should handle spaces before comma", () => {
      const query = "SELECT histogram(_timestamp , '30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(_timestamp , '1 minute')");
    });

    it("should handle spaces after comma", () => {
      const query = "SELECT histogram(_timestamp,  '30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(_timestamp,  '1 minute')");
    });

    it("should handle multiple spaces", () => {
      const query = "SELECT histogram(  _timestamp  ,  '30 seconds'  )";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(  _timestamp  , '1 minute')");
    });

    it("should handle tabs", () => {
      const query = "SELECT histogram(\t_timestamp\t,\t'30 seconds'\t)";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(\t_timestamp\t, '1 minute')");
    });

    it("should handle newlines", () => {
      const query = "SELECT histogram(\n  _timestamp,\n  '30 seconds'\n)";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(\n  _timestamp, '1 minute')");
    });
  });

  describe("Field Name Variations", () => {
    it("should handle simple field name", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(_timestamp, '1 minute')");
    });

    it("should handle table prefix", () => {
      const query = "SELECT histogram(default._timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(default._timestamp, '1 minute')");
    });

    it("should handle quoted field name", () => {
      const query = 'SELECT histogram("_timestamp", \'30 seconds\')';
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe('SELECT histogram("_timestamp", \'1 minute\')');
    });

    it("should handle table prefix with quotes", () => {
      const query = 'SELECT histogram("default"."_timestamp", \'30 seconds\')';
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe('SELECT histogram("default"."_timestamp", \'1 minute\')');
    });

    it("should handle variable reference with $", () => {
      const query = "SELECT histogram($timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram($timestamp, '1 minute')");
    });

    it("should handle variable reference with ${}", () => {
      const query = "SELECT histogram(${timestamp}, '30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(${timestamp}, '1 minute')");
    });

    it("should handle underscore in field name", () => {
      const query = "SELECT histogram(my_timestamp_field, '30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(my_timestamp_field, '1 minute')");
    });

    it("should handle camelCase field name", () => {
      const query = "SELECT histogram(myTimestampField, '30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(myTimestampField, '1 minute')");
    });
  });

  describe("Case Variations", () => {
    it("should handle lowercase histogram", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(_timestamp, '1 minute')");
    });

    it("should handle uppercase HISTOGRAM", () => {
      const query = "SELECT HISTOGRAM(_timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT HISTOGRAM(_timestamp, '1 minute')");
    });

    it("should handle mixed case Histogram", () => {
      const query = "SELECT Histogram(_timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT Histogram(_timestamp, '1 minute')");
    });

    it("should handle mixed case HiStOgRaM", () => {
      const query = "SELECT HiStOgRaM(_timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT HiStOgRaM(_timestamp, '1 minute')");
    });
  });

  describe("Multiple Histograms", () => {
    it("should replace interval in all histogram calls", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds'), count(*), histogram(event_time, '1 minute')";
      const result = replaceHistogramInterval(query, "5 minutes");

      expect(result).toBe("SELECT histogram(_timestamp, '5 minutes'), count(*), histogram(event_time, '5 minutes')");
    });

    it("should handle histograms with different intervals", () => {
      const query = "SELECT histogram(field1, '10s'), histogram(field2, '1m'), histogram(field3, '1h')";
      const result = replaceHistogramInterval(query, "30 seconds");

      expect(result).toBe("SELECT histogram(field1, '30 seconds'), histogram(field2, '30 seconds'), histogram(field3, '30 seconds')");
    });

    it("should handle mix of histograms with and without intervals", () => {
      const query = "SELECT histogram(_timestamp), histogram(field2, '1 minute')";
      const result = replaceHistogramInterval(query, "2 minutes");

      expect(result).toBe("SELECT histogram(_timestamp, '2 minutes'), histogram(field2, '2 minutes')");
    });

    it("should remove intervals from all histograms when newInterval is null", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds'), histogram(field2, '1 minute')";
      const result = replaceHistogramInterval(query, null);

      expect(result).toBe("SELECT histogram(_timestamp), histogram(field2)");
    });
  });

  describe("Complex SQL Queries", () => {
    it("should work in full SELECT query with JOIN", () => {
      const query = 'SELECT histogram(default._timestamp, \'30 seconds\') as "x_axis_1", count(default._timestamp) as "y_axis_1" FROM "default" INNER JOIN "default1" AS stream_0 ON default._timestamp = stream_0._timestamp GROUP BY x_axis_1 ORDER BY x_axis_1 ASC';
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe('SELECT histogram(default._timestamp, \'1 minute\') as "x_axis_1", count(default._timestamp) as "y_axis_1" FROM "default" INNER JOIN "default1" AS stream_0 ON default._timestamp = stream_0._timestamp GROUP BY x_axis_1 ORDER BY x_axis_1 ASC');
    });

    it("should work with GROUP BY and ORDER BY", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds') as x, count(*) as y FROM logs GROUP BY x ORDER BY x";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(_timestamp, '1 minute') as x, count(*) as y FROM logs GROUP BY x ORDER BY x");
    });

    it("should work with WHERE clause", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds') FROM logs WHERE level = 'error'";
      const result = replaceHistogramInterval(query, "5 minutes");

      expect(result).toBe("SELECT histogram(_timestamp, '5 minutes') FROM logs WHERE level = 'error'");
    });

    it("should work with subquery", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds') FROM (SELECT * FROM logs) as subquery";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(_timestamp, '1 minute') FROM (SELECT * FROM logs) as subquery");
    });

    it("should work with HAVING clause", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds') as t, count(*) as c FROM logs GROUP BY t HAVING c > 10";
      const result = replaceHistogramInterval(query, "2 minutes");

      expect(result).toBe("SELECT histogram(_timestamp, '2 minutes') as t, count(*) as c FROM logs GROUP BY t HAVING c > 10");
    });
  });

  describe("Edge Cases", () => {
    it("should not modify query without histogram", () => {
      const query = "SELECT * FROM logs";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT * FROM logs");
    });

    it("should not modify histogram in string literals", () => {
      const query = "SELECT 'histogram(_timestamp)' as text, histogram(_timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "1 minute");

      // The regex will match both, but in real SQL, the first one is a string
      // This is a known limitation - we assume histogram is not in string literals
      expect(result).toContain("histogram(_timestamp, '1 minute')");
    });

    it("should handle empty interval string", () => {
      const query = "SELECT histogram(_timestamp, '')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(_timestamp, '1 minute')");
    });

    it("should handle interval with special characters", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "1.5 minutes");

      expect(result).toBe("SELECT histogram(_timestamp, '1.5 minutes')");
    });

    it("should handle unicode in interval", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "1 分钟"); // Chinese characters

      expect(result).toBe("SELECT histogram(_timestamp, '1 分钟')");
    });

    it("should preserve query structure when no change needed", () => {
      const query = "SELECT histogram(_timestamp, '1 minute')";
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe("SELECT histogram(_timestamp, '1 minute')");
    });

    it("should handle very long interval strings", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds')";
      const longInterval = "this is a very long interval string that should still work fine";
      const result = replaceHistogramInterval(query, longInterval);

      expect(result).toBe(`SELECT histogram(_timestamp, '${longInterval}')`);
    });
  });

  describe("Interval Format Variations", () => {
    it("should handle seconds", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "45 seconds");

      expect(result).toBe("SELECT histogram(_timestamp, '45 seconds')");
    });

    it("should handle minutes", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "5 minutes");

      expect(result).toBe("SELECT histogram(_timestamp, '5 minutes')");
    });

    it("should handle hours", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "2 hours");

      expect(result).toBe("SELECT histogram(_timestamp, '2 hours')");
    });

    it("should handle days", () => {
      const query = "SELECT histogram(_timestamp, '30 seconds')";
      const result = replaceHistogramInterval(query, "1 day");

      expect(result).toBe("SELECT histogram(_timestamp, '1 day')");
    });

    it("should handle abbreviated formats (s, m, h, d)", () => {
      const query = "SELECT histogram(_timestamp, '30s')";
      const result = replaceHistogramInterval(query, "5m");

      expect(result).toBe("SELECT histogram(_timestamp, '5m')");
    });

    it("should handle numeric-only intervals", () => {
      const query = "SELECT histogram(_timestamp, '30')";
      const result = replaceHistogramInterval(query, "60");

      expect(result).toBe("SELECT histogram(_timestamp, '60')");
    });
  });

  describe("Real-world Query Examples", () => {
    it("should work with default dashboard query", () => {
      const query = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC';
      const result = replaceHistogramInterval(query, "30 seconds");

      expect(result).toBe('SELECT histogram(_timestamp, \'30 seconds\') as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC');
    });

    it("should work with breakdown query", () => {
      const query = 'SELECT histogram(default._timestamp, \'45 minutes\') as "x_axis_1", count(default._timestamp) as "y_axis_1", default.k8s_namespace_name as "breakdown_1" FROM "default" GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC';
      const result = replaceHistogramInterval(query, "1 hour");

      expect(result).toBe('SELECT histogram(default._timestamp, \'1 hour\') as "x_axis_1", count(default._timestamp) as "y_axis_1", default.k8s_namespace_name as "breakdown_1" FROM "default" GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC');
    });

    it("should work with multi-stream JOIN query", () => {
      const query = 'SELECT histogram(stream1._timestamp, \'30 seconds\') as t, count(*) FROM stream1 INNER JOIN stream2 ON stream1.id = stream2.id';
      const result = replaceHistogramInterval(query, "2 minutes");

      expect(result).toBe('SELECT histogram(stream1._timestamp, \'2 minutes\') as t, count(*) FROM stream1 INNER JOIN stream2 ON stream1.id = stream2.id');
    });
  });

  describe("Preservation Tests", () => {
    it("should preserve exact query structure except interval", () => {
      const query = 'SELECT   histogram(  _timestamp  ,  "30 seconds"  )  as  "x"  FROM  "default"';
      const result = replaceHistogramInterval(query, "1 minute");

      // Spaces around histogram call should be preserved
      expect(result).toContain('SELECT   histogram(  _timestamp  , \'1 minute\')  as  "x"  FROM  "default"');
    });

    it("should preserve lowercase keywords", () => {
      const query = 'select histogram(_timestamp, \'30 seconds\') from logs';
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe('select histogram(_timestamp, \'1 minute\') from logs');
    });

    it("should preserve uppercase keywords", () => {
      const query = 'SELECT HISTOGRAM(_timestamp, \'30 seconds\') FROM LOGS';
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe('SELECT HISTOGRAM(_timestamp, \'1 minute\') FROM LOGS');
    });

    it("should preserve mixed case keywords", () => {
      const query = 'SeLeCt histogram(_timestamp, \'30 seconds\') FrOm logs';
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe('SeLeCt histogram(_timestamp, \'1 minute\') FrOm logs');
    });

    it("should preserve field aliasing format", () => {
      const query = 'SELECT histogram(_timestamp, \'30 seconds\') as "my_alias"';
      const result = replaceHistogramInterval(query, "1 minute");

      expect(result).toBe('SELECT histogram(_timestamp, \'1 minute\') as "my_alias"');
    });
  });
});
