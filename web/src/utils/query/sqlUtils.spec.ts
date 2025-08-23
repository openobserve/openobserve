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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { 
  buildSqlQuery, 
  convertQueryIntoSingleLine 
} from "./sqlUtils";

// Mock the imported modules
vi.mock("@/utils/zincutils", () => ({
  splitQuotedString: vi.fn((str: string) => str.split(" ")),
  escapeSingleQuotes: vi.fn((str: string) => str.replace(/'/g, "''")),
}));

vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: () => ({
      astify: vi.fn(),
      sqlify: vi.fn(),
    }),
  }),
}));

describe("sqlUtils", () => {
  describe("buildSqlQuery", () => {
    it("should build a simple SQL query with fields array", () => {
      const query = buildSqlQuery("test_table", ["field1", "field2"], "");

      expect(query).toBe('SELECT field1, field2 FROM "test_table"');
    });

    it("should build SQL query with where clause", () => {
      const query = buildSqlQuery("logs", ["*"], "level = 'ERROR'");

      expect(query).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should build SQL query with empty fields array", () => {
      const query = buildSqlQuery("logs", [], "");

      expect(query).toBe('SELECT * FROM "logs"');
    });

    it("should build SQL query with multiple fields", () => {
      const query = buildSqlQuery("application_logs", ["level", "message", "_timestamp"], "level IN ('ERROR', 'WARN')");

      expect(query).toBe('SELECT level, message, _timestamp FROM "application_logs" WHERE level IN (\'ERROR\', \'WARN\')');
    });

    it("should handle empty table name", () => {
      const query = buildSqlQuery("", ["*"], "");

      expect(query).toBe('SELECT * FROM ""');
    });

    it("should handle empty where clause", () => {
      const query = buildSqlQuery("logs", ["level", "message"], "");

      expect(query).toBe('SELECT level, message FROM "logs"');
    });

    it("should handle whitespace-only where clause", () => {
      const query = buildSqlQuery("logs", ["*"], "   ");

      expect(query).toBe('SELECT * FROM "logs"');
    });

    it("should handle complex where clause", () => {
      const query = buildSqlQuery("events", ["timestamp", "event"], "timestamp > '2023-01-01' AND event = 'login'");

      expect(query).toBe('SELECT timestamp, event FROM "events" WHERE timestamp > \'2023-01-01\' AND event = \'login\'');
    });
  });

  describe("convertQueryIntoSingleLine", () => {
    it("should return null for null input", async () => {
      const result = await convertQueryIntoSingleLine(null);
      expect(result).toBe(null);
    });

    it("should return empty string for empty input", async () => {
      const result = await convertQueryIntoSingleLine("");
      expect(result).toBe("");
    });

    it("should return query as-is for invalid SQL", async () => {
      const invalidQuery = "invalid sql syntax";
      const result = await convertQueryIntoSingleLine(invalidQuery);
      expect(result).toBe(invalidQuery);
    });

    it("should return undefined for undefined input", async () => {
      const result = await convertQueryIntoSingleLine(undefined);
      expect(result).toBe(undefined);
    });

    it("should handle whitespace query", async () => {
      const whitespaceQuery = "   \n\t  \n  ";
      const result = await convertQueryIntoSingleLine(whitespaceQuery);
      expect(result).toBe(whitespaceQuery);
    });

    it("should return query unchanged when parser fails", async () => {
      const malformedQuery = "SELECT * FROM";
      const result = await convertQueryIntoSingleLine(malformedQuery);
      expect(result).toBe(malformedQuery);
    });
  });
});