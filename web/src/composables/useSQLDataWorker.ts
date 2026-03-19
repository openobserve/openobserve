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
 * useSQLDataWorker composable
 *
 * Manages the lifecycle of a single sqlDataWorker.ts Web Worker instance.
 * One worker is created per panel (in PanelSchemaRenderer) and terminated
 * when the panel is unmounted.
 *
 * - Workers are created lazily on the first `computeAsync` call.
 * - Each request carries a unique `requestId`; stale responses are discarded.
 * - If the worker crashes (error event), it is set to null; the next call
 *   will lazily create a new one (or fail fast if the env has no Worker).
 */

import type {
  SQLWorkerInput,
  SerializableDataContext,
} from "@/utils/dashboard/sql/shared/workerContract";

export function useSQLDataWorker() {
  let worker: Worker | null = null;
  let requestCounter = 0;

  const getWorker = (): Worker | null => {
    if (worker) return worker;
    if (typeof window === "undefined" || !window.Worker) return null;
    try {
      worker = new Worker(
        new URL("../workers/sqlDataWorker.ts", import.meta.url),
        { type: "module" },
      );
      // If the worker crashes with an unhandled exception, clear the ref so
      // the next request lazily creates a fresh worker instead of hanging.
      worker.addEventListener("error", () => {
        worker = null;
      });
    } catch {
      worker = null;
    }
    return worker;
  };

  /**
   * Send a compute request to the worker thread and await its response.
   * The promise resolves with an array of `SerializableDataContext | null`
   * (one entry per query in the panel).
   *
   * Rejects if the worker returns an error response or is unavailable.
   */
  const computeAsync = (
    panelId: string,
    input: SQLWorkerInput,
  ): Promise<(SerializableDataContext | null)[]> => {
    return new Promise((resolve, reject) => {
      const w = getWorker();
      if (!w) {
        reject(new Error("Web Worker unavailable"));
        return;
      }

      const requestId = ++requestCounter;

      const handler = (event: MessageEvent) => {
        // Ignore responses for other in-flight requests
        if (event.data?.requestId !== requestId) return;
        w.removeEventListener("message", handler);
        if (event.data.type === "result") {
          resolve(event.data.results);
        } else {
          reject(
            new Error(
              event.data?.error?.message ?? "Worker computation failed",
            ),
          );
        }
      };

      w.addEventListener("message", handler);
      w.postMessage({
        action: "computeSQLData",
        requestId,
        panelId,
        payload: input,
      });
    });
  };

  /** Terminate the worker. Call from onUnmounted in the owning component. */
  const terminate = () => {
    worker?.terminate();
    worker = null;
  };

  return { computeAsync, terminate };
}

/** Return type ΓÇö use as the worker arg type in convertPanelData / convertMultiSQLData. */
export type SQLDataWorkerInstance = ReturnType<typeof useSQLDataWorker>;
