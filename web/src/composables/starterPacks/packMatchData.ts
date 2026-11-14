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

import config from "@/aws-exports";
import { toStreamsByType } from "@/composables/alerts/useAlertLibrary";
import { readQuery } from "@/composables/query/readQuery";
import { streamNameListQuery, streamSchemaQuery } from "@/services/stream.queries";
import type {
  AlertLibraryEntry,
  AlertLibraryFile,
  AlertLibraryManifest,
  StreamsByType,
} from "@/types/alertLibrary";
import { loadSemanticGroups } from "@/utils/semanticGroupsCache";

import {
  alertItem,
  dashboardItems,
  locateStream,
  matchItem,
  schemaKey,
  type MatchFacts,
  type MatchItem,
} from "./packMatch";
import type { PackDashboard, PackRepair, StarterPack } from "./types";

const FILE_READS_AT_ONCE = 8;
const STREAM_TYPES = ["metrics", "logs", "traces"];

interface StreamRow {
  name?: string;
  stream_type?: string;
  stats?: { doc_time_max?: unknown; created_at?: unknown };
}

export interface MatchSources {
  loadFile: (entry: AlertLibraryEntry) => Promise<AlertLibraryFile>;
  packs: StarterPack[];
  repairs?: PackRepair[];
}

export interface PackLibrary {
  loadManifest: () => Promise<AlertLibraryManifest | null | undefined>;
  loadAlertFile: MatchSources["loadFile"];
}

export interface PackMatch {
  alerts: Map<string, boolean>;
  dashboards: Map<string, boolean>;
  ready: boolean;
}

interface AlertItems {
  entries: AlertLibraryEntry[];
  candidates: AlertLibraryEntry[];
  items: Array<MatchItem | null>;
}

const dashboardDocs = new WeakMap<PackDashboard, Promise<Record<string, any>>>();

const loadDoc = (dashboard: PackDashboard) => {
  const cached = dashboardDocs.get(dashboard);
  if (cached) return cached;
  const loaded = dashboard.load().catch((error) => {
    dashboardDocs.delete(dashboard);
    throw error;
  });
  dashboardDocs.set(dashboard, loaded);
  return loaded;
};

