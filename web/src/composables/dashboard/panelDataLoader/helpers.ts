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

import { useStore } from "vuex";
import { isWebSocketEnabled, isStreamingEnabled } from "@/utils/zincutils";
import type { PanelState } from "./types";
import { PANEL_DATA_LOADER_DEBOUNCE_TIME } from "./constants";

export class PanelHelpers {
  private store = useStore();

  constructor(
    private state: PanelState,
    private panelSchema: any,
  ) {}

  shouldFetchAnnotations() {
    return [
      "area",
      "area-stacked",
      "bar",
      "h-bar",
      "line",
      "scatter",
      "stacked",
      "h-stacked",
    ].includes(this.panelSchema.value.type);
  }

  hasAtLeastOneQuery() {
    return this.panelSchema.value.queries?.some((q: any) => q?.query);
  }

  waitForTimeout(signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(resolve, PANEL_DATA_LOADER_DEBOUNCE_TIME);

      signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
        reject(new Error("Aborted waiting for loading"));
      });
    });
  }

  waitForThePanelToBecomeVisible(signal: any, isVisible: any, forceLoad: any) {
    return new Promise<void>((resolve, reject) => {
      if (forceLoad.value == true) {
        resolve();
        return;
      }
      
      if (isVisible.value) {
        resolve();
        return;
      }

      const stopWatching = () => {}; // This will be implemented in main composable
      
      signal.addEventListener("abort", () => {
        stopWatching();
        reject(new Error("Aborted waiting for loading"));
      });
    });
  }

  addTraceId(traceId: string) {
    if (this.state.searchRequestTraceIds.includes(traceId)) {
      return;
    }
    this.state.searchRequestTraceIds = [...this.state.searchRequestTraceIds, traceId];
  }

  removeTraceId(traceId: string) {
    this.state.searchRequestTraceIds = this.state.searchRequestTraceIds.filter(
      (id: any) => id !== traceId,
    );
  }

  processApiError(error: any, type: any) {
    switch (type) {
      case "promql": {
        const errorDetailValue = error?.response?.data?.error || error?.message;
        const trimmedErrorMessage =
          errorDetailValue?.length > 300
            ? errorDetailValue.slice(0, 300) + " ..."
            : errorDetailValue;

        const errorCode =
          error?.response?.status ||
          error?.status ||
          error?.response?.data?.code ||
          "";

        this.state.errorDetail = {
          message: trimmedErrorMessage,
          code: errorCode,
        };
        break;
      }
      case "sql": {
        const errorDetailValue =
          error?.response?.data.error_detail ||
          error?.response?.data.message ||
          error?.error_detail ||
          error?.message ||
          error?.error;

        const trimmedErrorMessage =
          errorDetailValue?.length > 300
            ? errorDetailValue.slice(0, 300) + " ..."
            : errorDetailValue;

        const errorCode =
          isWebSocketEnabled(this.store.state) || isStreamingEnabled(this.store.state)
            ? error?.response?.status ||
              error?.status ||
              error?.response?.data?.code ||
              error?.code ||
              ""
            : error?.response?.status ||
              error?.response?.data?.code ||
              error?.status ||
              error?.code ||
              "";

        this.state.errorDetail = {
          message: trimmedErrorMessage,
          code: errorCode,
        };
        break;
      }
      default:
        break;
    }
  }
}
