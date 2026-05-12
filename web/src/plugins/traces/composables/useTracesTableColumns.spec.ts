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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock calls are hoisted — must appear before any imports of the tested module.

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      timezone: "UTC",
      zoConfig: { timestamp_column: "_timestamp" },
    },
  }),
}));

vi.mock("@/utils/zincutils", () => ({
  timestampToTimezoneDate: vi.fn(
    (ms: number, _tz: string, _fmt: string) => `formatted:${ms}`,
  ),
}));

vi.mock("@/utils/traces/constants", () => ({
  SPAN_KIND_MAP: {
    "0": "Unspecified",
    "1": "Internal",
    "2": "Server",
    "3": "Client",
    "4": "Producer",
    "5": "Consumer",
  },
}));

import { useTracesTableColumns, LLM_COLUMN_IDS } from "./useTracesTableColumns";
import { timestampToTimezoneDate } from "@/utils/zincutils";

// Default ordered field lists (mirror DEFAULT_TRACE_COLUMNS in useTraces.ts)
const DEFAULT_SPANS_FIELDS = [
  "_timestamp",
  "service",
  "operation_name",
  "duration",
  "span_status",
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
  afterEach(() => {
    vi.clearAllMocks();
  });

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
        "span_status",
        "method",
      ];
      expect(buildCols(false, "spans", reordered).map((c) => c.id)).toEqual(
        reordered,
      );
    });
  });

  // ── span_kind column metadata and accessorFn ──────────────────────────────

  describe("span_kind column metadata and accessorFn", () => {
    function getSpanKindCol() {
      return buildCols(false, "spans", ["span_kind"]).find(
        (c) => c.id === "span_kind",
      );
    }

    it("should use 'Span Kind' as the header", () => {
      expect(getSpanKindCol()?.header).toBe("Span Kind");
    });

    it("should use size 120", () => {
      expect(getSpanKindCol()?.size).toBe(120);
    });

    it("should have meta.align=center, slot=false, closable=true", () => {
      const meta = getSpanKindCol()?.meta as Record<string, unknown>;
      expect(meta?.align).toBe("center");
      expect(meta?.slot).toBe(false);
      expect(meta?.closable).toBe(true);
    });

    it("should have an accessorFn defined", () => {
      expect(typeof (getSpanKindCol() as any)?.accessorFn).toBe("function");
    });

    it("should return 'Server' when span_kind is '2'", () => {
      const accessorFn = (getSpanKindCol() as any)?.accessorFn as (
        row: any,
      ) => string;
      expect(accessorFn({ span_kind: "2" })).toBe("Server");
    });

    it("should return 'Unspecified' when span_kind is '0'", () => {
      const accessorFn = (getSpanKindCol() as any)?.accessorFn as (
        row: any,
      ) => string;
      expect(accessorFn({ span_kind: "0" })).toBe("Unspecified");
    });

    it("should pass through the raw value when span_kind is unknown (e.g. '99')", () => {
      const accessorFn = (getSpanKindCol() as any)?.accessorFn as (
        row: any,
      ) => string;
      expect(accessorFn({ span_kind: "99" })).toBe("99");
    });

    it("should return empty string when span_kind is undefined", () => {
      const accessorFn = (getSpanKindCol() as any)?.accessorFn as (
        row: any,
      ) => string;
      expect(accessorFn({ span_kind: undefined })).toBe("");
    });

    it("should return empty string when span_kind is missing from the row", () => {
      const accessorFn = (getSpanKindCol() as any)?.accessorFn as (
        row: any,
      ) => string;
      expect(accessorFn({})).toBe("");
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

  // ── span_status column metadata ───────────────────────────────────────────

  describe("span_status column metadata", () => {
    it("should include span_status in default spans fields", () => {
      const ids = buildCols(false, "spans", [...DEFAULT_SPANS_FIELDS]).map(
        (c) => c.id,
      );
      expect(ids).toContain("span_status");
    });

    it("should use 'Span Status' as the header for span_status", () => {
      const col = buildCols(false, "spans", ["span_status"]).find(
        (c) => c.id === "span_status",
      );
      expect(col?.header).toBe("Span Status");
    });

    it("should use size 120 for span_status", () => {
      const col = buildCols(false, "spans", ["span_status"]).find(
        (c) => c.id === "span_status",
      );
      expect(col?.size).toBe(120);
    });

    it("should have slot:true and disableCellAction:true in meta for span_status", () => {
      const col = buildCols(false, "spans", ["span_status"]).find(
        (c) => c.id === "span_status",
      );
      const meta = col?.meta as Record<string, unknown>;
      expect(meta?.slot).toBe(true);
      expect(meta?.disableCellAction).toBe(true);
    });
  });

  // ── spans mode: all columns have meta.sortable = true ─────────────────────

  describe("spans mode — all columns have meta.sortable = true", () => {
    it("should set meta.sortable=true on every column in spans mode", () => {
      const cols = buildCols(false, "spans", [...DEFAULT_SPANS_FIELDS]);
      cols.forEach((col) => {
        const meta = col.meta as Record<string, unknown>;
        expect(meta?.sortable).toBe(true);
      });
    });

    it("should set meta.sortable=true on span_status column in spans mode", () => {
      const col = buildCols(false, "spans", ["span_status"]).find(
        (c) => c.id === "span_status",
      );
      const meta = col?.meta as Record<string, unknown>;
      expect(meta?.sortable).toBe(true);
    });

    it("should set meta.sortable=true on custom unknown columns in spans mode", () => {
      const col = buildCols(false, "spans", ["http_url"]).find(
        (c) => c.id === "http_url",
      );
      const meta = col?.meta as Record<string, unknown>;
      expect(meta?.sortable).toBe(true);
    });

    it("should NOT set meta.sortable=true on all columns in traces mode", () => {
      // In traces mode only columns with sortable in KNOWN_COLUMN_META get it
      const cols = buildCols(false, "traces", [...DEFAULT_TRACES_FIELDS]);
      const sortableCols = cols.filter(
        (c) => (c.meta as Record<string, unknown>)?.sortable === true,
      );
      // Only duration and _timestamp have sortable in traces mode; not all columns
      expect(sortableCols.length).toBeLessThan(cols.length);
    });
  });

  // ── status column has no top-level sortable ───────────────────────────────

  describe("status column — no top-level sortable property", () => {
    it("should not have a top-level sortable property on the status column in traces mode", () => {
      const col = buildCols(false, "traces", ["status"]).find(
        (c) => c.id === "status",
      );
      // sortable is not set at the column-def level (only in meta when in spans mode)
      expect((col as any)?.sortable).toBeUndefined();
    });

    it("should have meta.sortable=true on status column when in spans mode", () => {
      // spans mode sets meta.sortable on all columns
      const col = buildCols(false, "spans", ["status"]).find(
        (c) => c.id === "status",
      );
      const meta = col?.meta as Record<string, unknown>;
      expect(meta?.sortable).toBe(true);
    });
  });

  // ── toColumnDef does not mutate KNOWN_COLUMN_META ─────────────────────────

  describe("toColumnDef — meta spread does not mutate shared KNOWN_COLUMN_META", () => {
    it("should not share meta reference between two calls for span_status", () => {
      const [col1] = buildCols(false, "spans", ["span_status"]);
      const [col2] = buildCols(false, "spans", ["span_status"]);
      // Each call returns a fresh meta object — mutating one must not affect the other
      (col1.meta as Record<string, unknown>).extraProp = "test";
      expect((col2.meta as Record<string, unknown>).extraProp).toBeUndefined();
    });
  });

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

  // ── timestamp column ──────────────────────────────────────────────────────

  describe("timestamp column — auto-prepended when absent from selectedFields", () => {
    it("should have header containing the i18n key and timezone when auto-prepended", () => {
      // With the mock: t("traces.timestamp") returns "traces.timestamp", timezone is "UTC"
      const col = buildCols(false, "spans", []).find(
        (c) => c.id === "_timestamp",
      );
      expect(col?.header).toBe("traces.timestamp (UTC)");
    });

    it("should have size 210 when auto-prepended", () => {
      const col = buildCols(false, "spans", []).find(
        (c) => c.id === "_timestamp",
      );
      expect(col?.size).toBe(210);
    });

    it("should have accessorFn defined when auto-prepended", () => {
      const col = buildCols(false, "spans", []).find(
        (c) => c.id === "_timestamp",
      );
      expect(typeof (col as any)?.accessorFn).toBe("function");
    });

    it("should have meta.class set to 'tw:capitalize!' when auto-prepended", () => {
      const col = buildCols(false, "spans", []).find(
        (c) => c.id === "_timestamp",
      );
      const meta = col?.meta as Record<string, unknown>;
      expect(meta?.class).toBe("tw:capitalize!");
    });

    it("should have meta.sortable=true on timestamp column", () => {
      const col = buildCols(false, "spans", []).find(
        (c) => c.id === "_timestamp",
      );
      const meta = col?.meta as Record<string, unknown>;
      expect(meta?.sortable).toBe(true);
    });

    it("should call timestampToTimezoneDate with primary field value divided by 1000", () => {
      const col = buildCols(false, "spans", []).find(
        (c) => c.id === "_timestamp",
      );
      const accessorFn = (col as any)?.accessorFn as (row: any) => string;
      const row = { _timestamp: 1700000000000000 };

      accessorFn(row);

      expect(vi.mocked(timestampToTimezoneDate)).toHaveBeenCalledWith(
        1700000000000000 / 1000,
        "UTC",
        "yyyy-MM-dd HH:mm:ss.SSS",
      );
    });

    it("should use zo_sql_timestamp as fallback when primary timestamp field is absent from row", () => {
      const col = buildCols(false, "spans", []).find(
        (c) => c.id === "_timestamp",
      );
      const accessorFn = (col as any)?.accessorFn as (row: any) => string;
      // Row has no _timestamp — accessorFn must fall back to zo_sql_timestamp
      const row = { zo_sql_timestamp: 1600000000000000 };

      accessorFn(row);

      expect(vi.mocked(timestampToTimezoneDate)).toHaveBeenCalledWith(
        1600000000000000 / 1000,
        "UTC",
        "yyyy-MM-dd HH:mm:ss.SSS",
      );
    });

    it("should return the formatted string from timestampToTimezoneDate", () => {
      const col = buildCols(false, "spans", []).find(
        (c) => c.id === "_timestamp",
      );
      const accessorFn = (col as any)?.accessorFn as (row: any) => string;
      const result = accessorFn({ _timestamp: 5000 });
      expect(result).toBe("formatted:5");
    });

    it("should NOT auto-prepend timestamp when _timestamp is already in selectedFields", () => {
      // _timestamp is in the list — the guard must prevent a duplicate prepend
      const ids = buildCols(false, "spans", ["_timestamp", "service"]).map(
        (c) => c.id,
      );
      expect(ids.filter((id) => id === "_timestamp")).toHaveLength(1);
      expect(ids[0]).toBe("_timestamp");
    });
  });
});
