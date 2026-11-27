// Copyright 2026 OpenObserve Inc.

import type { DashboardFilterGroup } from "@/components/filterBar/codecs/dashboardFilterCodec";
import type { MetricStream } from "@/utils/metrics/metricFamily";

export interface DashboardSchemaField {
  name: string;
  type?: string;
  [key: string]: unknown;
}

export interface DashboardStreamGroup {
  name: string;
  stream_alias?: string;
  schema: DashboardSchemaField[];
  settings?: { defined_schema_fields?: string[]; full_text_search_keys?: string[] };
}

export interface DashboardStreamResult extends MetricStream {
  stats?: { doc_num?: number; doc_time_min?: number; doc_time_max?: number };
}

export interface DashboardPanelQuery {
  query?: string;
  customQuery?: boolean;
  joins?: { stream?: string; streamAlias?: string }[];
  fields: {
    stream: string;
    stream_type: string;
    filter?: DashboardFilterGroup;
    [slot: string]: unknown;
  };
}

/** The slice of a page's `dashboardPanelData` the field panel reads and writes. */
export interface DashboardPanelState {
  data: { type: string; queryType?: string; queries: DashboardPanelQuery[] };
  layout: { currentQueryIndex: number };
  meta: {
    stream: {
      streamResults: DashboardStreamResult[];
      streamResultsType?: string;
      filterField: string;
      customQueryFields: DashboardSchemaField[];
      vrlFunctionFieldList: DashboardSchemaField[];
    };
    streamFields: { groupedFields: DashboardStreamGroup[] };
    dragAndDrop: {
      dragging: boolean;
      dragElement: unknown;
      dragSource: string | null;
      dragSourceIndex: number | null;
    };
  };
}
