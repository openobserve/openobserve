import { b64EncodeUnicode } from "@/utils/zincutils";
import type {
  CompareArm,
  CompareResponse,
  Endpoint,
  ErrorEvidence,
} from "@/services/service_versions";
const literal = (value: string) => value.replace(/'/g, "''");
function link(path: string, params: Record<string, string | number>) {
  return `${path}?${new URLSearchParams(Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])))}`;
}
function versionScope(service: string, arm: CompareArm, where: string) {
  return `service_name = '${literal(service)}' AND o2_service_version = '${literal(arm.version)}' AND o2_service_where = '${literal(where)}'`;
}
function bounded(arm: CompareArm) {
  return Number.isFinite(arm.start_time) && Number.isFinite(arm.end_time);
}
// An env_fallback baseline runs in another where, so arm B never borrows the compared where.
export function armWhere(result: CompareResponse, side: "a" | "b") {
  if (side === "a") return result.where_key || undefined;
  if (result.arms.b.where_key) return result.arms.b.where_key;
  return result.baseline_rule === "env_fallback" ? undefined : result.where_key || undefined;
}
export function traceEvidence(
  org: string,
  service: string,
  arm: CompareArm,
  where: string | undefined,
  endpoint: Endpoint,
  slow = false,
) {
  if (!where || !endpoint.source_stream || !bounded(arm)) return undefined;
  if (slow && !Number.isFinite(endpoint.baseline_p95_us)) return undefined;
  const query = `${versionScope(service, arm, where)} AND operation_name = '${literal(endpoint.operation)}' AND ${slow ? `duration > ${endpoint.baseline_p95_us}` : "span_status = 'ERROR'"}`;
  return link("/web/traces", {
    org_identifier: org,
    tab: "spans",
    stream: endpoint.source_stream,
    from: arm.start_time,
    to: arm.end_time,
    query: b64EncodeUnicode(query) ?? "",
  });
}
export function serviceErrors(
  org: string,
  service: string,
  arm: CompareArm,
  where: string | undefined,
  stream: string,
) {
  if (!where || !stream || !bounded(arm)) return undefined;
  const query = `${versionScope(service, arm, where)} AND span_status = 'ERROR'`;
  return link("/web/traces", {
    org_identifier: org,
    tab: "spans",
    stream,
    from: arm.start_time,
    to: arm.end_time,
    query: b64EncodeUnicode(query) ?? "",
  });
}
export function rumEvidence(org: string, service: string, arm: CompareArm, error: ErrorEvidence) {
  if (!error.error_type || error.error_message === undefined || !bounded(arm)) return undefined;
  const query = `service = '${literal(service)}' AND version = '${literal(arm.version)}' AND type = 'error' AND error_type = '${literal(error.error_type)}' AND error_message = '${literal(error.error_message)}'`;
  return link("/web/rum/sessions", {
    org_identifier: org,
    from: arm.start_time,
    to: arm.end_time,
    query: b64EncodeUnicode(query) ?? "",
  });
}
export function errorDetails(org: string, error: ErrorEvidence) {
  return error.sample_error_id && error.sample_ts !== undefined
    ? link(`/web/rum/errors/view/${encodeURIComponent(error.sample_error_id)}`, {
        org_identifier: org,
        timestamp: error.sample_ts,
      })
    : undefined;
}
// Pages are normalised paths (ids folded to :id), so the sessions filter matches the path shape, not one URL.
export function rumPageSessions(org: string, service: string, arm: CompareArm, page: string) {
  if (!page || !bounded(arm)) return undefined;
  const path = page
    .split("/")
    .map((part) => (part === ":id" ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  const pattern = `^[A-Za-z][A-Za-z0-9+.-]*://[^/]*${path === "/" ? "" : path}/?([?#].*)?$`;
  const query = `service = '${literal(service)}' AND version = '${literal(arm.version)}' AND re_match(view_url, '${literal(pattern)}')`;
  return link("/web/rum/sessions", {
    org_identifier: org,
    from: arm.start_time,
    to: arm.end_time,
    query: b64EncodeUnicode(query) ?? "",
  });
}