const inBatches = async <T, R>(values: T[], read: (value: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = [];
  for (let start = 0; start < values.length; start += FILE_READS_AT_ONCE) {
    const batch = values.slice(start, start + FILE_READS_AT_ONCE);
    results.push(...(await Promise.all(batch.map(read))));
  }
  return results;
};

// Semantic groups answer 403 on OSS, so there the pack's own alias lists are the only source.
const readAliases = async (org: string, packs: StarterPack[]): Promise<string[][]> => {
  const licensed = config.isEnterprise === "true" || config.isCloud === "true";
  const groups = licensed ? await loadSemanticGroups(org) : [];
  return [...groups.map(({ fields }) => fields), ...packs.flatMap((pack) => pack.aliases ?? [])];
};

const readFacts = async (
  org: string,
  items: MatchItem[],
  streams: StreamsByType,
  { packs, repairs = [] }: MatchSources,
): Promise<MatchFacts> => {
  const located = items.flatMap((item) =>
    item.streams.flatMap((name) => locateStream(name, item.streamType, { streams, repairs }) ?? []),
  );
  const wanted = [...new Map(located.map((row) => [schemaKey(row.type, row.name), row])).values()];
  const fields = new Map<string, Set<string>>();
  await inBatches(wanted, async ({ type, name }) => {
    try {
      const schema = await readQuery(streamSchemaQuery(org, name, type));
      const columns = (schema?.schema ?? []) as Array<{ name: string }>;
      fields.set(schemaKey(type, name), new Set(columns.map((c) => c.name.toLowerCase())));
    } catch {
      // Left unknown: matchItem then answers from the stream list alone.
    }
  });
  return { streams, fields, aliases: await readAliases(org, packs), repairs, nowMs: Date.now() };
};

/** Stats stay zero until the first flush, so a just-created stream counts from its creation. */
export const ingestTimes = (list: StreamRow[] | null | undefined): StreamsByType =>
  toStreamsByType(
    (list ?? []).map((row) => ({
      ...row,
      stats: { doc_time_max: row?.stats?.doc_time_max || row?.stats?.created_at },
    })),
  );

/** Every stream in the org with its last ingest time. */
export const readOrgStreams = async (org: string): Promise<StreamsByType> => {
  const lists = await Promise.all(
    STREAM_TYPES.map((type) => readQuery(streamNameListQuery(org, type), true)),
  );
  return ingestTimes(
    lists.flatMap((rows, index) =>
      rows.map((row) => ({ ...row, stream_type: STREAM_TYPES[index] })),
    ),
  );
};

/** Files are read only for alerts that pass on streams alone, so a large catalog stays cheap. */
const prepareAlerts = async (
  entries: AlertLibraryEntry[],
  streams: StreamsByType,
  sources: MatchSources,
): Promise<AlertItems> => {
  const shallow: MatchFacts = {
    streams,
    fields: new Map(),
    aliases: [],
    repairs: sources.repairs ?? [],
    nowMs: Date.now(),
  };
  const candidates = entries.filter((entry) => matchItem(alertItem(entry), shallow));
  const bundled = new Map(
    sources.packs.flatMap((pack) =>
      (pack.bundledAlerts ?? []).map(({ entry, file }) => [entry.id, file] as const),
    ),
  );
  const files = await inBatches(candidates, (entry) =>
    sources.loadFile(entry).catch(() => bundled.get(entry.id) ?? null),
  );
  return { entries, candidates, items: candidates.map((entry, i) => alertItem(entry, files[i])) };
};

const present = (items: Array<MatchItem | null>) =>
  items.filter((item): item is MatchItem => item !== null);

const alertVerdicts = ({ entries, candidates, items }: AlertItems, facts: MatchFacts) => {
  const verdicts = new Map(entries.map((entry) => [entry.id, false]));
  candidates.forEach((entry, index) => verdicts.set(entry.id, matchItem(items[index], facts)));
  return verdicts;
};

export const matchAlerts = async (
  org: string,
  entries: AlertLibraryEntry[],
  streams: StreamsByType,
  sources: MatchSources,
): Promise<Map<string, boolean>> => {
  const prepared = await prepareAlerts(entries, streams, sources);
  const facts = await readFacts(org, present(prepared.items), streams, sources);
  return alertVerdicts(prepared, facts);
};

const packEntries = async (pack: StarterPack, library: PackLibrary) => {
  const manifest = await library.loadManifest().catch(() => null);
  const listed = [...(manifest?.alerts ?? []), ...(manifest?.anomaly_alerts ?? [])];
  const bundled = (pack.bundledAlerts ?? []).map(({ entry }) => entry);
  return pack.alerts.flatMap((id) => {
    return (
      listed.find((entry) => entry.id === id) ?? bundled.find((entry) => entry.id === id) ?? []
    );
  });
};

/** A pack is ready when any item is; items without data are simply left out of it. */
export const matchPack = async (
  org: string,
  pack: StarterPack,
  streams: StreamsByType,
  library: PackLibrary,
): Promise<PackMatch> => {
  const sources = { loadFile: library.loadAlertFile, packs: [pack] };
  const [prepared, docs] = await Promise.all([
    packEntries(pack, library).then((entries) => prepareAlerts(entries, streams, sources)),
    // A dashboard that cannot load is not ready; the alert verdicts still stand.
    Promise.all(pack.dashboards.map((dashboard) => loadDoc(dashboard).catch(() => ({})))),
  ]);
  const panels = docs.map(dashboardItems);
  const facts = await readFacts(
    org,
    [...present(prepared.items), ...panels.flat()],
    streams,
    sources,
  );
  const alerts = alertVerdicts(prepared, facts);
  const dashboards = new Map(
    pack.dashboards.map((dashboard, index) => [
      dashboard.id,
      panels[index].some((item) => matchItem(item, facts)),
    ]),
  );
  const ready = [...alerts.values(), ...dashboards.values()].some(Boolean);
  return { alerts, dashboards, ready };
};
