// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import { useTracesTableColumns, LLM_COLUMN_IDS } from "./useTracesTableColumns";

// Default ordered field lists (mirror DEFAULT_TRACE_COLUMNS in useTraces.ts)
const DEFAULT_SPANS_FIELDS = [
  "_timestamp",
  "service",
  "operation_name",
  "duration",
  "status",
  "status_code",
  "method",
];
const DEFAULT_TRACES_FIELDS = [
  "_timestamp",
  "service",
  "operation_name",
  "duration",
  "spans",
  "status",
  "service_latency",
];

/** Helper: create composable and immediately call buildColumns. Returns columns.value. */
function buildCols(
  showLlmColumns: boolean,
  searchMode: "traces" | "spans",
  selectedFields: string[],
) {
  const { buildColumns } = useTracesTableColumns();
  return buildColumns(showLlmColumns, searchMode, selectedFields);
}

describe("useTracesTableColumns", () => {
  // ── LLM_COLUMN_IDS export ─────────────────────────────────────────────────

  describe("LLM_COLUMN_IDS", () => {
    it("should contain input_tokens, output_tokens, cost", () => {
      expect(LLM_COLUMN_IDS.has("input_tokens")).toBe(true);
      expect(LLM_COLUMN_IDS.has("output_tokens")).toBe(true);
      expect(LLM_COLUMN_IDS.has("cost")).toBe(true);
    });
  });

  // ── spans mode ────────────────────────────────────────────────────────────

  describe("spans mode — default fields", () => {
    it("should return 7 columns matching the default spans field order", () => {
      const cols = buildCols(false, "spans", [...DEFAULT_SPANS_FIELDS]);
      expect(cols.map((c) => c.id)).toEqual(DEFAULT_SPANS_FIELDS);
    });

    it("should NOT include spans or service_latency", () => {
      const ids = buildCols(false, "spans", [...DEFAULT_SPANS_FIELDS]).map(
        (c) => c.id,
      );
      expect(ids).not.toContain("spans");
      expect(ids).not.toContain("service_latency");
    });

    it("should NOT include LLM columns even when showLlmColumns is true", () => {
      const ids = buildCols(true, "spans", [...DEFAULT_SPANS_FIELDS]).map(
        (c) => c.id,
      );
      expect(ids).not.toContain("input_tokens");
      expect(ids).not.toContain("output_tokens");
      expect(ids).not.toContain("cost");
    });
  });

  describe("spans mode — user removes status_code", () => {
    it("should not include status_code when absent from selectedFields", () => {
      const fields = DEFAULT_SPANS_FIELDS.filter((f) => f !== "status_code");
      const cols = buildCols(false, "spans", fields);
      expect(cols.map((c) => c.id)).not.toContain("status_code");
      expect(cols).toHaveLength(6);
    });
  });

  describe("spans mode — empty selectedFields", () => {
    it("should return 1 column with timestamp", () => {
      expect(buildCols(false, "spans", [])).toHaveLength(1);
    });
  });

  describe("spans mode — custom extra field added", () => {
    it("should include the custom field at the end", () => {
      const fields = [...DEFAULT_SPANS_FIELDS, "http_url"];
      const ids = buildCols(false, "spans", fields).map((c) => c.id);
      expect(ids).toContain("http_url");
      expect(ids[ids.length - 1]).toBe("http_url");
    });

    it("should use a prettified header for unknown field names", () => {
      const cols = buildCols(false, "spans", ["http_url"]);
      expect(cols.find((c) => c.id === "http_url")?.header).toBe("Http Url");
    });
  });

  describe("spans mode — user reorders columns", () => {
    it("should respect a custom field order", () => {
      const reordered = [
        "service",
        "_timestamp",
        "status_code",
        "operation_name",
        "duration",
        "status",
        "method",
      ];
      expect(buildCols(false, "spans", reordered).map((c) => c.id)).toEqual(
        reordered,
      );
    });
  });

  // ── known column metadata ─────────────────────────────────────────────────

  describe("known column metadata", () => {
    it("should use correct header and size for status_code", () => {
      const col = buildCols(false, "spans", ["status_code"]).find(
        (c) => c.id === "status_code",
      );
      expect(col?.header).toBe("Status Code");
      expect(col?.size).toBe(140);
    });

    it("should use correct header and size for method", () => {
      const col = buildCols(false, "spans", ["method"]).find(
        (c) => c.id === "method",
      );
      expect(col?.header).toBe("Method");
      expect(col?.size).toBe(140);
    });
  });

  // ── traces mode ───────────────────────────────────────────────────────────

  describe("traces mode — default fields, no LLM", () => {
    it("should return 7 columns matching the default traces field order", () => {
      const cols = buildCols(false, "traces", [...DEFAULT_TRACES_FIELDS]);
      expect(cols.map((c) => c.id)).toEqual(DEFAULT_TRACES_FIELDS);
    });

    it("should NOT include input_tokens, output_tokens, cost", () => {
      const ids = buildCols(false, "traces", [...DEFAULT_TRACES_FIELDS]).map(
        (c) => c.id,
      );
      expect(ids).not.toContain("input_tokens");
      expect(ids).not.toContain("output_tokens");
      expect(ids).not.toContain("cost");
    });
  });

  describe("traces mode — with LLM columns", () => {
    it("should inject LLM columns before service_latency", () => {
      const ids = buildCols(true, "traces", [...DEFAULT_TRACES_FIELDS]).map(
        (c) => c.id,
      );
      const latencyIdx = ids.indexOf("service_latency");
      const inputIdx = ids.indexOf("input_tokens");
      const outputIdx = ids.indexOf("output_tokens");
      const costIdx = ids.indexOf("cost");

      expect(inputIdx).toBe(latencyIdx - 3);
      expect(outputIdx).toBe(latencyIdx - 2);
      expect(costIdx).toBe(latencyIdx - 1);
    });

    it("should keep service_latency as the last column", () => {
      const ids = buildCols(true, "traces", [...DEFAULT_TRACES_FIELDS]).map(
        (c) => c.id,
      );
      expect(ids[ids.length - 1]).toBe("service_latency");
    });

    it("should return 10 columns total", () => {
      expect(
        buildCols(true, "traces", [...DEFAULT_TRACES_FIELDS]),
      ).toHaveLength(10);
    });

    it("should append LLM columns at the end when service_latency is absent", () => {
      const fieldsWithoutLatency = DEFAULT_TRACES_FIELDS.filter(
        (f) => f !== "service_latency",
      );
      const ids = buildCols(true, "traces", fieldsWithoutLatency).map(
        (c) => c.id,
      );
      expect(ids[ids.length - 1]).toBe("cost");
      expect(ids).toContain("input_tokens");
    });
  });

  describe("traces mode — user reorders columns", () => {
    it("should respect a custom field order", () => {
      const reordered = [
        "service",
        "_timestamp",
        "spans",
        "operation_name",
        "duration",
        "status",
        "service_latency",
      ];
      expect(buildCols(false, "traces", reordered).map((c) => c.id)).toEqual(
        reordered,
      );
    });
  });

  // ── buildColumns called multiple times ────────────────────────────────────

  describe("buildColumns called multiple times", () => {
    it("should update columns.value on each call", () => {
      const { columns, buildColumns } = useTracesTableColumns();

      buildColumns(false, "spans", [...DEFAULT_SPANS_FIELDS]);
      expect(columns.value.map((c) => c.id)).toEqual(DEFAULT_SPANS_FIELDS);

      buildColumns(false, "traces", [...DEFAULT_TRACES_FIELDS]);
      expect(columns.value.map((c) => c.id)).toEqual(DEFAULT_TRACES_FIELDS);
    });

    it("should add LLM columns when buildColumns called with showLlmColumns=true", () => {
      const { columns, buildColumns } = useTracesTableColumns();

      buildColumns(false, "traces", [...DEFAULT_TRACES_FIELDS]);
      expect(columns.value.map((c) => c.id)).not.toContain("input_tokens");

      buildColumns(true, "traces", [...DEFAULT_TRACES_FIELDS]);
      expect(columns.value.map((c) => c.id)).toContain("input_tokens");
      expect(columns.value.map((c) => c.id)).toContain("output_tokens");
      expect(columns.value.map((c) => c.id)).toContain("cost");
    });

    it("should remove LLM columns when buildColumns called with showLlmColumns=false", () => {
      const { columns, buildColumns } = useTracesTableColumns();

      buildColumns(true, "traces", [...DEFAULT_TRACES_FIELDS]);
      expect(columns.value.map((c) => c.id)).toContain("input_tokens");

      buildColumns(false, "traces", [...DEFAULT_TRACES_FIELDS]);
      expect(columns.value.map((c) => c.id)).not.toContain("input_tokens");
    });

    it("should reflect updated selectedFields on subsequent call", () => {
      const { columns, buildColumns } = useTracesTableColumns();

      buildColumns(false, "spans", [...DEFAULT_SPANS_FIELDS]);
      expect(columns.value.map((c) => c.id)).not.toContain("http_url");

      buildColumns(false, "spans", [...DEFAULT_SPANS_FIELDS, "http_url"]);
      expect(columns.value.map((c) => c.id)).toContain("http_url");
    });

    it("should remove column when field removed in subsequent call", () => {
      const { columns, buildColumns } = useTracesTableColumns();

      buildColumns(false, "spans", [...DEFAULT_SPANS_FIELDS]);
      expect(columns.value.map((c) => c.id)).toContain("method");

      buildColumns(
        false,
        "spans",
        DEFAULT_SPANS_FIELDS.filter((f) => f !== "method"),
      );
      expect(columns.value.map((c) => c.id)).not.toContain("method");
    });

    it("should reorder columns when selectedFields order changes in subsequent call", () => {
      const { columns, buildColumns } = useTracesTableColumns();

      buildColumns(false, "spans", ["_timestamp", "service", "status_code"]);
      expect(columns.value.map((c) => c.id)).toEqual([
        "_timestamp",
        "service",
        "status_code",
      ]);

      buildColumns(false, "spans", ["status_code", "_timestamp", "service"]);
      expect(columns.value.map((c) => c.id)).toEqual([
        "status_code",
        "_timestamp",
        "service",
      ]);
    });
  });
});
