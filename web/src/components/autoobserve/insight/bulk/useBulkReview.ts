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

import { computed, reactive } from "vue";
import config from "@/aws-exports";
import { raw } from "@/types/i18n";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import commonService from "@/services/common";
import destinationService from "@/services/alert_destination";
import streamService from "@/services/stream";
import {
  SERVICE_FIELDS,
  errorsAlert,
  latencyAlert,
  noDataAlert,
  pickField,
  scopeFieldsOf,
  sourceNoDataAlert,
  type FieldPick,
  type NotifyPick,
  type ServiceScope,
  type SourceScope,
  type TeamPick,
} from "./bulkTargets";

export const DEFAULT_FOLDER: FolderRef = { id: "default", name: "default" };
export const NO_TEAM = "__no_team__";
// Above this many rows only the first groups start open, so a 400-row review stays scannable.
export const COLLAPSE_ROWS = 50;
const OPEN_GROUPS = 2;
const SCHEMA_READS = 4;

export type BulkKind = "no_data" | "errors" | "latency" | "source";
export type GroupBy = "team" | "folder" | "cluster";

/** Why a row cannot be created yet, or ever, from its stream fields. */
export type RowBlock =
  | { code: "checking" }
  | { code: "schemaFailed" }
  | { code: "noField"; part: "service" | "cluster" | "namespace"; value: string };

/** Stream fields by `type/name`; null when they could not be read. */
export type StreamSchemas = Record<string, string[] | null>;

export interface BulkRow {
  key: string;
  scope: ServiceScope | SourceScope;
  usually: number | null;
  unsure?: { reason: string };
  /** How long it may stay quiet before the alert fires, when its series shows bursts. */
  minutes?: number;
  /** The service's team and destinations from its alerts; absent means "No team yet". */
  team?: TeamPick;
  notify?: NotifyPick;
  /** Builder inputs the errors and latency kinds need. */
  inputs?: { errorField?: FieldPick; durationField?: string; p95Ms?: number | null };
}

export interface BulkReviewRequest {
  kind: BulkKind;
  rows: BulkRow[];
  title?: string;
}

export interface FolderRef {
  id: string;
  name: string;
}

/** One row as the review shows it: where it saves, who it notifies, and whether it can be created. */
export interface ReviewRow {
  key: string;
  row: BulkRow;
  service: string;
  cluster: string | null;
  namespace: string | null;
  stream: { type: string; name: string };
  prefill: AlertPrefill | null;
  teamKey: string;
  teamName: string | null;
  folder: FolderRef;
  folderIsDefault: boolean;
  destinations: string[];
  locked: boolean;
  block: RowBlock | null;
}

export interface ReviewGroup {
  key: string;
  kind: GroupBy;
  /** Team name, folder name or cluster; null is "No team yet" / "No cluster". */
  name: string | null;
  rows: ReviewRow[];
  folders: FolderRef[];
  destinations: string[];
  locked: boolean;
  usesDefault: boolean;
}

/** Folder write rights per folder id, or null while the server does not serve them. */
export type FolderRights = Record<string, boolean> | null;
type RightsSource = (org: string) => Promise<FolderRights>;

const state = reactive({
  /** The org the review context was loaded for; answers for any other org are dropped. */
  org: "",
  open: false,
  request: null as BulkReviewRequest | null,
  groupBy: "team" as GroupBy,
  ticked: new Set<string>(),
  overrides: {} as Record<string, { folder: FolderRef; destinations: string[] }>,
  collapsed: new Set<string>(),
  folders: [] as FolderRef[],
  destinations: [] as string[],
  rights: null as FolderRights,
  schemas: {} as StreamSchemas,
  opener: null as HTMLElement | null,
});

let rightsSource: RightsSource = async () => null;
// Each context load supersedes the previous one, whose late answers are then dropped.
let contextLoad = 0;

const isSource = (scope: ServiceScope | SourceScope): scope is SourceScope => "field" in scope;

const builderOptions = (row: BulkRow) => ({
  team: row.team ?? {
    name: "",
    folderId: DEFAULT_FOLDER.id,
    folderName: DEFAULT_FOLDER.name,
    source: "default" as const,
    reason: raw(""),
  },
  notify: row.notify ?? { destinations: [] as [], reason: "none" as const },
  minutes: row.minutes,
});

