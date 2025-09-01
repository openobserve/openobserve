export enum PageType {
  LOGS = "logs",
  STREAM_EXPLORER = "stream_explorer",
  TRACE_EXPLORER = "trace_explorer",
  VISUALIZE = "visualize",
}

export interface ActivationState {
  isSearchTab: boolean;
  isStreamExplorer: boolean;
  isTraceExplorer: boolean;
  isStreamChanged: boolean;
}

export interface TimestampRange {
  from: number;
  to: number;
}

export interface SQLColumn {
  expr: any;
  as?: string;
}

export interface SQLFrom {
  table: string;
  as?: string;
}

export interface SQLOrderBy {
  expr: any;
  type: "ASC" | "DESC";
}

export interface SQLLimit {
  seperator?: string;
  value: number[];
}

export interface SQLGroupBy {
  type: string;
  value: any;
}[];

export interface SQLWhere {
  type: string;
  left: any;
  operator: string;
  right: any;
}

export interface ParsedSQLResult {
  columns: SQLColumn[];
  from: SQLFrom[];
  orderby: SQLOrderBy[] | null;
  limit: SQLLimit | null;
  groupby: SQLGroupBy | null;
  where: SQLWhere | null;
}

export type TimePeriodUnit = "s" | "m" | "h" | "d" | "w" | "M";
