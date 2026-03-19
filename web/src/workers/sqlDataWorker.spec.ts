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
import { handleComputeSQLDataMessage } from "@/workers/sqlDataWorker";
import type { SerializableDataContext } from "@/utils/dashboard/sql/shared/workerContract";

// ---------------------------------------------------------------------------
// Dependency mocks
// ---------------------------------------------------------------------------

const mockSerializableCtx: SerializableDataContext = {
  xAxisKeys: ["time"],
  yAxisKeys: ["value"],
  zAxisKeys: [],
  breakDownKeys: [],
  missingValueData: [{ time: "2024-01-01", value: 42 }],
  extras: {},
  showGridlines: true,
  hasTimestampField: true,
  isHorizontalChart: false,
  dynamicXAxisNameGap: 25,
  additionalBottomSpace: 0,
  convertedTimeStampToDataFormat: "Mon Jan 01 2024 00:00:00",
  defaultSeriesProps: { type: "bar" },
  chartMin: 0,
  chartMax: 100,
  min: 0,
  max: 100,
  defaultGrid: {
    containLabel: true,
    left: "10%",
    right: "10%",
    top: "15%",
    bottom: "15%",
  },
  labelRotation: 0,
  labelWidth: 50,
  markLineData: [],
  noValueConfigOption: "",
};

vi.mock("@/utils/dashboard/sql/shared/contextBuilderData", () => ({
  buildSQLDataContext: vi.fn(() => mockSerializableCtx),
}));

// workerContract adapters are pure, no need to mock them
vi.mock(
  "@/utils/dashboard/sql/shared/workerContract",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/utils/dashboard/sql/shared/workerContract")
      >();
    return {
      ...actual,
    };
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(searchQueryData = [[{ time: "2024-01-01", value: 42 }]]) {
  return {
    panelSchema: {
      id: "panel-1",
      type: "bar",
      config: {},
      queries: [
        {
          fields: {
            x: [
              {
                alias: "time",
                label: "Time",
                aggregationFunction: "histogram",
                args: [],
              },
            ],
            y: [{ alias: "value", label: "Value" }],
            z: [],
            breakdown: [],
          },
        },
      ],
    },
    searchQueryData,
    resultMetaData: searchQueryData.map(() => [{}]),
    metadata: {
      queries: searchQueryData.map(() => ({
        fields: { x: [{}], y: [{}], z: [], breakdown: [] },
      })),
    },
    annotationsValue: [],
    chartPanelStyle: { height: "400px" },
    chartDimensions: { width: 800, height: 400 },
    storeSnapshot: {
      theme: "dark",
      timezone: "UTC",
      timestampColumn: "_timestamp",
      maxDashboardSeries: 20,
    },
    hoveredSeriesSnapshot: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sqlDataWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleComputeSQLDataMessage", () => {
    it("returns null for unknown actions", async () => {
      const result = await handleComputeSQLDataMessage({
        action: "unknownAction",
        requestId: "r1",
        panelId: "p1",
        payload: makeInput(),
      });
      expect(result).toBeNull();
    });

    it("returns type:'result' with results array for valid input", async () => {
      const input = makeInput();
      const result = await handleComputeSQLDataMessage({
        action: "computeSQLData",
        requestId: "req-1",
        panelId: "panel-1",
        payload: input,
      });

      expect(result).not.toBeNull();
      expect(result.type).toBe("result");
      expect(result.requestId).toBe("req-1");
      expect(result.panelId).toBe("panel-1");
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results).toHaveLength(input.searchQueryData.length);
    });

    it("returns one SerializableDataContext entry per query", async () => {
      const input = makeInput([
        [{ time: "2024-01-01", value: 1 }],
        [{ time: "2024-01-02", value: 2 }],
      ]);
      const result = await handleComputeSQLDataMessage({
        action: "computeSQLData",
        requestId: "req-2",
        panelId: "panel-2",
        payload: input,
      });

      expect(result.type).toBe("result");
      expect(result.results).toHaveLength(2);
    });

    it("returns type:'error' when buildSQLDataContext throws", async () => {
      const { buildSQLDataContext } =
        await import("@/utils/dashboard/sql/shared/contextBuilderData");
      (buildSQLDataContext as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => {
          throw new Error("Test error from data context");
        },
      );

      const result = await handleComputeSQLDataMessage({
        action: "computeSQLData",
        requestId: "req-err",
        panelId: "panel-err",
        payload: makeInput(),
      });

      expect(result.type).toBe("error");
      expect(result.requestId).toBe("req-err");
      expect(result.panelId).toBe("panel-err");
      expect(result.error.message).toBe("Test error from data context");
    });

    it("error message falls back to 'Unknown error' for non-Error throws", async () => {
      const { buildSQLDataContext } =
        await import("@/utils/dashboard/sql/shared/contextBuilderData");
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      (buildSQLDataContext as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => {
          // eslint-disable-next-line no-throw-literal
          throw "string error";
        },
      );

      const result = await handleComputeSQLDataMessage({
        action: "computeSQLData",
        requestId: "req-str",
        panelId: "panel-str",
        payload: makeInput(),
      });

      expect(result.type).toBe("error");
      expect(result.error.message).toBe("Unknown error");
    });

    // -----------------------------------------------------------------------
    // Phase 2 Step 2.4 ΓÇö serialization regression guard
    // -----------------------------------------------------------------------

    it("result is fully JSON-serializable (no function values)", async () => {
      const result = await handleComputeSQLDataMessage({
        action: "computeSQLData",
        requestId: "req-serial",
        panelId: "panel-serial",
        payload: makeInput(),
      });

      expect(result.type).toBe("result");
      // JSON.stringify must not throw ΓÇö functions would cause it to omit fields
      // unexpectedly or throw in strict serializers.
      let serialized: string;
      expect(() => {
        serialized = JSON.stringify(result);
      }).not.toThrow();

      // Round-trip: parsed value equals the original (no functions dropped)
      const parsed = JSON.parse(serialized!);
      expect(parsed.type).toBe("result");
      expect(parsed.results).toHaveLength(result.results.length);

      // No function values in any result entry
      for (const ctx of result.results) {
        if (ctx === null) continue;
        for (const [key, value] of Object.entries(ctx)) {
          expect(
            typeof value,
            `SerializableDataContext.${key} must not be a function`,
          ).not.toBe("function");
        }
      }
    });
  });
});
