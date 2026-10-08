// Copyright 2026 OpenObserve Inc.

const STORAGE_KEYS = {
  logs: (orgId: string) => `oo_selected_stream_logs_${orgId}`,
  traces: (orgId: string) => `oo_selected_stream_traces_${orgId}`,
  metrics: (orgId: string) => `oo_selected_stream_metrics_${orgId}`,
  logsStreamType: (orgId: string) => `oo_logs_stream_type_${orgId}`,
};

const DASHBOARD_STREAM_TYPES = ["logs", "metrics", "traces"];

const DASHBOARD_KEYS = {
  streamType: (orgId: string) => `oo_dashboard_panel_stream_type_${orgId}`,
  stream: (orgId: string, streamType: string) => `oo_dashboard_panel_stream_${streamType}_${orgId}`,
};

export function saveLogsStream(orgId: string, streams: string[]): void {
  if (!orgId) return;
  if (streams.length) {
    localStorage.setItem(STORAGE_KEYS.logs(orgId), JSON.stringify(streams));
  } else {
    localStorage.removeItem(STORAGE_KEYS.logs(orgId));
  }
}

export function restoreLogsStream(orgId: string): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.logs(orgId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTracesStream(orgId: string, stream: string): void {
  if (!orgId || !stream) return;
  localStorage.setItem(STORAGE_KEYS.traces(orgId), stream);
}

export function restoreTracesStream(orgId: string): string {
  return localStorage.getItem(STORAGE_KEYS.traces(orgId)) || "";
}

export function saveMetricsStream(orgId: string, stream: string): void {
  if (!orgId || !stream) return;
  localStorage.setItem(STORAGE_KEYS.metrics(orgId), stream);
}

export function restoreMetricsStream(orgId: string): string {
  return localStorage.getItem(STORAGE_KEYS.metrics(orgId)) || "";
}

export function saveLogsStreamType(orgId: string, streamType: string): void {
  if (!orgId || !streamType) return;
  localStorage.setItem(STORAGE_KEYS.logsStreamType(orgId), streamType);
}

export function restoreLogsStreamType(orgId: string): string {
  return localStorage.getItem(STORAGE_KEYS.logsStreamType(orgId)) || "logs";
}

const readStorage = (key: string): string => {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
};

/** Remembers the stream a dashboard panel was saved with, per org and stream type. */
export function saveDashboardPanelStream(orgId: string, streamType: string, stream: string): void {
  if (!orgId || !stream || !DASHBOARD_STREAM_TYPES.includes(streamType)) return;
  try {
    localStorage.setItem(DASHBOARD_KEYS.streamType(orgId), streamType);
    localStorage.setItem(DASHBOARD_KEYS.stream(orgId, streamType), stream);
  } catch {
    // Storage can be full or disabled; the next panel then falls back to the first stream.
  }
}

export function restoreDashboardPanelStreamType(orgId: string): string {
  const streamType = readStorage(DASHBOARD_KEYS.streamType(orgId));
  return DASHBOARD_STREAM_TYPES.includes(streamType) ? streamType : "";
}

const lastStreamsOfType = (orgId: string, streamType: string): string[] => {
  const dashboardStream = readStorage(DASHBOARD_KEYS.stream(orgId, streamType));
  let explored: string[] = [];
  try {
    if (streamType === "logs") explored = restoreLogsStream(orgId);
    if (streamType === "traces") explored = [restoreTracesStream(orgId)];
    if (streamType === "metrics") explored = [restoreMetricsStream(orgId)];
  } catch {
    explored = [];
  }
  return [dashboardStream, ...explored].filter(Boolean);
};

export interface DashboardStreamOption {
  name: string;
  stats?: { doc_num?: number; doc_time_max?: number };
}

const hasData = (stream: DashboardStreamOption) =>
  (stream.stats?.doc_num ?? 0) > 0 || (stream.stats?.doc_time_max ?? 0) > 0;

/**
 * Default stream for a new dashboard panel: last saved panel stream, then the last explored
 * stream, then the most recently ingested non-internal stream, then the first one.
 */
export function pickDashboardPanelStream(
  orgId: string,
  streamType: string,
  available: Array<string | DashboardStreamOption>,
): string {
  const streams = available.map((stream) =>
    typeof stream === "string" ? { name: stream } : stream,
  );
  const names = streams.map((stream) => stream.name);
  const remembered = lastStreamsOfType(orgId, streamType).find((name) => names.includes(name));
  if (remembered) return remembered;
  // Underscore-prefixed streams are internal (e.g. _agent_signals) and usually empty for the user.
  const userStreams = streams.filter((stream) => !stream.name.startsWith("_"));
  const freshest = userStreams
    .filter(hasData)
    .sort((a, b) => (b.stats?.doc_time_max ?? 0) - (a.stats?.doc_time_max ?? 0))[0];
  return freshest?.name ?? userStreams[0]?.name ?? names[0] ?? "";
}
