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

import type { StreamInfo } from "@/services/service_streams";
import {
  metricWhereConditions,
  type MetricsCorrelationConfig,
} from "@/composables/useMetricsCorrelationDashboard";

export interface MetricDataCheckInput {
  streams: StreamInfo[];
  /** Resolves true when the stream has at least one row in scope; rejects when the probe fails. */
  probe: (stream: StreamInfo) => Promise<boolean>;
  concurrency?: number;
  signal?: AbortSignal;
}

export interface MetricProbeTarget {
  stream: StreamInfo;
  where: string;
}

type WhereScope = Pick<
  MetricsCorrelationConfig,
  "matchedDimensions" | "semanticGroups" | "metricSchemas"
>;

const DEFAULT_CONCURRENCY = 4;

/** Pairs each served stream with its chart's WHERE; the server judged `has_data` on served filters only, so others are probed. */
export function metricProbeTargets(
  served: StreamInfo[],
  charted: (stream: StreamInfo) => StreamInfo,
  scope: WhereScope,
): MetricProbeTarget[] {
  return served.map((original) => {
    const stream = charted(original);
    const where = metricWhereConditions(stream, scope);
    const servedWhere = metricWhereConditions(original, {
      matchedDimensions: {},
      semanticGroups: scope.semanticGroups,
    });
    const has_data = where === servedWhere ? original.has_data : undefined;
    return { stream: { ...stream, has_data }, where };
  });
}

/** SQL that asks whether a metric stream has any row under the chart's WHERE. */
export function metricExistenceSql(streamName: string, whereConditions: string): string {
  const where = whereConditions ? ` WHERE ${whereConditions}` : "";
  return `SELECT _timestamp FROM "${streamName}"${where} LIMIT 1`;
}

/** Streams with no rows in scope: `has_data` wins, others are probed. */
// Null when every probe failed, so the caller keeps today's selection.
export async function findNoDataMetricStreams(
  input: MetricDataCheckInput,
): Promise<Set<string> | null> {
  const noData = new Set<string>();
  const toProbe: StreamInfo[] = [];
  for (const stream of input.streams) {
    if (stream.has_data === false) noData.add(stream.stream_name);
    else if (stream.has_data === undefined) toProbe.push(stream);
  }
  if (toProbe.length === 0) return noData;

  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < toProbe.length) {
      if (input.signal?.aborted) return;
      const stream = toProbe[next++];
      try {
        if (!(await input.probe(stream))) noData.add(stream.stream_name);
      } catch {
        failed++;
      }
    }
  };
  const lanes = Math.max(1, Math.min(input.concurrency ?? DEFAULT_CONCURRENCY, toProbe.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  if (input.signal?.aborted) return null;
  return failed === toProbe.length && noData.size === 0 ? null : noData;
}
