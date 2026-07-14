import http from "./http";

const formatPromqlQuery = ({ org_identifier = "", query = "" }) => {
  return http().get(
    `/api/${org_identifier}/prometheus/api/v1/format_query?query=${query}`
  );
};

const get_promql_series = ({
  org_identifier,
  labels,
  start_time,
  end_time,
}: {
  org_identifier: string;
  labels: string;
  start_time: number;
  end_time: number;
}) => {
  const url = `/api/${org_identifier}/prometheus/api/v1/series?match[]=${labels}&start=${start_time}&end=${end_time}`;
  return http().get(url);
};

/**
 * Org-wide label names, for the metrics explorer's label-filter picker.
 * Routed in the backend at src/handler/http/router/mod.rs:676.
 */
const labels = ({
  org_identifier,
  start_time,
  end_time,
  signal,
}: {
  org_identifier: string;
  start_time: number;
  end_time: number;
  signal?: AbortSignal;
}) => {
  const url = `/api/${org_identifier}/prometheus/api/v1/labels?start=${start_time}&end=${end_time}`;
  return signal ? http().get(url, { signal }) : http().get(url);
};

/**
 * Label values for a single label, scoped to one metric.
 *
 * The endpoint returns an EMPTY list unless `match[]` names a metric
 * (src/service/metrics/prom.rs, marked HACK in source), and it accepts only one
 * selector per request. A global value picker therefore has to fan out over a
 * sample of matching streams and union the results — see the explorer's bounded
 * 5-request fan-out in useMetricsExplorerGrid.
 */
const labelValues = ({
  org_identifier,
  label,
  match,
  start_time,
  end_time,
  signal,
}: {
  org_identifier: string;
  label: string;
  match: string;
  start_time: number;
  end_time: number;
  signal?: AbortSignal;
}) => {
  const url = `/api/${org_identifier}/prometheus/api/v1/label/${encodeURIComponent(
    label,
  )}/values?match[]=${encodeURIComponent(
    match,
  )}&start=${start_time}&end=${end_time}`;
  return signal ? http().get(url, { signal }) : http().get(url);
};

/**
 * Prometheus metadata: `{ metric: [{ type, help, unit }] }`.
 *
 * The streams response already carries `metrics_meta`, so the explorer's
 * landing path does not need this. Kept for refresh/repair paths.
 */
const metadata = ({
  org_identifier,
  metric,
  limit,
}: {
  org_identifier: string;
  metric?: string;
  limit?: number;
}) => {
  const params = new URLSearchParams();
  if (metric) params.set("metric", metric);
  if (limit != null) params.set("limit", String(limit));
  const qs = params.toString();
  return http().get(
    `/api/${org_identifier}/prometheus/api/v1/metadata${qs ? `?${qs}` : ""}`,
  );
};

export default {
  formatPromqlQuery,
  get_promql_series,
  labels,
  labelValues,
  metadata,
};
