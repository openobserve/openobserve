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
import { ref } from "vue";
import { useTracesTableColumns } from "./useTracesTableColumns";

describe("useTracesTableColumns", () => {
  describe("spans mode", () => {
    it("should return exactly 7 columns", () => {
      const showLlmColumns = ref(false);
      const searchMode = ref<"traces" | "spans">("spans");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      expect(columns.value).toHaveLength(7);
    });

    it("should return columns with ids: timestamp, service, operation_name, duration, status, status_code, method", () => {
      const showLlmColumns = ref(false);
      const searchMode = ref<"traces" | "spans">("spans");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      const ids = columns.value.map((col) => col.id);
      expect(ids).toEqual([
        "timestamp",
        "service",
        "operation_name",
        "duration",
        "status",
        "status_code",
        "method",
      ]);
    });

    it("should NOT include spans column", () => {
      const showLlmColumns = ref(false);
      const searchMode = ref<"traces" | "spans">("spans");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      const ids = columns.value.map((col) => col.id);
      expect(ids).not.toContain("spans");
    });

    it("should NOT include service_latency column", () => {
      const showLlmColumns = ref(false);
      const searchMode = ref<"traces" | "spans">("spans");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      const ids = columns.value.map((col) => col.id);
      expect(ids).not.toContain("service_latency");
    });

    it("should NOT include input_tokens column", () => {
      const showLlmColumns = ref(true);
      const searchMode = ref<"traces" | "spans">("spans");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      const ids = columns.value.map((col) => col.id);
      expect(ids).not.toContain("input_tokens");
    });
  });

  describe("traces mode without LLM columns", () => {
    it("should return base columns plus service_latency tail with no LLM columns", () => {
      const showLlmColumns = ref(false);
      const searchMode = ref<"traces" | "spans">("traces");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      const ids = columns.value.map((col) => col.id);
      expect(ids).toEqual([
        "timestamp",
        "service",
        "operation_name",
        "duration",
        "spans",
        "status",
        "service_latency",
      ]);
    });

    it("should NOT include input_tokens, output_tokens, or cost", () => {
      const showLlmColumns = ref(false);
      const searchMode = ref<"traces" | "spans">("traces");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      const ids = columns.value.map((col) => col.id);
      expect(ids).not.toContain("input_tokens");
      expect(ids).not.toContain("output_tokens");
      expect(ids).not.toContain("cost");
    });
  });

  describe("traces mode with LLM columns", () => {
    it("should include input_tokens, output_tokens, and cost between base and tail", () => {
      const showLlmColumns = ref(true);
      const searchMode = ref<"traces" | "spans">("traces");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      const ids = columns.value.map((col) => col.id);
      expect(ids).toEqual([
        "timestamp",
        "service",
        "operation_name",
        "duration",
        "spans",
        "status",
        "input_tokens",
        "output_tokens",
        "cost",
        "service_latency",
      ]);
    });

    it("should place input_tokens immediately after the last base column (status)", () => {
      const showLlmColumns = ref(true);
      const searchMode = ref<"traces" | "spans">("traces");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      const ids = columns.value.map((col) => col.id);
      const statusIndex = ids.indexOf("status");
      const inputTokensIndex = ids.indexOf("input_tokens");
      expect(inputTokensIndex).toBe(statusIndex + 1);
    });

    it("should place service_latency after cost", () => {
      const showLlmColumns = ref(true);
      const searchMode = ref<"traces" | "spans">("traces");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      const ids = columns.value.map((col) => col.id);
      const costIndex = ids.indexOf("cost");
      const serviceLatencyIndex = ids.indexOf("service_latency");
      expect(serviceLatencyIndex).toBe(costIndex + 1);
    });
  });

  describe("column order — service_latency is always last in traces mode", () => {
    it("should have service_latency as the last column when LLM columns are hidden", () => {
      const showLlmColumns = ref(false);
      const searchMode = ref<"traces" | "spans">("traces");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      const ids = columns.value.map((col) => col.id);
      expect(ids[ids.length - 1]).toBe("service_latency");
    });

    it("should have service_latency as the last column when LLM columns are visible", () => {
      const showLlmColumns = ref(true);
      const searchMode = ref<"traces" | "spans">("traces");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      const ids = columns.value.map((col) => col.id);
      expect(ids[ids.length - 1]).toBe("service_latency");
    });
  });

  describe("reactivity — searchMode", () => {
    it("should update columns when searchMode changes from traces to spans", () => {
      const showLlmColumns = ref(false);
      const searchMode = ref<"traces" | "spans">("traces");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      const tracesIds = columns.value.map((col) => col.id);
      expect(tracesIds).toContain("spans");
      expect(tracesIds).toContain("service_latency");

      searchMode.value = "spans";

      const spansIds = columns.value.map((col) => col.id);
      expect(spansIds).not.toContain("spans");
      expect(spansIds).not.toContain("service_latency");
      expect(spansIds).toContain("status_code");
      expect(spansIds).toContain("method");
    });

    it("should update columns when searchMode changes from spans to traces", () => {
      const showLlmColumns = ref(false);
      const searchMode = ref<"traces" | "spans">("spans");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      expect(columns.value.map((col) => col.id)).toContain("status_code");

      searchMode.value = "traces";

      const ids = columns.value.map((col) => col.id);
      expect(ids).not.toContain("status_code");
      expect(ids).toContain("spans");
      expect(ids).toContain("service_latency");
    });
  });

  describe("reactivity — showLlmColumns", () => {
    it("should add LLM columns when showLlmColumns toggles from false to true", () => {
      const showLlmColumns = ref(false);
      const searchMode = ref<"traces" | "spans">("traces");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      expect(columns.value.map((col) => col.id)).not.toContain("input_tokens");

      showLlmColumns.value = true;

      const ids = columns.value.map((col) => col.id);
      expect(ids).toContain("input_tokens");
      expect(ids).toContain("output_tokens");
      expect(ids).toContain("cost");
    });

    it("should remove LLM columns when showLlmColumns toggles from true to false", () => {
      const showLlmColumns = ref(true);
      const searchMode = ref<"traces" | "spans">("traces");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      expect(columns.value.map((col) => col.id)).toContain("input_tokens");

      showLlmColumns.value = false;

      const ids = columns.value.map((col) => col.id);
      expect(ids).not.toContain("input_tokens");
      expect(ids).not.toContain("output_tokens");
      expect(ids).not.toContain("cost");
    });

    it("should keep service_latency as last column after LLM columns are added", () => {
      const showLlmColumns = ref(false);
      const searchMode = ref<"traces" | "spans">("traces");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      showLlmColumns.value = true;

      const ids = columns.value.map((col) => col.id);
      expect(ids[ids.length - 1]).toBe("service_latency");
    });

    it("should not affect spans mode when showLlmColumns is toggled", () => {
      const showLlmColumns = ref(false);
      const searchMode = ref<"traces" | "spans">("spans");
      const columns = useTracesTableColumns(showLlmColumns, searchMode);

      const idsBefore = columns.value.map((col) => col.id);

      showLlmColumns.value = true;

      const idsAfter = columns.value.map((col) => col.id);
      expect(idsAfter).toEqual(idsBefore);
      expect(idsAfter).not.toContain("input_tokens");
    });
  });
});
