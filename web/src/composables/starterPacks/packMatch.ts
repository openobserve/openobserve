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

import type { AlertLibraryEntry, AlertLibraryFile, StreamsByType } from "@/types/alertLibrary";

import { dashboardPanelNeeds, queryNeeds } from "./dashboardFit";
import type { PackRepair } from "./types";

const FRESH_MS = 24 * 60 * 60 * 1000;

/** What one alert or dashboard panel reads. No `streamType` means any type. */
export interface MatchItem {
  streamType?: string;
  streams: string[];
  fields: string[];
}

export interface MatchFacts {
  streams: StreamsByType;
  /** Lowercased columns by `schemaKey`; a stream absent here could not be read. */
  fields: Map<string, Set<string>>;
  aliases: string[][];
  repairs: PackRepair[];
  nowMs: number;
}

export interface LocatedStream {
  type: string;
  name: string;
  lastIngested: number;
}

export const schemaKey = (type: string, name: string) => `${type}/${name.toLowerCase()}`;

export const locateStream = (
  name: string,
  streamType: string | undefined,
  facts: Pick<MatchFacts, "streams" | "repairs">,
): LocatedStream | null => {
  const lower = name.toLowerCase();
  const wanted = (
    facts.repairs.find(({ from }) => from.toLowerCase() === lower)?.to ?? name
  ).toLowerCase();
  const types = streamType ? [streamType] : Object.keys(facts.streams);
  for (const type of types) {
    const known = Object.hasOwn(facts.streams, type) ? facts.streams[type] : undefined;
    if (!(known instanceof Map)) continue;
    for (const [actual, lastIngested] of known) {
      if (actual.toLowerCase() === wanted) return { type, name: actual, lastIngested };
    }
  }
  return null;
};

const spellings = (field: string, aliases: string[][]): string[] => {
  const lower = field.toLowerCase();
  const groups = aliases.filter((names) => names.some((name) => name.toLowerCase() === lower));
  return [lower, ...groups.flat().map((name) => name.toLowerCase())];
};

/** The one readiness rule behind the Library, banner, Home card and pack preview. */
export const matchItem = (item: MatchItem | null, facts: MatchFacts): boolean => {
  if (!item) return false;
  const known = new Set<string>();
  let schemasKnown = true;
  for (const stream of item.streams) {
    const found = locateStream(stream, item.streamType, facts);
    if (!found || found.lastIngested <= 0) return false;
    if (facts.nowMs - found.lastIngested / 1000 > FRESH_MS) return false;
    const columns = facts.fields.get(schemaKey(found.type, found.name));
    if (!columns) schemasKnown = false;
    else if (columns.size === 0) return false;
    else for (const column of columns) known.add(column);
  }
  // A schema read that failed proves nothing about the fields, so only the streams decide.
  if (!schemasKnown) return true;
  return item.fields.every((field) =>
    spellings(field, facts.aliases).some((name) => known.has(name)),
  );
};

const conditionColumns = (node: unknown): string[] => {
  if (Array.isArray(node)) return node.flatMap(conditionColumns);
  if (typeof node !== "object" || node === null) return [];
  const { column, conditions } = node as Record<string, unknown>;
  return [...(typeof column === "string" ? [column] : []), ...conditionColumns(conditions)];
};

/** Null for a malformed entry; without its file only the declared streams are known. */
export const alertItem = (
  entry: AlertLibraryEntry,
  file?: AlertLibraryFile | null,
): MatchItem | null => {
  if (!Array.isArray(entry?.required_streams)) return null;
  const condition = (file?.query_condition ?? {}) as Record<string, any>;
  const promql = condition.type === "promql";
  const query = String((promql ? condition.promql : condition.sql) ?? "");
  const needs = queryNeeds(query, promql ? "promql" : "sql");
  const groupBy: unknown[] = condition.aggregation?.group_by ?? [];
  return {
    streamType: entry.stream_type,
    streams: [...new Set([...entry.required_streams, ...needs.streams])],
    fields: [
      ...new Set([
        ...needs.fields,
        ...conditionColumns(condition.conditions),
        ...groupBy.filter((name): name is string => typeof name === "string"),
      ]),
    ],
  };
};

export const dashboardItems = (doc: Record<string, any>): MatchItem[] =>
  dashboardPanelNeeds(doc)
    // A panel that reads no stream is text, and the installer's fit check drops it too.
    .filter(({ streams }) => streams.size > 0)
    .map(({ streams, fields }) => ({ streams: [...streams], fields: [...fields] }));
