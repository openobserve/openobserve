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

// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// vi.mock() calls MUST precede all imports.
// ---------------------------------------------------------------------------

const mockCancelStreamQuery = vi.fn();
const mockFetchQueryDataWithHttpStream = vi.fn();

vi.mock("@/composables/useStreamingSearch", () => ({
  default: vi.fn(() => ({
    fetchQueryDataWithHttpStream: mockFetchQueryDataWithHttpStream,
    cancelStreamQueryBasedOnRequestId: mockCancelStreamQuery,
  })),
}));

vi.mock("@/stores", () => ({
  default: {
    state: {
      selectedOrganization: { identifier: "test-org" },
      zoConfig: { query_values_default_num: 10 },
    },
  },
}));

vi.mock("@/utils/zincutils", () => ({
  generateTraceContext: vi.fn(() => ({ traceId: "test-trace-123" })),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import { isRef } from "vue";
import useFieldValuesStream from "./useFieldValuesStream";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useFieldValuesStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Return value structure ───────────────────────────────────────────────

  describe("return value structure", () => {
    it("returns fieldValues, fetchFieldValues, cancelFieldStream, resetFieldValues", () => {
      const result = useFieldValuesStream();
      expect(result).toHaveProperty("fieldValues");
      expect(result).toHaveProperty("fetchFieldValues");
      expect(result).toHaveProperty("cancelFieldStream");
      expect(result).toHaveProperty("resetFieldValues");
    });

    it("fieldValues is a Vue ref", () => {
      const { fieldValues } = useFieldValuesStream();
      expect(isRef(fieldValues)).toBe(true);
    });

    it("fieldValues starts as an empty object", () => {
      const { fieldValues } = useFieldValuesStream();
      expect(fieldValues.value).toEqual({});
    });

    it("fetchFieldValues, cancelFieldStream, resetFieldValues are functions", () => {
      const { fetchFieldValues, cancelFieldStream, resetFieldValues } =
        useFieldValuesStream();
      expect(typeof fetchFieldValues).toBe("function");
      expect(typeof cancelFieldStream).toBe("function");
      expect(typeof resetFieldValues).toBe("function");
    });
  });

  // ─── resetFieldValues ────────────────────────────────────────────────────

  describe("resetFieldValues", () => {
    it("initialises field state with isLoading=false by default", () => {
      const { fieldValues, resetFieldValues } = useFieldValuesStream();

      resetFieldValues("status");

      expect(fieldValues.value["status"]).toEqual({
        values: [],
        isLoading: false,
        hasMore: false,
        errMsg: "",
      });
    });

    it("initialises field state with isLoading=true when second arg is true", () => {
      const { fieldValues, resetFieldValues } = useFieldValuesStream();

      resetFieldValues("level", true);

      expect(fieldValues.value["level"].isLoading).toBe(true);
    });

    it("resets existing field state to fresh empty state", () => {
      const { fieldValues, resetFieldValues } = useFieldValuesStream();

      // Put some data in first
      resetFieldValues("host", true);
      fieldValues.value["host"].values = [{ key: "server1", count: 5 }];

      // Then reset again
      resetFieldValues("host");

      expect(fieldValues.value["host"].values).toEqual([]);
      expect(fieldValues.value["host"].isLoading).toBe(false);
    });

    it("can reset multiple different fields independently", () => {
      const { fieldValues, resetFieldValues } = useFieldValuesStream();

      resetFieldValues("field-a", true);
      resetFieldValues("field-b", false);

      expect(fieldValues.value["field-a"].isLoading).toBe(true);
      expect(fieldValues.value["field-b"].isLoading).toBe(false);
    });
  });

  // ─── cancelFieldStream ───────────────────────────────────────────────────

  describe("cancelFieldStream", () => {
    it("is a no-op when field has no registered trace IDs", () => {
      const { cancelFieldStream } = useFieldValuesStream();

      expect(() => cancelFieldStream("no-traces-field")).not.toThrow();
      expect(mockCancelStreamQuery).not.toHaveBeenCalled();
    });

    it("calls cancelStreamQueryBasedOnRequestId for each trace ID registered to the field", () => {
      const { fetchFieldValues, cancelFieldStream } = useFieldValuesStream();

      // Each fetchFieldValues call registers a traceId for the field
      fetchFieldValues({ fields: ["environment"], stream_name: "logs" });
      fetchFieldValues({ fields: ["environment"], stream_name: "metrics" });

      cancelFieldStream("environment");

      // generateTraceContext always returns "test-trace-123", so both calls
      // share the same trace ID; cancelStreamQueryBasedOnRequestId is still
      // called once per registered trace.
      expect(mockCancelStreamQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          trace_id: "test-trace-123",
          org_id: "test-org",
        })
      );
    });

    it("clears the traceId list after cancellation", () => {
      const { fetchFieldValues, cancelFieldStream } = useFieldValuesStream();

      fetchFieldValues({ fields: ["service"], stream_name: "logs" });
      cancelFieldStream("service");

      // Cancelling a second time should be a no-op (list was cleared)
      vi.clearAllMocks();
      cancelFieldStream("service");
      expect(mockCancelStreamQuery).not.toHaveBeenCalled();
    });
  });

  // ─── fetchFieldValues ─────────────────────────────────────────────────────

  describe("fetchFieldValues", () => {
    it("calls generateTraceContext to obtain a trace ID", async () => {
      const { generateTraceContext } = await import("@/utils/zincutils");
      const { fetchFieldValues } = useFieldValuesStream();

      fetchFieldValues({ fields: ["method"], stream_name: "logs" });

      expect(generateTraceContext).toHaveBeenCalled();
    });

    it("calls fetchQueryDataWithHttpStream with a payload containing traceId and org_id", () => {
      const { fetchFieldValues } = useFieldValuesStream();

      fetchFieldValues({ fields: ["path"], stream_name: "traces" });

      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: "test-trace-123",
          org_id: "test-org",
          type: "values",
        }),
        expect.objectContaining({
          data: expect.any(Function),
          error: expect.any(Function),
          complete: expect.any(Function),
          reset: expect.any(Function),
        })
      );
    });

    it("passes the full payload as queryReq and meta in the ws payload", () => {
      const { fetchFieldValues } = useFieldValuesStream();

      const payload = { fields: ["region"], stream_name: "infra", from: 0 };
      fetchFieldValues(payload);

      const [wsPayload] = mockFetchQueryDataWithHttpStream.mock.calls[0];
      expect(wsPayload.queryReq).toEqual(payload);
      expect(wsPayload.meta).toEqual(payload);
    });

    it("registers the returned traceId for the first field in the payload", () => {
      const { fetchFieldValues, cancelFieldStream } = useFieldValuesStream();

      fetchFieldValues({ fields: ["datacenter"], stream_name: "logs" });

      // If a traceId was registered, cancelFieldStream will call cancel
      cancelFieldStream("datacenter");
      expect(mockCancelStreamQuery).toHaveBeenCalledWith(
        expect.objectContaining({ trace_id: "test-trace-123" })
      );
    });
  });
});
