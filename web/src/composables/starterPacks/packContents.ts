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

import { alertBody } from "./useStarterPacks";
import { contentHash } from "./useInstallRecords";
import { dashboardStreams } from "./dashboardFit";
import { adaptSavedView } from "./packAdapt";
import type {
  PackInstallRecord,
  PackNotIncludedReason,
  PackPreview,
  PackRecordItem,
  StarterPack,
} from "./types";
import type { TurnOnRow } from "./useTurnOnAlerts";

export type ContentKind = "alert" | "dashboard" | "savedView";

export type ContentState =
  "firing" | "muted" | "paused" | "active" | "created" | "notCreated" | "skipped" | "willBeCreated";

export const CONTENT_KINDS: ContentKind[] = ["alert", "dashboard", "savedView"];

// Inside a group the rows that need a look come first.
const STATE_ORDER: ContentState[] = [
  "firing",
  "muted",
  "paused",
  "active",
  "created",
  "notCreated",
  "skipped",
  "willBeCreated",
];

export interface PackContentRow {
  key: string;
  kind: ContentKind;
  /** The item's id inside the pack, the library id for an alert. */
  itemId: string;
  /** The object's real name, the one its own list shows. */
  name: string;
  /** The Library's title for an alert. */
  libraryTitle: string;
  description: string;
  streams: string[];
  state: ContentState;
  /** Null where nothing can be compared: not made yet, no hash stored at setup, or the read failed. */
  edited: boolean | null;
  /** Reading the current body failed for another reason than the item being gone. */
  readFailed?: boolean;
  item?: PackRecordItem;
  alert?: TurnOnRow;
  reason?: PackNotIncludedReason;
  /** Panel count of a dashboard's current JSON. */
  panels?: number;
  /** The object's own id and folder, for links. */
  id?: string;
  folderId?: string;
}

export interface ContentSources {
  pack: StarterPack;
  record: PackInstallRecord | null;
  preview: PackPreview | null;
  alerts: TurnOnRow[];
  firing: Set<string>;
  muted: Set<string>;
  /** Current bodies of the record's dashboards and saved views, keyed by item id; null once gone. */
  snapshots: Map<string, Record<string, any> | null>;
  /** Item ids whose body read failed, which is not the same as gone. */
  unreadable?: Set<string>;
  /** The pack's own dashboard JSON by item id, for rows setup has not made yet. */
  planned?: Map<string, Record<string, any>>;
  /** Streams an alert reads now, after any repair. */
  readsOf: (row: TurnOnRow) => string[];
  nameOf: (itemId: string) => string;
}

const isMade = ({ status }: PackRecordItem) => status === "created" || status === "existing";

const editedOf = (item: PackRecordItem | undefined, body: unknown): boolean | null =>
  item?.sourceHash && body ? contentHash(body) !== item.sourceHash : null;

export const dashboardPanels = (doc: Record<string, any>): number =>
  (doc.tabs ?? []).reduce(
    (sum: number, tab: Record<string, any>) => sum + (tab.panels?.length ?? 0),
    doc.panels?.length ?? 0,
  );

const viewStreams = (pack: StarterPack, itemId: string, record: PackInstallRecord | null) => {
  const view = pack.savedViews.find(({ id }) => id === itemId);
  if (!view) return [];
  return adaptSavedView(view.search, record?.repairs ?? []).data?.stream?.selectedStream ?? [];
};

const alertState = (row: TurnOnRow, firing: Set<string>, muted: Set<string>): ContentState => {
  if (!row.enabled) return "paused";
  if (muted.has(row.id)) return "muted";
  return firing.has(row.id) ? "firing" : "active";
};

const alertRows = (sources: ContentSources): PackContentRow[] => {
  const items = sources.record?.items ?? [];
  return sources.alerts.map((row) => {
    const item = items.find(({ kind, id }) => kind === "alert" && id === row.id);
    const itemId = item ? (item.copyOf ?? item.itemId) : row.id;
    return {
      key: `alert:${row.id}`,
      kind: "alert",
      itemId,
      name: row.name,
      libraryTitle: item ? sources.nameOf(item.itemId) : "",
      description: String(row.alert.description ?? ""),
      streams: sources.readsOf(row),
      state: alertState(row, sources.firing, sources.muted),
      edited: editedOf(item, alertBody(row.alert)),
      item,
      alert: row,
      id: row.id,
      folderId: row.folderId,
    };
  });
};

