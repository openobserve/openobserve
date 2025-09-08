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

export class ResponseHandlers {
  private store = useStore();

  constructor(
    private state: PanelState,
    private removeTraceId: (traceId: string) => void,
    private processApiError: (error: any, type: string) => void,
    private saveCurrentStateToCache: () => Promise<void>,
    private loadData: () => void,
  ) {}

  handleHistogramResponse(payload: any, searchRes: any) {
    this.state.errorDetail = {
      message: "",
      code: "",
    };

    const streaming_aggs = searchRes?.content?.streaming_aggs ?? false;

    if (streaming_aggs) {
      this.state.data[payload?.meta?.currentQueryIndex] = [
        ...(searchRes?.content?.results?.hits ?? {}),
      ];
    } else if (searchRes?.content?.results?.order_by?.toLowerCase() === "asc") {
      this.state.data[payload?.meta?.currentQueryIndex] = [
        ...(searchRes?.content?.results?.hits ?? {}),
        ...(this.state.data[payload?.meta?.currentQueryIndex] ?? []),
      ];
    } else {
      this.state.data[payload?.meta?.currentQueryIndex] = [
        ...(this.state.data[payload?.meta?.currentQueryIndex] ?? []),
        ...(searchRes?.content?.results?.hits ?? {}),
      ];
    }

    this.state.resultMetaData[payload?.meta?.currentQueryIndex] =
      searchRes?.content?.results ?? {};

    if (
      this.state.data[payload?.meta?.currentQueryIndex]?.length > 0 &&
      !this.state.loading
    ) {
      this.state.isPartialData = false;
    }
  }

  handleStreamingHistogramMetadata(payload: any, searchRes: any) {
    this.state.resultMetaData[payload?.meta?.currentQueryIndex] = {
      ...(searchRes?.content ?? {}),
      ...(searchRes?.content?.results ?? {}),
    };
  }

  handleStreamingHistogramHits(payload: any, searchRes: any) {
    this.state.errorDetail = {
      message: "",
      code: "",
    };

    const streaming_aggs =
      this.state?.resultMetaData?.[payload?.meta?.currentQueryIndex]
        ?.streaming_aggs ?? false;

    if (streaming_aggs) {
      this.state.data[payload?.meta?.currentQueryIndex] = [
        ...(searchRes?.content?.results?.hits ?? {}),
      ];
    } else if (
      this.state?.resultMetaData?.[
        payload?.meta?.currentQueryIndex
      ]?.order_by?.toLowerCase() === "asc"
    ) {
      this.state.data[payload?.meta?.currentQueryIndex] = [
        ...(searchRes?.content?.results?.hits ?? {}),
        ...(this.state.data[payload?.meta?.currentQueryIndex] ?? []),
      ];
    } else {
      this.state.data[payload?.meta?.currentQueryIndex] = [
        ...(this.state.data[payload?.meta?.currentQueryIndex] ?? []),
        ...(searchRes?.content?.results?.hits ?? {}),
      ];
    }

    this.state.resultMetaData[payload?.meta?.currentQueryIndex].hits =
      searchRes?.content?.results?.hits ?? {};
  }

  async handleSearchResponse(payload: any, response: any) {
    try {
      if (response.type === "search_response_metadata") {
        this.handleStreamingHistogramMetadata(payload, response);
        await this.saveCurrentStateToCache();
      }

      if (response.type === "search_response_hits") {
        this.handleStreamingHistogramHits(payload, response);
        await this.saveCurrentStateToCache();
      }

      if (response.type === "search_response") {
        this.handleHistogramResponse(payload, response);
        await this.saveCurrentStateToCache();
      }

      if (response.type === "error") {
        this.state.loading = false;
        this.state.loadingTotal = 0;
        this.state.loadingCompleted = 0;
        this.state.loadingProgressPercentage = 0;
        this.state.isOperationCancelled = false;
        this.processApiError(response?.content, "sql");
      }

      if (response.type === "end") {
        this.state.loading = false;
        this.state.loadingTotal = 0;
        this.state.loadingCompleted = 0;
        this.state.loadingProgressPercentage = 100;
        this.state.isOperationCancelled = false;
        this.state.isPartialData = false;
        await this.saveCurrentStateToCache();
      }

      if (response.type === "event_progress") {
        this.state.loadingProgressPercentage = response?.content?.percent ?? 0;
        this.state.isPartialData = true;
        await this.saveCurrentStateToCache();
      }
    } catch (error: any) {
      this.state.loading = false;
      this.state.isOperationCancelled = false;
      this.state.loadingTotal = 0;
      this.state.loadingCompleted = 0;
      this.state.loadingProgressPercentage = 0;
      this.state.errorDetail = {
        message: error?.message || "Unknown error in search response",
        code: error?.code ?? "",
      };
    }
  }

  async handleSearchClose(payload: any, response: any) {
    this.removeTraceId(payload?.traceId);

    if (response.type === "error") {
      this.processApiError(response?.content, "sql");
    }

    const errorCodes = [1001, 1006, 1010, 1011, 1012, 1013];

    if (errorCodes.includes(response.code)) {
      this.handleSearchError(payload, {
        content: {
          message:
            "WebSocket connection terminated unexpectedly. Please check your network and try again",
          trace_id: payload.traceId,
          code: response.code,
          error_detail: "",
        },
      });
    }

    this.state.loading = false;
    this.state.isOperationCancelled = false;
    this.state.isPartialData = false;
    await this.saveCurrentStateToCache();
  }

  async handleSearchReset(payload: any, traceId?: string) {
    await this.saveCurrentStateToCache();
    this.loadData();
  }

  handleSearchError(payload: any, response: any) {
    this.removeTraceId(payload.traceId);

    this.state.loading = false;
    this.state.loadingTotal = 0;
    this.state.loadingCompleted = 0;
    this.state.loadingProgressPercentage = 0;
    this.state.isOperationCancelled = false;

    this.processApiError(response?.content, "sql");
  }
}
