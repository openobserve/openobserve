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

/**
 * SQL Data Worker
 *
 * Runs the CPU-heavy data-processing phase of the SQL chart pipeline in a
 * dedicated Web Worker thread so the main thread stays responsive during
 * streaming dashboard updates.
 *
 * Protocol:
 *   main  ΓåÆ worker : { action: "computeSQLData", requestId, panelId, payload: SQLWorkerInput }
 *   worker ΓåÆ main  : { type: "result",  requestId, panelId, results: (SerializableDataContext | null)[] }
 *                  | { type: "error",   requestId, panelId, error: { message: string } }
 */

import type { SQLWorkerInput } from "@/utils/dashboard/sql/shared/workerContract";
import {
  storeFromSnapshot,
  chartPanelRefFromDimensions,
} from "@/utils/dashboard/sql/shared/workerContract";
import { buildSQLDataContext } from "@/utils/dashboard/sql/shared/contextBuilderData";

// ---------------------------------------------------------------------------
// Exported handler ΓÇö testable without worker infrastructure
// ---------------------------------------------------------------------------

/**
 * Process a single "computeSQLData" message payload and return the result
 * object that should be sent back via postMessage.
 *
 * Exported for unit-testing; the actual worker assigns this to onmessage.
 */
export async function handleComputeSQLDataMessage(data: any): Promise<any> {
  const { action, requestId, panelId, payload } = data;
  if (action !== "computeSQLData") return null;

  try {
    const input: SQLWorkerInput = payload;
    const store = storeFromSnapshot(input.storeSnapshot);
    const chartPanelRef = chartPanelRefFromDimensions(input.chartDimensions);
    const hoveredSeriesState = input.hoveredSeriesSnapshot
      ? { value: input.hoveredSeriesSnapshot }
      : null;
    const annotations = { value: input.annotationsValue };

    // Process each query independently (mirrors convertMultiSQLData)
    const results = [];
    for (let i = 0; i < input.searchQueryData.length; i++) {
      const ctx = buildSQLDataContext(
        input.panelSchema,
        [input.searchQueryData[i]],
        store,
        chartPanelRef,
        hoveredSeriesState,
        [input.resultMetaData?.[i]?.[0]],
        { queries: [input.metadata.queries[i]] },
        input.chartPanelStyle,
        annotations,
      );
      results.push(ctx);
    }

    return { type: "result", requestId, panelId, results };
  } catch (err: any) {
    return {
      type: "error",
      requestId,
      panelId,
      error: { message: err?.message ?? "Unknown error" },
    };
  }
}

// ---------------------------------------------------------------------------
// Worker entry point ΓÇö wire the handler into the global message bus
// ---------------------------------------------------------------------------
// globalThis is available in both Worker and Node/test environments.
// The cast is required because tsconfig.app.json intentionally omits the
// "WebWorker" lib to avoid conflicts with the main-thread "DOM" lib.
(globalThis as any).onmessage = async (event: { data: any }) => {
  const result = await handleComputeSQLDataMessage(event.data);
  if (result !== null) {
    (globalThis as any).postMessage(result);
  }
};