const madeRow = (sources: ContentSources, item: PackRecordItem): PackContentRow => {
  const doc = sources.snapshots.get(item.itemId) ?? null;
  const dashboard = item.kind === "dashboard";
  const fallbackName = sources.nameOf(item.itemId);
  return {
    key: `${item.kind}:${item.itemId}`,
    kind: item.kind as ContentKind,
    itemId: item.itemId,
    name: String((dashboard ? doc?.title : doc?.view_name) || fallbackName),
    libraryTitle: "",
    description: dashboard ? String(doc?.description ?? "") : "",
    streams: dashboard
      ? doc
        ? dashboardStreams(doc)
        : []
      : viewStreams(sources.pack, item.itemId, sources.record),
    state: "created",
    edited: editedOf(item, doc),
    item,
    ...(dashboard && doc ? { panels: dashboardPanels(doc) } : {}),
    ...(sources.unreadable?.has(item.itemId) ? { readFailed: true } : {}),
    id: item.id,
    folderId: item.folderId,
  };
};

const bundledEntry = (pack: StarterPack, itemId: string) =>
  pack.bundledAlerts?.find(({ entry }) => entry.id === itemId)?.entry;

const missingStreams = (
  sources: ContentSources,
  item: Pick<PackRecordItem, "kind" | "itemId">,
  required: string[] | undefined,
  doc: Record<string, any> | undefined,
): string[] => {
  if (item.kind === "savedView") return viewStreams(sources.pack, item.itemId, sources.record);
  if (doc) return dashboardStreams(doc);
  return required ?? [];
};

// An alert not made yet has no object name, so the Library's file name stands in for it.
const missingRow = (
  sources: ContentSources,
  item: Pick<PackRecordItem, "kind" | "itemId" | "copyOf">,
  state: ContentState,
  extra: Partial<PackContentRow> = {},
): PackContentRow => {
  const entry =
    item.kind === "alert" ? bundledEntry(sources.pack, item.copyOf ?? item.itemId) : undefined;
  const doc = item.kind === "dashboard" ? sources.planned?.get(item.itemId) : undefined;
  return {
    key: `${item.kind}:${item.itemId}:${state}`,
    kind: item.kind as ContentKind,
    itemId: item.itemId,
    name: entry?.name ?? sources.nameOf(item.itemId),
    libraryTitle: item.kind === "alert" ? sources.nameOf(item.itemId) : "",
    description: entry?.description ?? String(doc?.description ?? ""),
    streams: missingStreams(sources, item, entry?.required_streams, doc),
    state,
    edited: null,
    ...extra,
  };
};

const installedRows = (sources: ContentSources): PackContentRow[] => {
  const items = (sources.record?.items ?? []).filter(({ kind }) =>
    (CONTENT_KINDS as string[]).includes(kind),
  );
  const recorded = new Set(items.map(({ itemId }) => itemId));
  const leftOut = (sources.preview?.notIncluded ?? []).filter(
    ({ kind, itemId, reason }) =>
      (CONTENT_KINDS as string[]).includes(kind) && reason === "no_data" && !recorded.has(itemId),
  );
  return [
    ...alertRows(sources),
    ...items
      .filter((item) => item.kind !== "alert" && isMade(item))
      .map((item) => madeRow(sources, item)),
    ...items
      .filter(({ status }) => status === "failed" || status === "pending")
      .map((item) => missingRow(sources, item, "notCreated", { item })),
    ...items
      .filter(({ status }) => status === "skipped")
      .map((item) => missingRow(sources, item, "skipped", { item, reason: "no_data" })),
    ...leftOut.map((item) => missingRow(sources, item, "skipped", { reason: item.reason })),
  ];
};

const plannedRows = (sources: ContentSources): PackContentRow[] =>
  (sources.preview?.items ?? [])
    .filter(
      ({ kind, status }) => (CONTENT_KINDS as string[]).includes(kind) && status !== "existing",
    )
    .map((item) => missingRow(sources, item, "willBeCreated"));

/** The Contents rows: what the install made, failed or skipped, or what setup would make. */
export const buildContentRows = (sources: ContentSources): PackContentRow[] => {
  const rows = sources.record ? installedRows(sources) : plannedRows(sources);
  return rows.sort(
    (a, b) =>
      CONTENT_KINDS.indexOf(a.kind) - CONTENT_KINDS.indexOf(b.kind) ||
      STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state),
  );
};

/** Search reads the object's name and the Library's title. */
export const matchesSearch = (row: PackContentRow, search: string): boolean => {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [row.name, row.libraryTitle].some((text) => text.toLowerCase().includes(needle));
};
