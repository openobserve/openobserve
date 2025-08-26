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

import { generateTraceContext } from "@/utils/zincutils";
import http from "../http";
import type { SearchRequestPayload } from "@/ts/interfaces/query";

/**
 * Interface for search API parameters
 */
export interface SearchParams {
  org_identifier: string;
  query: SearchRequestPayload;
  page_type: string;
  traceparent?: string;
  dashboard_id?: string;
  folder_id?: string;
  panel_id?: string;
  panel_name?: string;
  run_id?: string;
  tab_id?: string;
  tab_name?: string;
  is_ui_histogram?: boolean;
}

/**
 * Interface for partition API parameters
 */
export interface PartitionParams {
  org_identifier: string;
  query: SearchRequestPayload;
  page_type: string;
  traceparent?: string;
  enable_align_histogram?: boolean;
}

/**
 * Interface for search around parameters
 */
export interface SearchAroundParams {
  org_identifier: string;
  index: string;
  key: string;
  size: number;
  body: any;
  query_context?: string;
  query_fn?: string;
  stream_type: string;
  regions?: string[];
  clusters?: string[];
  is_multistream?: boolean;
  traceparent?: string;
  action_id?: string;
}

/**
 * Interface for scheduled search parameters
 */
export interface ScheduledSearchParams {
  org_identifier: string;
  query: SearchRequestPayload;
  page_type: string;
}

/**
 * Logs API service for handling HTTP requests
 */
export const logsApi = {
  /**
   * Performs a logs search query
   */
  search: (
    params: SearchParams,
    search_type: string = "ui",
    is_multi_stream_search: boolean = false
  ) => {
    if (!params.traceparent) {
      params.traceparent = generateTraceContext()?.traceparent;
    }

    const use_cache: boolean =
      (window as any).use_cache !== undefined
        ? (window as any).use_cache
        : true;

    let url = `/api/${params.org_identifier}/_search?type=${params.page_type}&search_type=${search_type}&use_cache=${use_cache}`;
    
    if (params.dashboard_id) url += `&dashboard_id=${params.dashboard_id}`;
    if (params.folder_id) url += `&folder_id=${params.folder_id}`;
    if (params.panel_id) url += `&panel_id=${params.panel_id}`;
    if (params.panel_name) url += `&panel_name=${encodeURIComponent(params.panel_name)}`;
    if (params.run_id) url += `&run_id=${params.run_id}`;
    if (params.tab_id) url += `&tab_id=${params.tab_id}`;
    if (params.tab_name) url += `&tab_name=${encodeURIComponent(params.tab_name)}`;
    if (params.is_ui_histogram) url += `&is_ui_histogram=${params.is_ui_histogram}`;
    if (is_multi_stream_search) url += `&is_multi_stream_search=${is_multi_stream_search}`;

    // Handle multi-stream queries
    if (typeof params.query.query.sql !== "string") {
      url = `/api/${params.org_identifier}/_search_multi?type=${params.page_type}&search_type=${search_type}&use_cache=${use_cache}`;
      if (params.dashboard_id) url += `&dashboard_id=${params.dashboard_id}`;
      if (params.folder_id) url += `&folder_id=${params.folder_id}`;
      if (params.panel_id) url += `&panel_id=${params.panel_id}`;
      if (params.panel_name) url += `&panel_name=${encodeURIComponent(params.panel_name)}`;
      if (params.run_id) url += `&run_id=${params.run_id}`;
      if (params.tab_id) url += `&tab_id=${params.tab_id}`;
      if (params.tab_name) url += `&tab_name=${encodeURIComponent(params.tab_name)}`;
      
      if (params.query.hasOwnProperty("aggs")) {
        return http({ headers: { traceparent: params.traceparent } }).post(url, {
          ...params.query.query,
          aggs: (params.query as any).aggs,
        });
      } else {
        return http({ headers: { traceparent: params.traceparent } }).post(url, params.query.query);
      }
    }

    return http({ headers: { traceparent: params.traceparent } }).post(url, params.query);
  },

  /**
   * Gets partition data for histogram queries
   */
  partition: (params: PartitionParams) => {
    if (!params.traceparent) {
      params.traceparent = generateTraceContext()?.traceparent;
    }

    const use_cache: boolean =
      (window as any).use_cache !== undefined
        ? (window as any).use_cache
        : true;

    let url = `/api/${params.org_identifier}/partition?type=${params.page_type}&use_cache=${use_cache}`;
    
    if (params.enable_align_histogram) {
      url += `&enable_align_histogram=${params.enable_align_histogram}`;
    }

    return http({ headers: { traceparent: params.traceparent } }).post(url, params.query);
  },

  /**
   * Performs a search around operation
   */
  searchAround: (params: SearchAroundParams) => {
    if (!params.traceparent) {
      params.traceparent = generateTraceContext()?.traceparent;
    }

    let url = `/api/${params.org_identifier}/${params.index}/_around?key=${params.key}&size=${params.size}&stream_type=${params.stream_type}`;
    
    if (params.query_context) url += `&sql=${encodeURIComponent(params.query_context)}`;
    if (params.query_fn) url += `&query_fn=${encodeURIComponent(params.query_fn)}`;
    if (params.regions && params.regions.length > 0) {
      url += `&regions=${params.regions.join(",")}`;
    }
    if (params.clusters && params.clusters.length > 0) {
      url += `&clusters=${params.clusters.join(",")}`;
    }
    if (params.is_multistream) url += `&is_multistream=${params.is_multistream}`;
    if (params.action_id) url += `&action_id=${params.action_id}`;

    return http({ headers: { traceparent: params.traceparent } }).post(url, params.body);
  },

  /**
   * Schedules a search to be executed later
   */
  scheduleSearch: (params: ScheduledSearchParams, search_type: string = "ui") => {
    const traceparent = generateTraceContext()?.traceparent;
    
    const url = `/api/${params.org_identifier}/_search_jobs?type=${params.page_type}&search_type=${search_type}`;

    return http({ headers: { traceparent } }).post(url, params.query);
  },

  /**
   * Gets results from a scheduled search
   */
  getScheduledSearchResult: (
    params: {
      org_identifier: string;
      query: SearchRequestPayload;
      jobId: string;
      page_type: string;
      traceparent?: string;
    },
    search_type: string = "ui"
  ) => {
    if (!params.traceparent) {
      params.traceparent = generateTraceContext()?.traceparent;
    }

    const use_cache: boolean =
      (window as any).use_cache !== undefined
        ? (window as any).use_cache
        : true;

    const url = `/api/${params.org_identifier}/_search_job_result/${params.jobId}?type=${params.page_type}&search_type=${search_type}&use_cache=${use_cache}`;

    return http({ headers: { traceparent: params.traceparent } }).post(url, params.query);
  },

  /**
   * Gets currently running queries
   */
  getRunningQueries: (org_identifier: string) => {
    const traceparent = generateTraceContext()?.traceparent;
    return http({ headers: { traceparent } }).get(`/api/${org_identifier}/_queries`);
  },

  /**
   * Cancels running queries
   */
  cancelRunningQueries: (org_identifier: string, traceIDs: string[]) => {
    const traceparent = generateTraceContext()?.traceparent;
    return http({ headers: { traceparent } }).delete(`/api/${org_identifier}/_queries`, {
      data: { trace_ids: traceIDs },
    });
  },

  /**
   * Gets available regions
   */
  getRegions: () => {
    const traceparent = generateTraceContext()?.traceparent;
    return http({ headers: { traceparent } }).get("/api/clusters");
  },
};

export default logsApi;