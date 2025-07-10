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
        
    const url = `/api/${org_identifier}/_search_stream?type=${page_type}&search_type=${search_type}&use_cache=${use_cache}&trace_id=${traceId}`;
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
  }
};

export default stream; 