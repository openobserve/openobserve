export const RESOURCE_KINDS = [
  "dashboard",
  "alert",
  "stream",
  "function",
  "pipeline",
  "synthetic",
  "user",
  "service_account",
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type ResourceAlertType = "scheduled" | "realtime" | "composite" | "anomaly_detection";
export interface ResourceRouteMap {
  dashboard: { dashboard_id: string; folder_id: string };
  alert: { alert_id: string; folder_id: string; alert_type: ResourceAlertType };
  stream: { stream_type: "logs" | "metrics" | "traces"; stream_name: string };
  function: { function_name: string };
  pipeline: { pipeline_id: string };
  synthetic: { check_id: string; folder_id: string };
  user: { email: string };
  service_account: { email: string };
}
export type ResourceHit = {
  [Kind in ResourceKind]: {
    type: Kind;
    id: string;
    name: string;
    folder_id?: string;
    folder_name?: string;
    enabled?: boolean;
    route_ref: ResourceRouteMap[Kind];
    match_tier?:
      | "exact_name"
      | "exact_id"
      | "name_prefix"
      | "word_prefix"
      | "name_substring"
      | "email_substring";
  };
}[ResourceKind];
export interface ResourceSource {
  type: ResourceKind;
  status: "complete" | "partial" | "unavailable";
  has_more: boolean | null;
  next_cursor?: string;
  reason?:
    | "loading"
    | "disabled"
    | "permission_denied"
    | "permission_unavailable"
    | "resource_exhausted"
    | "source_unavailable";
}
export interface ResourceSearchResponse {
  hits: ResourceHit[];
  sources: ResourceSource[];
  took_ms: number;
}
export interface ResourceSearchParams {
  q: string;
  types?: ResourceKind[];
  limit?: number;
  cursor?: string;
}
