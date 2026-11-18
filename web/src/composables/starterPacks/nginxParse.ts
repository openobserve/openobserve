// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { fnv1a } from "./useInstallRecords";

export type NginxFormat = "combined" | "main" | "error";

export type StreamReaderKind = "dashboard" | "alert" | "savedView" | "pipeline";

export interface StreamReader {
  kind: StreamReaderKind;
  name: string;
  /** A realtime pipeline already sources the stream, and the server allows only one. */
  realtimeSource?: boolean;
}

/** What the client can list, each row as the list endpoints return it. */
export interface StreamReaderSources {
  dashboards: any[];
  alerts: any[];
  savedViews: any[];
  pipelines: any[];
}

/** Install records for parse repairs share the pack record store under this id. */
export const PARSE_REPAIR_ID = "nginx_parse";

/** Only formats whose parser passed 5 of 5 reference lines on a server are offered. */
export const OFFERED_FORMATS: NginxFormat[] = ["combined", "main", "error"];

export const PREVIEW_RECORDS = 5;

const ERROR_LINE =
  /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \[(debug|info|notice|warn|error|crit|alert|emerg)\] \d+#\d+: /;
const ACCESS_LINE = /^\S+ \S+ \S+ \[[^\]]+\] "[^"]*" \d{3} \d+ "[^"]*" "[^"]*"/;
const MAIN_LINE = /^\S+ \S+ \S+ \[[^\]]+\] "[^"]*" \d{3} \d+ "[^"]*" "[^"]*" "[^"]*"\s*$/;

const lineFormat = (line: string): NginxFormat | null => {
  if (ERROR_LINE.test(line)) return "error";
  if (MAIN_LINE.test(line)) return "main";
  return ACCESS_LINE.test(line) ? "combined" : null;
};

/** The format most samples share, so a stream mixing formats is parsed by its main one. */
export const detectFormat = (samples: string[]): NginxFormat | null => {
  const counts = new Map<NginxFormat, number>();
  for (const sample of samples) {
    const format = lineFormat(sample);
    if (format) counts.set(format, (counts.get(format) ?? 0) + 1);
  }
  const [best] = [...counts].sort(([, a], [, b]) => b - a);
  return best && OFFERED_FORMATS.includes(best[0]) ? best[0] : null;
};

// Error lines carry no zone, so their time would depend on the server's; the error text keeps its own name.
const ERROR_RENAMES = "  parsed.error_message = del(parsed.message)\n  del(parsed.timestamp)\n";

/** VRL whose merge keeps every existing field as it was, so the parser only adds fields. */
export const parserSource = (format: NginxFormat, column: string) =>
  [
    `parsed, err = parse_nginx_log(.${column}, "${format}")`,
    "if err == null {",
    `${format === "error" ? ERROR_RENAMES : ""}  . = merge(parsed, .)`,
    "}",
    ".",
  ].join("\n");

/** Fields the parser added; changed or removed fields never count, since the merge forbids them. */
export const addedFields = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(after ?? {}).filter(([key]) => !(key in before)));

const NAME_SLUG_LENGTH = 32;

/** Readable slug plus a hash of the exact stream name, since the slug alone folds case and punctuation. */
export const repairName = (stream: string) => {
  const slug = stream
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, NAME_SLUG_LENGTH);
  return `starter_pack_nginx_${slug}_${fnv1a(stream)}`;
};

const streamNode = (id: string, org: string, stream: string, ioType: string, x: number) => ({
  id,
  position: { x, y: 100 },
  data: { node_type: "stream", stream_type: "logs", stream_name: stream, org_id: org },
  io_type: ioType,
});

/** A realtime pipeline that runs the parser on the stream and writes back to it. */
export const repairPipeline = (org: string, stream: string, functionName: string) => ({
  pipeline_id: "",
  version: 0,
  enabled: true,
  org,
  name: functionName,
  description: "",
  source: { source_type: "realtime" },
  paused_at: null,
  nodes: [
    streamNode("input", org, stream, "input", 100),
    {
      id: "parse",
      position: { x: 300, y: 200 },
      data: { node_type: "function", name: functionName, after_flatten: true, num_args: 0 },
      io_type: "default",
    },
    streamNode("output", org, stream, "output", 500),
  ],
  edges: [
    { id: "input-parse", source: "input", target: "parse" },
    { id: "parse-output", source: "parse", target: "output" },
  ],
});

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const queryReadsStream = (sql: unknown, stream: string) =>
  typeof sql === "string" &&
  new RegExp(`\\bfrom\\s+("${escapeRegex(stream)}"|${escapeRegex(stream)}(?![\\w-]))`, "i").test(
    sql,
  );

const dashboardReads = (row: any, stream: string) => {
  const body = row?.[`v${row?.version}`] ?? row?.v8 ?? {};
  const panels = [
    ...(body.panels ?? []),
    ...(body.tabs ?? []).flatMap((tab: any) => tab.panels ?? []),
  ];
  return panels.some((panel: any) =>
    (panel?.queries ?? []).some(
      (query: any) =>
        (query?.fields?.stream === stream && (query?.fields?.stream_type ?? "logs") === "logs") ||
        queryReadsStream(query?.query, stream),
    ),
  );
};

const viewStreams = (view: any): string[] => {
  const selected = view?.data?.data?.stream?.selectedStream ?? [];
  return (Array.isArray(selected) ? selected : []).map((entry: any) =>
    typeof entry === "string" ? entry : String(entry?.value ?? ""),
  );
};

const pipelineSources = (pipeline: any, stream: string) => {
  const inputs = (pipeline?.nodes ?? []).filter(
    (node: any) =>
      node?.io_type === "input" &&
      node?.data?.node_type === "stream" &&
      node?.data?.stream_name === stream &&
      (node?.data?.stream_type ?? "logs") === "logs",
  );
  const source = pipeline?.source ?? {};
  const realtime =
    source.source_type === "realtime" &&
    (source.stream_name === stream || inputs.length > 0) &&
    (source.stream_type ?? "logs") === "logs";
  return { reads: realtime || inputs.length > 0, realtime };
};

/** Everything listed that reads the stream, so the dialog can say who sees the new fields. */
export const streamReaders = (sources: StreamReaderSources, stream: string): StreamReader[] => [
  ...sources.dashboards
    .filter((row) => dashboardReads(row, stream))
    .map((row) => ({
      kind: "dashboard" as const,
      name: String(row?.title ?? row?.[`v${row?.version}`]?.title ?? ""),
    })),
  ...sources.alerts
    .filter((row) => row?.stream_name === stream && (row?.stream_type ?? "logs") === "logs")
    .map((row) => ({ kind: "alert" as const, name: String(row?.name ?? "") })),
  ...sources.savedViews
    .filter((view) => viewStreams(view).includes(stream))
    .map((view) => ({ kind: "savedView" as const, name: String(view?.view_name ?? "") })),
  ...sources.pipelines.flatMap((pipeline): StreamReader[] => {
    const { reads, realtime } = pipelineSources(pipeline, stream);
    if (!reads) return [];
    return [{ kind: "pipeline", name: String(pipeline?.name ?? ""), realtimeSource: realtime }];
  }),
];
