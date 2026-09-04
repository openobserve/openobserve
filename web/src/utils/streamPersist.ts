// Copyright 2026 OpenObserve Inc.

const STORAGE_KEYS = {
  logs: (orgId: string) => `oo_selected_stream_logs_${orgId}`,
  traces: (orgId: string) => `oo_selected_stream_traces_${orgId}`,
  metrics: (orgId: string) => `oo_selected_stream_metrics_${orgId}`,
  logsStreamType: (orgId: string) => `oo_logs_stream_type_${orgId}`,
};

export function saveLogsStream(orgId: string, streams: string[]): void {
  if (!orgId || !streams.length) return;
  localStorage.setItem(STORAGE_KEYS.logs(orgId), JSON.stringify(streams));
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