/** The kind's U0 builder for one row; null when it cannot build a usable alert. */
export const buildPrefill = (kind: BulkKind, row: BulkRow): AlertPrefill | null => {
  const o = builderOptions(row);
  let prefill: AlertPrefill | null = null;
  if (isSource(row.scope)) {
    prefill = kind === "source" ? sourceNoDataAlert(row.scope, o) : null;
  } else if (kind === "no_data") {
    prefill = noDataAlert(row.scope, o);
  } else if (kind === "errors") {
    prefill = errorsAlert(row.scope, {
      ...o,
      errorField: row.inputs?.errorField ?? null,
      usualPerHour: row.usually,
    });
  } else if (kind === "latency" && row.inputs?.durationField) {
    prefill = latencyAlert(row.scope, {
      ...o,
      durationField: row.inputs.durationField,
      p95Ms: row.inputs.p95Ms ?? null,
    });
  }
  return prefill && !prefill.warnings.some((w) => w.level === "blocking") ? prefill : null;
};

const streamKeyOf = (stream: { type: string; name: string }): string =>
  `${stream.type}/${stream.name}`;

/** Why a service scope cannot be filtered on its stream, or null; without the fields it waits for them. */
export const scopeBlockOf = (
  scope: ServiceScope,
  schema: string[] | null | undefined,
): RowBlock | null => {
  if (schema === undefined) return { code: "checking" };
  if (schema === null) return { code: "schemaFailed" };
  if (!pickField(SERVICE_FIELDS, schema)) {
    return { code: "noField", part: "service", value: scope.service };
  }
  const fields = scopeFieldsOf(scope.stream.type);
  if (scope.cluster && !pickField(fields.cluster, schema)) {
    return { code: "noField", part: "cluster", value: scope.cluster };
  }
  if (scope.namespace && !pickField(fields.namespace, schema)) {
    return { code: "noField", part: "namespace", value: scope.namespace };
  }
  return null;
};

/** The prefill built on the fields of the row's stream, or the reason it cannot be built. */
const checkedPrefill = (
  kind: BulkKind,
  row: BulkRow,
  schemas: StreamSchemas,
): { prefill: AlertPrefill | null; block: RowBlock | null } => {
  const scope = row.scope;
  if (isSource(scope)) return { prefill: buildPrefill(kind, row), block: null };
  const schema = scope.schema ?? schemas[streamKeyOf(scope.stream)];
  const block = scopeBlockOf(scope, schema);
  // A row still waiting for its fields keeps a provisional prefill, so its period and rule show meanwhile.
  if (block?.code === "checking") return { prefill: buildPrefill(kind, row), block };
  if (block) return { prefill: null, block };
  return { prefill: buildPrefill(kind, { ...row, scope: { ...scope, schema: schema! } }), block };
};

const folderName = (id: string, team: TeamPick | undefined, folders: FolderRef[]): string =>
  folders.find((f) => f.id === id)?.name ??
  (id === DEFAULT_FOLDER.id
    ? DEFAULT_FOLDER.name
    : team?.folderName || team?.name || DEFAULT_FOLDER.name);

/** Resolves every row's folder, destinations and lock from its team pick, the group overrides and the rights. */
export const reviewRowsOf = (
  request: BulkReviewRequest,
  ctx: {
    folders: FolderRef[];
    overrides: Record<string, { folder: FolderRef; destinations: string[] }>;
    rights: FolderRights;
    schemas?: StreamSchemas;
  },
): ReviewRow[] =>
  request.rows.map((row) => {
    const scope = row.scope;
    const named = row.team && row.team.source === "folder";
    const override = ctx.overrides[row.key];
    const folderId = override?.folder.id ?? (named ? row.team!.folderId : DEFAULT_FOLDER.id);
    const folder = override?.folder ?? {
      id: folderId,
      name: folderName(folderId, row.team, ctx.folders),
    };
    const { prefill, block } = checkedPrefill(request.kind, row, ctx.schemas ?? {});
    return {
      key: row.key,
      row,
      service: isSource(scope) ? scope.value : scope.service,
      cluster: isSource(scope) ? null : scope.cluster,
      namespace: isSource(scope) ? null : scope.namespace,
      stream: scope.stream,
      prefill,
      teamKey: named ? `team:${row.team!.name}` : NO_TEAM,
      teamName: named ? row.team!.name : null,
      folder,
      folderIsDefault: folder.id === DEFAULT_FOLDER.id,
      destinations: override?.destinations ?? row.notify?.destinations ?? [],
      locked: ctx.rights?.[folder.id] === false,
      block,
    };
  });

const groupKeyOf = (row: ReviewRow, by: GroupBy): string => {
  if (by === "folder") return `folder:${row.folder.id}`;
  if (by === "cluster") return `cluster:${row.cluster ?? ""}`;
  return row.teamKey;
};

