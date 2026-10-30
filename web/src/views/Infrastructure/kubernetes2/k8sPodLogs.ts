// Copyright 2026 OpenObserve Inc.

export interface LogLine {
  id: string;
  // µs
  ts: number;
  text: string;
  container: string;
  restart: number;
}

export interface LogFilter {
  query: string;
  container: string | null;
  previous: boolean;
}

export const LOG_LINE_LIMIT = 500;

const TEXT_FIELDS = ["body", "log", "message", "_raw"];
const CONTAINER_FIELDS = ["k8s_container_name", "container_name", "container"];

const firstOf = (hit: Record<string, any>, fields: string[]) => {
  for (const field of fields) if (hit[field] != null && hit[field] !== "") return hit[field];
  return null;
};

export const logsSql = (stream: string, filter: string) =>
  `SELECT * FROM "${stream}" WHERE ${filter} ORDER BY _timestamp DESC`;

// Oldest first, as a terminal prints them.
export function parseLogHits(hits: Record<string, any>[]): LogLine[] {
  return hits
    .map((hit, index) => {
      const text = firstOf(hit, TEXT_FIELDS);
      return {
        id: `${hit._timestamp}-${index}`,
        ts: Number(hit._timestamp ?? 0),
        text: typeof text === "string" ? text : JSON.stringify(text ?? ""),
        container: String(firstOf(hit, CONTAINER_FIELDS) ?? ""),
        restart: Number(hit.k8s_container_restart_count ?? 0),
      };
    })
    .sort((a, b) => a.ts - b.ts);
}

export const containersOf = (lines: LogLine[]) =>
  [...new Set(lines.map((l) => l.container).filter(Boolean))].sort();

// "Previous" means the container instance before that container's own latest restart.
export function filterLines(lines: LogLine[], filter: LogFilter): LogLine[] {
  const latestOf = new Map<string, number>();
  for (const l of lines)
    latestOf.set(l.container, Math.max(latestOf.get(l.container) ?? 0, l.restart));
  const needle = filter.query.trim().toLowerCase();
  return lines.filter(
    (line) =>
      (filter.container == null || line.container === filter.container) &&
      (filter.previous
        ? line.restart < (latestOf.get(line.container) ?? 0)
        : line.restart === (latestOf.get(line.container) ?? 0)) &&
      (!needle || line.text.toLowerCase().includes(needle)),
  );
}

export const LEVEL_PATTERN = /\b(error|err|fatal|panic|exception)\b/i;
export const WARN_PATTERN = /\b(warn|warning)\b/i;

// `error=<nil>` and `"error":""` log the absence of an error.
const EMPTY_ERROR_PATTERN = /\b(?:error|err)\b"?\s*[:=]\s*(?:<nil>|nil\b|null\b|none\b|""|'')/gi;

export const lineLevel = (text: string): "error" | "warning" | null => {
  if (LEVEL_PATTERN.test(text.replace(EMPTY_ERROR_PATTERN, ""))) return "error";
  return WARN_PATTERN.test(text) ? "warning" : null;
};
