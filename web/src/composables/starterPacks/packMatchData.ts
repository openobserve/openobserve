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
  type LocatedStream,
  type MatchFacts,
  type MatchItem,
} from "./packMatch";
import type { BindingSources } from "./packBinding";
import { strictRenames } from "./strictRenames";
import type { PackDashboard, PackRepair, StarterPack } from "./types";

const FILE_READS_AT_ONCE = 8;
const FORCED_READ_GAP_MS = 30_000;
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

const lastForced = new Map<string, number>();
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

/** Org groups first, then pack alias lists; groups answer 403 on OSS, so there aliases are all. */
export const readBindingSources = async (
  org: string,
  packs: StarterPack[],
): Promise<BindingSources & { titles: Record<string, string> }> => {
  const licensed = config.isEnterprise === "true" || config.isCloud === "true";
  const groups = licensed ? await loadSemanticGroups(org) : [];
  return {
    groups,
    aliases: packs.flatMap((pack) => pack.aliases ?? []),
    titles: Object.fromEntries(groups.map(({ id, display }) => [id, display])),
  };
};

/** A schema cached while empty must not outlive the data, so an empty answer is read again. */
export const readSchemaColumns = async (
  org: string,
  type: string,
  name: string,
  force = false,
): Promise<string[]> => {
  const columnsOf = (schema: any) =>
    ((schema?.schema ?? []) as Array<{ name: string }>).map((column) => column.name);
  const first = columnsOf(await readQuery(streamSchemaQuery(org, name, type), force));
  if (first.length || force) return first;
  return columnsOf(await readQuery(streamSchemaQuery(org, name, type), true));
};

const readFields = async (
  org: string,
  wanted: LocatedStream[],
  fields: Map<string, Set<string>>,
  force = false,
  onRead?: (key: string) => void,
) => {
  await inBatches(wanted, async ({ type, name }) => {
    try {
      const columns = await readSchemaColumns(org, type, name, force);
      fields.set(schemaKey(type, name), new Set(columns.map((c) => c.toLowerCase())));
      onRead?.(schemaKey(type, name));
    } catch {
      // Left unknown: matchItem then answers from the stream list alone.
    }
  });
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
  await readFields(org, wanted, fields);
  const { groups, aliases } = await readBindingSources(org, packs);
  return {
    streams,
    fields,
    aliases: [...groups.map(({ fields: names }) => names), ...aliases],
    repairs,
    nowMs: Date.now(),
  };
};

// A cached schema can predate a column, but a poll must not bypass the cache on every tick.
const refreshMissingFields = async (org: string, items: MatchItem[], facts: MatchFacts) => {
  const stale = new Map<string, LocatedStream>();
  for (const item of items) {
    if (matchItem(item, facts)) continue;
    const located = item.streams.map((name) => locateStream(name, item.streamType, facts));
    if (located.some((row) => !row)) continue;
    for (const row of located as LocatedStream[]) {
      const key = `${org}/${schemaKey(row.type, row.name)}`;
      if (facts.nowMs - (lastForced.get(key) ?? 0) < FORCED_READ_GAP_MS) continue;
      stale.set(schemaKey(row.type, row.name), row);
    }
  }
  // Stamped only on success, so a failed read is retried on the next match.
  await readFields(org, [...stale.values()], facts.fields, true, (key) =>
    lastForced.set(`${org}/${key}`, facts.nowMs),
  );
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

// The installer fixes these without asking, so readiness must already count them.
const strictPackRepairs = (entries: AlertLibraryEntry[], streams: StreamsByType): PackRepair[] => {
  const metrics = new Set(streams.metrics?.keys() ?? []);
  const found = entries.flatMap((entry) => strictRenames(entry.required_streams ?? [], metrics));
  return [...new Map(found.map((repair) => [repair.from, repair])).values()];
};

/** A pack is ready when any item is; items without data are simply left out of it. */
export const matchPack = async (
  org: string,
  pack: StarterPack,
  streams: StreamsByType,
  library: PackLibrary,
): Promise<PackMatch> => {
  const [entries, docs] = await Promise.all([
    packEntries(pack, library),
    // A dashboard that cannot load is not ready; the alert verdicts still stand.
    Promise.all(pack.dashboards.map((dashboard) => loadDoc(dashboard).catch(() => ({})))),
  ]);
  const sources = {
    loadFile: library.loadAlertFile,
    packs: [pack],
    repairs: strictPackRepairs(entries, streams),
  };
  const prepared = await prepareAlerts(entries, streams, sources);
  const panels = docs.map(dashboardItems);
  const items = [...present(prepared.items), ...panels.flat()];
  const facts = await readFacts(org, items, streams, sources);
  await refreshMissingFields(org, items, facts);
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
