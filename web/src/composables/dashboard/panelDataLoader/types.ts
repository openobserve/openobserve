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

export interface PanelState {
  data: any[];
  loading: boolean;
  errorDetail: {
    message: string;
    code: string;
  };
  metadata: {
    queries: any[];
  };
  annotations: any[];
  resultMetaData: any[];
  lastTriggeredAt: number | null;
  isCachedDataDifferWithCurrentTimeRange: boolean;
  searchRequestTraceIds: string[];
  isOperationCancelled: boolean;
  loadingTotal: number;
  loadingCompleted: number;
  loadingProgressPercentage: number;
  isPartialData: boolean;
}

export interface SearchPayload {
  queryReq: any;
  type: "search" | "histogram" | "pageCount" | "values";
  isPagination: boolean;
  traceId: string;
  org_id: string;
  pageType: string;
  searchType?: string;
  meta: any;
}

export interface ResponseHandlers {
  open?: (payload: any) => void;
  close?: (payload: any, response: any) => void;
  error?: (payload: any, response: any) => void;
  message?: (payload: any, response: any) => void;
  reset?: (payload: any, traceId?: string) => void;
  data?: (payload: any, response: any) => void;
  complete?: (payload: any, response: any) => void;
}
