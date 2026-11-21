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

import type { StreamsByType } from "@/types/alertLibrary";
import { DETECTION_STREAMS } from "@/views/Infrastructure/kubernetes2/kubernetesQueries";

import type { BindingSources } from "./packBinding";
import { bestRoleStream, type StreamFacts } from "./streamCandidates";
import type { PackDetectStream, PackRepair, StarterPack } from "./types";

export type ReadColumns = (type: string, name: string) => Promise<string[]>;

const LOG_STREAM_CAP = 50;
const STREAM_READS_AT_ONCE = 8;

const hasFields = async (
  type: string,
  name: string,
  fields: string[],
  readColumns: ReadColumns,
): Promise<boolean> => {
  try {
    const columns = new Set((await readColumns(type, name)).map((column) => column.toLowerCase()));
    return fields.every((field) => columns.has(field.toLowerCase()));
  } catch {
    return false;
  }
};

const matchingStreams = async (
  rule: PackDetectStream,
  orgStreams: StreamsByType,
  readColumns: ReadColumns,
): Promise<string[]> => {
  const names = [...(orgStreams[rule.type]?.keys() ?? [])].filter(
    (name) => !rule.name || name.toLowerCase() === rule.name.toLowerCase(),
  );
  if (!rule.fields?.length) return names;
  const fits = await Promise.all(
    names.map((name) => hasFields(rule.type, name, rule.fields!, readColumns)),
  );
  return names.filter((_name, index) => fits[index]);
};

const hasLogStream = (name: string, logs: Map<string, number>) =>
  [...logs.keys()].some((actual) => actual.toLowerCase() === name.toLowerCase());

// Same cap and order as the setup popup, so detection never offers a stream it would not.
const recentLogs = (logs: Map<string, number>) => {
  const timed = [...logs].filter(([, lastIngested]) => lastIngested > 0);
  const rows = timed.length ? timed.sort((left, right) => right[1] - left[1]) : [...logs];
  return rows.slice(0, LOG_STREAM_CAP);
};

const logFacts = async (rows: Array<[string, number]>, readColumns: ReadColumns) => {
  const facts: StreamFacts[] = [];
  for (let start = 0; start < rows.length; start += STREAM_READS_AT_ONCE) {
    const batch = rows.slice(start, start + STREAM_READS_AT_ONCE);
    const columns = await Promise.all(
      batch.map(([name]) => readColumns("logs", name).catch(() => [] as string[])),
    );
    batch.forEach(([name, lastIngested], index) =>
      facts.push({ name, lastIngested, columns: new Set(columns[index]) }),
    );
  }
  return facts;
};

/** Points each role a named logs rule misses at the stream that fits it, so a renamed stream still counts. */
export const roleRepairs = async (
  pack: StarterPack,
  orgStreams: StreamsByType,
  readColumns: ReadColumns,
  sources: BindingSources = { groups: [], aliases: pack.aliases ?? [] },
): Promise<PackRepair[]> => {
  const logs = orgStreams.logs ?? new Map<string, number>();
  const named = (pack.detectStreams ?? []).flatMap(({ type, name }) =>
    type === "logs" && name ? [name.toLowerCase()] : [],
  );
  const roles = (pack.roles ?? []).filter(
    ({ stream }) => named.includes(stream.toLowerCase()) && !hasLogStream(stream, logs),
  );
  if (!roles.length) return [];
  const facts = await logFacts(recentLogs(logs), readColumns);
  return roles.flatMap((role) => {
    const to = bestRoleStream(role, facts, sources);
    return to ? [{ from: role.stream, to }] : [];
  });
};

/** The org streams that show the pack's source is reporting; none means the pack cannot fit. */
export const detectedStreams = async (
  pack: StarterPack,
  orgStreams: StreamsByType,
  readColumns: ReadColumns,
  readGuessColumns: ReadColumns = readColumns,
): Promise<string[]> => {
  const metrics = orgStreams.metrics ?? new Map<string, number>();
  const found = [
    ...(pack.signals ?? []).flat().filter((name) => metrics.has(name)),
    ...(pack.detector === "kubernetes"
      ? DETECTION_STREAMS.filter((name) => metrics.has(name))
      : []),
  ];
  for (const rule of pack.detectStreams ?? []) {
    found.push(...(await matchingStreams(rule, orgStreams, readColumns)));
  }
  const repairs = await roleRepairs(pack, orgStreams, readGuessColumns);
  found.push(...repairs.map(({ to }) => to));
  return [...new Set(found)];
};
