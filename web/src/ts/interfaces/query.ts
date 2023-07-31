export interface Query {
  from: number;
  size: number;
  sql: string;
  sql_mode: string;
}

export interface QueryPayload {
  sql: string;
  start_time: number;
  end_time: number;
  from: number;
  size: number;
}

export interface histogramQueryPayload {
  histogram: string;
}

export interface LogsQueryPayload {
  query: QueryPayload;
  aggs?: histogramQueryPayload;
}