const groupNameOf = (row: ReviewRow, by: GroupBy): string | null => {
  if (by === "folder") return row.folder.name;
  if (by === "cluster") return row.cluster;
  return row.teamName;
};

const uniqueBy = <T>(items: T[], key: (item: T) => string): T[] => [
  ...new Map(items.map((item) => [key(item), item])).values(),
];

/** Groups rows by team, folder or cluster: writable before locked, then larger first. */
export const groupRows = (rows: ReviewRow[], by: GroupBy): ReviewGroup[] => {
  const groups = new Map<string, ReviewGroup>();
  for (const row of rows) {
    const key = groupKeyOf(row, by);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        kind: by,
        name: groupNameOf(row, by),
        rows: [],
        folders: [],
        destinations: [],
        locked: true,
        usesDefault: false,
      };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  for (const group of groups.values()) {
    group.folders = uniqueBy(
      group.rows.map((r) => r.folder),
      (f) => f.id,
    );
    group.destinations = [...new Set(group.rows.flatMap((r) => r.destinations))].sort();
    group.locked = group.rows.every((r) => r.locked);
    group.usesDefault = group.rows.every((r) => r.folderIsDefault);
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.locked) - Number(b.locked) ||
      b.rows.length - a.rows.length ||
      (a.name ?? "").localeCompare(b.name ?? ""),
  );
};

/** A row the user may tick: built, in a writable folder, and not known to miss a stream field. */
export const isTickable = (row: ReviewRow): boolean =>
  !!row.prefill && !row.locked && (!row.block || row.block.code === "checking");

/** A row that can be created now: tickable, and its stream fields are confirmed. */
export const isCreatable = (row: ReviewRow): boolean => isTickable(row) && !row.block;

/** The rows Create sends: ticked and creatable, nothing else. */
export const rowsToCreate = (rows: ReviewRow[], ticked: Set<string>): ReviewRow[] =>
  rows.filter((r) => ticked.has(r.key) && isCreatable(r));

/** Ticked rows per folder, largest first, for the footer and the toast. */
export const countByFolder = (rows: ReviewRow[]): { folder: FolderRef; count: number }[] => {
  const counts = new Map<string, { folder: FolderRef; count: number }>();
  for (const row of rows) {
    const entry = counts.get(row.folder.id) ?? { folder: row.folder, count: 0 };
    entry.count += 1;
    counts.set(row.folder.id, entry);
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.folder.name.localeCompare(b.folder.name),
  );
};

/** The tick state of a group's creatable rows, for its header checkbox. */
export const groupTick = (group: ReviewGroup, ticked: Set<string>): boolean | "indeterminate" => {
  const creatable = group.rows.filter(isTickable);
  const on = creatable.filter((r) => ticked.has(r.key)).length;
  if (on === 0) return false;
  return on === creatable.length ? true : "indeterminate";
};

// A row still waiting for its stream fields starts ticked; the fields may untick it once read.
const startTicks = (rows: ReviewRow[]): Set<string> =>
  new Set(rows.filter((r) => !r.row.unsure && isTickable(r)).map((r) => r.key));

const reviewRows = computed(() =>
  state.request
    ? reviewRowsOf(state.request, {
        folders: state.folders,
        overrides: state.overrides,
        rights: state.rights,
        schemas: state.schemas,
      })
    : [],
);

const groups = computed(() => groupRows(reviewRows.value, state.groupBy));

const collapseDefaults = (): void => {
  state.collapsed = new Set(
    reviewRows.value.length > COLLAPSE_ROWS
      ? groups.value.slice(OPEN_GROUPS).map((g) => g.key)
      : [],
  );
};

/** Opens the one review drawer; a no-op on builds without enterprise. */
export const openBulkReview = (request: BulkReviewRequest): void => {
  if (config.isEnterprise !== "true" || request.rows.length === 0) return;
  state.opener =
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
  state.request = request;
  state.groupBy = "team";
  state.overrides = {};
  state.rights = null;
  state.schemas = {};
  state.ticked = startTicks(reviewRows.value);
  collapseDefaults();
  state.open = true;
};

export const closeBulkReview = (): void => {
  state.open = false;
};

