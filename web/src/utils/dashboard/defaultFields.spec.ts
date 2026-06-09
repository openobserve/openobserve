// Copyright 2026 OpenObserve Inc.
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
import {
  DEFAULT_SQL_X_FIELD,
  DEFAULT_SQL_Y_FIELD_COUNT,
  DEFAULT_SQL_Y_FIELD_VALUE,
  hasValueColumn,
  buildDefaultSqlFields,
  buildDefaultBuilderFields,
  SKIP_SEED_TYPES,
} from "./defaultFields";

describe("defaultFields", () => {
  describe("field factories", () => {
    it("DEFAULT_SQL_X_FIELD is histogram(_timestamp) on x_axis_1", () => {
      const x = DEFAULT_SQL_X_FIELD();
      expect(x).toMatchObject({
        alias: "x_axis_1",
        column: "_timestamp",
        functionName: "histogram",
        type: "build",
        sortBy: "ASC",
      });
      expect(x.args[0]).toEqual({
        type: "field",
        value: { field: "_timestamp" },
      });
    });

    it("DEFAULT_SQL_Y_FIELD_COUNT is count(_timestamp) on y_axis_1", () => {
      const y = DEFAULT_SQL_Y_FIELD_COUNT();
      expect(y).toMatchObject({
        alias: "y_axis_1",
        column: "_timestamp",
        functionName: "count",
      });
    });

    it("DEFAULT_SQL_Y_FIELD_VALUE is avg(value) on y_axis_1", () => {
      const y = DEFAULT_SQL_Y_FIELD_VALUE();
      expect(y).toMatchObject({
        alias: "y_axis_1",
        column: "value",
        functionName: "avg",
      });
    });

    it("returns a fresh object each call (factory, not shared ref)", () => {
      const a = DEFAULT_SQL_X_FIELD();
      const b = DEFAULT_SQL_X_FIELD();
      expect(a).not.toBe(b);
      expect(a.args).not.toBe(b.args);
    });
  });

  describe("hasValueColumn", () => {
    const withValue = { name: "m1", schema: [{ name: "value" }, { name: "le" }] };
    const noValue = { name: "logs", schema: [{ name: "_timestamp" }] };

    it("returns false for empty / nullish input", () => {
      expect(hasValueColumn([])).toBe(false);
      expect(hasValueColumn(undefined as any)).toBe(false);
    });

    it("returns true when any stream has a value column (no streamName)", () => {
      expect(hasValueColumn([noValue, withValue])).toBe(true);
    });

    it("returns false when no stream has a value column", () => {
      expect(hasValueColumn([noValue])).toBe(false);
    });

    it("scopes the check to the named stream only", () => {
      // join: main stream has no value, joined stream does
      const grouped = [noValue, withValue];
      expect(hasValueColumn(grouped, "logs")).toBe(false);
      expect(hasValueColumn(grouped, "m1")).toBe(true);
    });

    it("returns false when the named stream is absent", () => {
      expect(hasValueColumn([withValue], "missing")).toBe(false);
    });
  });

  describe("buildDefaultSqlFields", () => {
    const metricWithValue = [{ name: "m1", schema: [{ name: "value" }] }];
    const logsSchema = [{ name: "logs", schema: [{ name: "_timestamp" }] }];

    it("logs -> histogram(_timestamp) + count(_timestamp)", () => {
      const { x, y } = buildDefaultSqlFields("logs", logsSchema, "logs");
      expect(x[0].functionName).toBe("histogram");
      expect(y[0].functionName).toBe("count");
    });

    it("traces -> count(_timestamp) even if a value column exists", () => {
      const traces = [{ name: "t1", schema: [{ name: "value" }] }];
      const { y } = buildDefaultSqlFields("traces", traces, "t1");
      expect(y[0].functionName).toBe("count");
    });

    it("metrics with value column -> avg(value)", () => {
      const { y } = buildDefaultSqlFields("metrics", metricWithValue, "m1");
      expect(y[0].functionName).toBe("avg");
      expect(y[0].column).toBe("value");
    });

    it("metrics without value column -> count(_timestamp)", () => {
      const { y } = buildDefaultSqlFields("metrics", logsSchema, "logs");
      expect(y[0].functionName).toBe("count");
    });

    it("metrics: value column on a different (join) stream -> count for the main stream", () => {
      const grouped = [
        { name: "main", schema: [{ name: "_timestamp" }] },
        { name: "joined", schema: [{ name: "value" }] },
      ];
      const { y } = buildDefaultSqlFields("metrics", grouped, "main");
      expect(y[0].functionName).toBe("count");
    });

    it("always seeds exactly one x and one y field", () => {
      const { x, y } = buildDefaultSqlFields("logs", logsSchema, "logs");
      expect(x).toHaveLength(1);
      expect(y).toHaveLength(1);
    });
  });

  describe("buildDefaultBuilderFields", () => {
    const logsSchema = [{ name: "logs", schema: [{ name: "_timestamp" }] }];

    it("cartesian chart (bar): seeds histogram x + count y", () => {
      const { x, y } = buildDefaultBuilderFields("bar", "logs", logsSchema, "logs");
      expect(x).toHaveLength(1);
      expect(x[0].functionName).toBe("histogram");
      expect(y).toHaveLength(1);
      expect(y[0].functionName).toBe("count");
    });

    it("metric: seeds y only (no x-axis)", () => {
      const { x, y } = buildDefaultBuilderFields("metric", "logs", logsSchema, "logs");
      expect(x).toHaveLength(0);
      expect(y).toHaveLength(1);
      expect(y[0].functionName).toBe("count");
    });

    it.each(SKIP_SEED_TYPES)("%s: seeds nothing (self-driven builder)", (type) => {
      const { x, y } = buildDefaultBuilderFields(type, "logs", logsSchema, "logs");
      expect(x).toHaveLength(0);
      expect(y).toHaveLength(0);
    });

    it("metrics stream with value column: seeds avg(value) y", () => {
      const grouped = [{ name: "m1", schema: [{ name: "value" }] }];
      const { y } = buildDefaultBuilderFields("bar", "metrics", grouped, "m1");
      expect(y[0].functionName).toBe("avg");
    });
  });
});
