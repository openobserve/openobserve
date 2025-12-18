// Copyright 2023 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

export interface Query {
  from: number;
  size: number;
  sql: string;
  track_total_hits?: boolean;
}

export interface SearchRequestPayload {
  query: QueryPayload;
  aggs?: HistogramQueryPayload;
  regions?: string[];
  clusters?: string[];
}

export interface QueryPayload {
  sql: string;
  start_time: number;
  end_time: number;
  from: number;
  size: number;
  query_fn?: string;
  track_total_hits?: boolean;
  action_id?: string;
}
export interface HistogramQueryPayload {
  histogram: string;
}

export interface WebSocketSearchResponse {
  type: "search_response" | "cancel_response" | "error" | "end" | "progress" | "search_response_metadata" | "search_response_hits";
  content: {
    results: {
      hits: any[];
      total: number;
      took: number;
      function_error?: string;
      new_start_time?: number;
      new_end_time?: number;
      scan_size?: number;
      from?: number;
      aggs?: any;
      result_cache_ratio?: number;
      order_by?: string;
      histogram_interval?: number;
      is_histogram_eligible?: boolean;
      converted_histogram_query?: string;
    };
    streaming_aggs?: boolean;
    total?: number;
    time_offset?: string;
    traceId: string;
    type?: string;
  };
}

export interface WebSocketSearchPayload {
  queryReq: SearchRequestPayload;
  type: "search" | "histogram" | "pageCount" | "values";
  isPagination: boolean;
  traceId: string;
  org_id: string;
  meta?: any;
}

export interface WebSocketValuesPayload {
  queryReq: SearchRequestPayload;
  type: "values";
  traceId: string;
  org_id: string;
  meta?: any;
}

export interface ErrorContent {
  message: string;
  trace_id?: string;
  code?: number;
  error_detail?: string;
  error?: string;
}

export interface WebSocketErrorResponse {
  content: ErrorContent;
  type: "error";
}

// HTTP2 Streaming interfaces
export interface StreamingSource {
  [traceId: string]: EventSource;
}

export interface StreamingSearchResponse {
  hits: any[];
  total: number;
  took: number;
  function_error?: string;
  new_start_time?: number;
  new_end_time?: number;
  scan_size?: number;
  time_offset?: string;
  cached_ratio?: number;
  streaming_aggs?: boolean;
}

export interface StreamingSearchEvent {
  data: string; // JSON string of StreamingSearchResponse
  type: "message" | "error" | "open" | "end";
  lastEventId?: string;
}

export interface StreamingSearchPayload {
  queryReq: SearchRequestPayload;
  type: "search" | "histogram" | "pageCount" | "values";
  isPagination: boolean;
  traceId: string;
  org_id: string;
  meta?: any;
}

export interface StreamingErrorResponse {
  message: string;
  trace_id?: string;
  code?: number;
  error_detail?: string;
}

// PromQL HTTP2 Streaming interfaces
export interface PromQLStreamingPayload {
  queryReq: PromQLQueryPayload;
  type: "promql";
  traceId: string;
  org_id: string;
  meta?: any;
}

export interface PromQLQueryPayload {
  query: string;
  start_time: number;
  end_time: number;
  step: string;
}

export interface PromQLStreamingResponse {
  result_type: string; // "vector" or "matrix"
  result: any; // PromQL result data
}
