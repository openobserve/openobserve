import { generateTraceContext } from "@/utils/zincutils";
import http from "./http";

const stream = {
  // HTTP/2 streaming search endpoint with SSE
  searchStreamUrl: (
    {
      org_identifier,
      page_type = "logs",
      search_type = "ui",
      traceId,
    }: {
      org_identifier: string;
      page_type: string;
      search_type?: string;
      traceId: string;
    }
  ) => {
    const use_cache: boolean =
      (window as any).use_cache !== undefined
        ? (window as any).use_cache
        : true;
    
    return `/api/${org_identifier}/_search_stream?type=${page_type}&search_type=${search_type}&use_cache=${use_cache}&trace_id=${traceId}`;
  },
  
  // HTTP/2 streaming histogram endpoint with SSE
  histogramStreamUrl: (
    {
      org_identifier,
      page_type = "logs",
      search_type = "ui",
      traceId,
    }: {
      org_identifier: string;
      page_type: string;
      search_type?: string;
      traceId: string;
    }
  ) => {
    const use_cache: boolean =
      (window as any).use_cache !== undefined
        ? (window as any).use_cache
        : true;
        
    return `/api/${org_identifier}/_search_histogram_stream?type=${page_type}&search_type=${search_type}&use_cache=${use_cache}&trace_id=${traceId}`;
  },
  
  // HTTP/2 streaming page count endpoint with SSE
  pageCountStreamUrl: (
    {
      org_identifier,
      page_type = "logs",
      search_type = "ui",
      traceId,
    }: {
      org_identifier: string;
      page_type: string;
      search_type?: string;
      traceId: string;
    }
  ) => {
    const use_cache: boolean =
      (window as any).use_cache !== undefined
        ? (window as any).use_cache
        : true;
        
    return `/api/${org_identifier}/_search_pagecount_stream?type=${page_type}&search_type=${search_type}&use_cache=${use_cache}&trace_id=${traceId}`;
  },
  
  // HTTP/2 streaming values endpoint with SSE for field value lookups
  fieldValuesStreamUrl: (
    {
      org_identifier,
      fields,
      stream_name,
      page_type = "logs",
      traceId,
    }: {
      org_identifier: string;
      fields: string[];
      stream_name: string;
      page_type: string;
      traceId: string;
    }
  ) => {
    const fieldsString = fields.join(',');
    const use_cache: boolean =
      (window as any).use_cache !== undefined
        ? (window as any).use_cache
        : true;
        
    return `/api/${org_identifier}/${stream_name}/_values_stream?fields=${fieldsString}&type=${page_type}&use_cache=${use_cache}&trace_id=${traceId}`;
  },
  
  // Start a streaming search request
  search: (
    {
      org_identifier,
      query,
      page_type = "logs",
      search_type = "ui",
      traceId,
      clear_cache = false,
    }: {
      org_identifier: string;
      query: any;
      page_type: string;
      search_type?: string;
      traceId?: string;
      clear_cache?: boolean;
    }
  ) => {
    if (!traceId) {
      traceId = generateTraceContext()?.traceId;
    }
    
    const use_cache: boolean =
      (window as any).use_cache !== undefined
        ? (window as any).use_cache
        : true;
        
    const url = `/api/${org_identifier}/_search_stream?type=${page_type}&search_type=${search_type}&use_cache=${use_cache}&trace_id=${traceId}&clear_cache=${clear_cache}`;
    return http().post(url, query);
  },
  
  // Start a streaming multi-stream search request
  searchMulti: (
    {
      org_identifier,
      query,
      page_type = "logs",
      search_type = "ui",
      traceId,
    }: {
      org_identifier: string;
      query: any;
      page_type: string;
      search_type?: string;
      traceId?: string;
    }
  ) => {
    if (!traceId) {
      traceId = generateTraceContext()?.traceId;
    }
    
    const use_cache: boolean =
      (window as any).use_cache !== undefined
        ? (window as any).use_cache
        : true;
        
    const url = `/api/${org_identifier}/_search_multi_stream?type=${page_type}&search_type=${search_type}&use_cache=${use_cache}&trace_id=${traceId}`;
    return http().post(url, query);
  },
  
  // Start a streaming histogram request
  histogram: (
    {
      org_identifier,
      query,
      page_type = "logs",
      search_type = "ui",
      traceId,
    }: {
      org_identifier: string;
      query: any;
      page_type: string;
      search_type?: string;
      traceId?: string;
    }
  ) => {
    if (!traceId) {
      traceId = generateTraceContext()?.traceId;
    }
    
    const use_cache: boolean =
      (window as any).use_cache !== undefined
        ? (window as any).use_cache
        : true;
        
    const url = `/api/${org_identifier}/_search_histogram_stream?type=${page_type}&search_type=${search_type}&use_cache=${use_cache}&trace_id=${traceId}`;
    return http().post(url, query);
  },
  
  // Start a streaming page count request
  pageCount: (
    {
      org_identifier,
      query,
      page_type = "logs",
      search_type = "ui",
      traceId,
    }: {
      org_identifier: string;
      query: any;
      page_type: string;
      search_type?: string;
      traceId?: string;
    }
  ) => {
    if (!traceId) {
      traceId = generateTraceContext()?.traceId;
    }
    
    const use_cache: boolean =
      (window as any).use_cache !== undefined
        ? (window as any).use_cache
        : true;
        
    const url = `/api/${org_identifier}/_search_pagecount_stream?type=${page_type}&search_type=${search_type}&use_cache=${use_cache}&trace_id=${traceId}`;
    return http().post(url, query);
  },
  
  // Fetch field values using streaming
  fieldValues: (
    {
      org_identifier,
      stream_name,
      fields,
      query,
      page_type = "logs",
      traceId,
    }: {
      org_identifier: string;
      stream_name: string;
      fields: string[];
      query: any;
      page_type: string;
      traceId?: string;
    }
  ) => {
    if (!traceId) {
      traceId = generateTraceContext()?.traceId;
    }
    
    const fieldsString = fields.join(',');
    const use_cache: boolean =
      (window as any).use_cache !== undefined
        ? (window as any).use_cache
        : true;
        
    const url = `/api/${org_identifier}/${stream_name}/_values_stream?fields=${fieldsString}&type=${page_type}&use_cache=${use_cache}&trace_id=${traceId}`;
    return http().post(url, query);
  },
  
  // Cancel an ongoing HTTP/2 stream
  cancelStream: async (
    {
      org_identifier,
      traceId,
    }: {
      org_identifier: string;
      traceId: string;
    }
  ) => {
    const url = `/api/${org_identifier}/query_manager/cancel`;
    return http().put(url, [traceId]);
  },

  // HTTP/2 streaming PromQL query range endpoint with SSE
  promqlQueryRangeStreamUrl: (
    {
      org_identifier,
      traceId,
    }: {
      org_identifier: string;
      traceId: string;
    }
  ) => {
    const use_cache: boolean =
      (window as any).use_cache !== undefined
        ? (window as any).use_cache
        : true;

    return `/api/${org_identifier}/prometheus/api/v1/query_range?use_streaming=true&use_cache=${use_cache}&trace_id=${traceId}`;
  },

  // Start a streaming PromQL query range request
  promqlQueryRange: (
    {
      org_identifier,
      query,
      start_time,
      end_time,
      step,
      traceId,
      dashboard_id,
      dashboard_name,
      folder_id,
      folder_name,
      panel_id,
      panel_name,
      run_id,
      tab_id,
      tab_name,
    }: {
      org_identifier: string;
      query: string;
      start_time: number;
      end_time: number;
      step: string;
      traceId?: string;
      dashboard_id?: string;
      dashboard_name?: string;
      folder_id?: string;
      folder_name?: string;
      panel_id?: string;
      panel_name?: string;
      run_id?: string;
      tab_id?: string;
      tab_name?: string;
    }
  ) => {
    if (!traceId) {
      traceId = generateTraceContext()?.traceId;
    }

    const use_cache: boolean =
      (window as any).use_cache !== undefined
        ? (window as any).use_cache
        : true;

    let url = `/api/${org_identifier}/prometheus/api/v1/query_range?use_streaming=true&use_cache=${use_cache}&trace_id=${traceId}&start=${start_time}&end=${end_time}&step=${step}&query=${encodeURIComponent(query)}`;

    if (dashboard_id) url += `&dashboard_id=${dashboard_id}`;
    if (dashboard_name) url += `&dashboard_name=${encodeURIComponent(dashboard_name)}`;
    if (folder_id) url += `&folder_id=${folder_id}`;
    if (folder_name) url += `&folder_name=${encodeURIComponent(folder_name)}`;
    if (panel_id) url += `&panel_id=${panel_id}`;
    if (panel_name) url += `&panel_name=${encodeURIComponent(panel_name)}`;
    if (run_id) url += `&run_id=${run_id}`;
    if (tab_id) url += `&tab_id=${tab_id}`;
    if (tab_name) url += `&tab_name=${encodeURIComponent(tab_name)}`;

    return http().post(url);
  }
};

export default stream; 