/** Reads the fields of every stream a service row names without them, a few streams at a time. */
const readSchemas = async (org: string): Promise<StreamSchemas> => {
  const scopes = (state.request?.rows ?? []).flatMap((r) =>
    isSource(r.scope) || r.scope.schema ? [] : [r.scope.stream],
  );
  const streams = uniqueBy(scopes, streamKeyOf);
  const found: StreamSchemas = {};
  for (let i = 0; i < streams.length; i += SCHEMA_READS) {
    await Promise.all(
      streams.slice(i, i + SCHEMA_READS).map(async (stream) => {
        try {
          const res = await streamService.schema(org, stream.name, stream.type, {
            silentForbidden: true,
          });
          found[streamKeyOf(stream)] = (res.data?.schema ?? []).map((f: any) => String(f.name));
        } catch {
          found[streamKeyOf(stream)] = null;
        }
      }),
    );
  }
  return found;
};

/** Loads the folders, the stream fields and, when served, the folder write rights the review shows. */
export const loadReviewContext = async (org: string): Promise<void> => {
  const load = ++contextLoad;
  if (state.org !== org) {
    state.org = org;
    state.folders = [];
    state.destinations = [];
  }
  const [folders, rights, schemas] = await Promise.allSettled([
    commonService.list_Folders(org, "alerts", { skipAccessToast: true }),
    rightsSource(org),
    readSchemas(org),
  ]);
  if (load !== contextLoad) return;
  if (schemas.status === "fulfilled") applySchemas(schemas.value);
  if (folders.status === "fulfilled") {
    state.folders = (folders.value.data?.list ?? []).map((f: any) => ({
      id: f.folderId,
      name: f.name,
    }));
  }
  if (rights.status === "fulfilled") applyRights(rights.value);
};

/** Loads the destinations a group can switch to, once, when the user first changes one. */
export const loadDestinations = async (org: string): Promise<void> => {
  if (org !== state.org || state.destinations.length) return;
  const res = await destinationService.list({
    org_identifier: org,
    page_num: 1,
    page_size: 100000,
    sort_by: "name",
    desc: false,
    module: "alert",
  });
  if (org !== state.org) return;
  const list = res.data?.list ?? res.data ?? [];
  state.destinations = (Array.isArray(list) ? list : []).map((d: any) => d.name);
};

/** Sets the folder write rights and unticks every row they lock. */
export const applyRights = (rights: FolderRights): void => {
  state.rights = rights;
  for (const row of reviewRows.value) if (row.locked) state.ticked.delete(row.key);
};

/** Sets the read stream fields and unticks every row they show cannot be created. */
const applySchemas = (schemas: StreamSchemas): void => {
  state.schemas = schemas;
  for (const row of reviewRows.value) {
    if (row.block && row.block.code !== "checking") state.ticked.delete(row.key);
  }
};

/** Where folder write rights come from; nothing serves them yet, so the default answers null. */
export const setFolderRightsSource = (source: RightsSource | null): void => {
  rightsSource = source ?? (async () => null);
};

export const setGroupBy = (by: GroupBy): void => {
  state.groupBy = by;
  collapseDefaults();
};

export const toggleRow = (key: string, on: boolean): void => {
  const row = reviewRows.value.find((r) => r.key === key);
  if (on && row && isTickable(row)) state.ticked.add(key);
  else state.ticked.delete(key);
};

export const toggleGroup = (group: ReviewGroup, on: boolean): void => {
  for (const row of group.rows) toggleRow(row.key, on);
};

export const toggleCollapsed = (key: string): void => {
  if (state.collapsed.has(key)) state.collapsed.delete(key);
  else state.collapsed.add(key);
};

/** Moves a group to another folder and destination list; rows the new folder unlocks are ticked again. */
export const changeGroup = (
  group: ReviewGroup,
  folder: FolderRef,
  destinations: string[],
): void => {
  const before = new Map(reviewRows.value.map((r) => [r.key, r.locked]));
  for (const row of group.rows) state.overrides[row.key] = { folder, destinations };
  for (const row of reviewRows.value) {
    if (!group.rows.some((r) => r.key === row.key)) continue;
    if (row.locked) state.ticked.delete(row.key);
    else if (before.get(row.key) && isTickable(row) && !row.row.unsure) state.ticked.add(row.key);
  }
};

export const useBulkReview = () => ({
  state,
  reviewRows,
  groups,
  toCreate: computed(() => rowsToCreate(reviewRows.value, state.ticked)),
  /** The ticked rows the footer counts, including those still waiting for their fields. */
  tickedRows: computed(() =>
    reviewRows.value.filter((r) => state.ticked.has(r.key) && isTickable(r)),
  ),
  /** A ticked row still waits for its stream fields, so Create would leave it out. */
  checking: computed(() =>
    reviewRows.value.some((r) => r.block?.code === "checking" && state.ticked.has(r.key)),
  ),
});
