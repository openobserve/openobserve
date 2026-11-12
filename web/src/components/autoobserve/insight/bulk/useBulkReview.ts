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
import { baselineSql, errorFieldOf } from "@/utils/alerts/prefill/fromAutoObserve";
import { measureBaseline, type BaselineRequest } from "../targets/baseline";
import { draftThreshold, measuredThreshold, usableThreshold } from "../targets/thresholds";
import { loadOwnedAlerts, notifyOf, teamOf } from "../targets/ownership";
import { checkScopeMatch, scopeIdOf, type ScopeMatch } from "../targets/scopeMatch";
import destinationService from "@/services/alert_destination";
import streamService from "@/services/stream";
import { findExisting, loadExistingAlerts, type ExistingAlert } from "./existingAlerts";
import {
  SERVICE_FIELDS,
  draftNameOf,
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
  | { code: "measuring" }
  | { code: "schemaFailed" }
  | { code: "noBaseline"; kind: "errors" | "latency" }
  | { code: "noField"; part: "service" | "cluster" | "namespace"; value: string }
  | { code: "exists"; alert: ExistingAlert }
  | { code: "existsFailed" }
  | { code: "noMatch" };

/** The org's alerts a review checks its drafts against: null while they load, "failed" when they can't be read. */
export type ExistingCheck = ExistingAlert[] | null | "failed";

/** Whether each service scope's filter keeps rows of its stream, by scope; null when the check could not run. */
export type ScopeMatches = Record<string, ScopeMatch | null>;

/** Stream fields by `type/name`; null when they could not be read. */
export type StreamSchemas = Record<string, string[] | null>;

/** Each errors or latency row's usual level measured over 7 days by row key; null when the week showed none. */
export type RowBaselines = Record<string, number | null>;

/** Each stream's field data types by `type/name`, read with its fields. */
export type StreamTypes = Record<string, Record<string, string>>;

export interface StreamFields {
  names: string[];
  types: Record<string, string>;
}

export interface BulkRow {
  key: string;
  /** Overrides the request's kind, so one service's errors and no-data drafts share one list. */
  kind?: BulkKind;
  scope: ServiceScope | SourceScope;
  usually: number | null;
  unsure?: { reason: string };
  /** How long it may stay quiet before the alert fires, when its series shows bursts. */
  minutes?: number;
  /** The service's team and destinations from its alerts; absent means "No team yet". */
  team?: TeamPick;
  notify?: NotifyPick;
  /** The service's own alerts coverage matched, read when the review opens to fill a missing team and destination. */
  alertIds?: string[];
  /** Builder inputs the errors and latency kinds need. */
  inputs?: {
    errorField?: FieldPick;
    durationField?: string;
    p95Ms?: number | null;
    threshold?: number | null;
  };
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
  /** The errors an hour or p95 in ms the threshold comes from, when one is known. */
  usual: number | null;
  /** The errors an hour or p95 in ms above which the alert fires. */
  threshold: number | null;
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
  types: {} as StreamTypes,
  baselines: {} as RowBaselines,
  thresholds: {} as Record<string, number>,
  /** Null until the review context loads; a scope not yet answered waits. */
  matches: null as ScopeMatches | null,
  /** Team and destination read from each row's own alerts, keyed by row. */
  owned: {} as Record<string, Pick<BulkRow, "team" | "notify">>,
  existing: null as ExistingCheck,
  opener: null as HTMLElement | null,
});

let rightsSource: RightsSource = async () => null;
// Each context load supersedes the previous one, whose late answers are then dropped.
let contextLoad = 0;
let measuring: AbortController | null = null;

const isSource = (scope: ServiceScope | SourceScope): scope is SourceScope => "field" in scope;

const serviceName = (scope: ServiceScope | SourceScope): string =>
  isSource(scope) ? scope.value : scope.service;

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
      threshold: row.inputs?.threshold,
    });
  } else if (kind === "latency" && row.inputs?.durationField) {
    prefill = latencyAlert(row.scope, {
      ...o,
      durationField: row.inputs.durationField,
      p95Ms: row.inputs.p95Ms ?? null,
      threshold: row.inputs.threshold,
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

/** What the review read beside the rows: stream fields and types, measured levels and typed thresholds. */
interface RowContext {
  schemas: StreamSchemas;
  types: StreamTypes;
  baselines: RowBaselines;
  thresholds: Record<string, number>;
  /** Left out, the scope's rows are not checked. */
  matches?: ScopeMatches;
}

/** A row still waiting for its fields or its measurement, which may yet be created. */
const waiting = (block: RowBlock | null): boolean =>
  block?.code === "checking" || block?.code === "measuring";

const positive = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

/** The threshold in the order the finding's evidence, the 7-day measurement, what the user typed, then any error. */
const levelOf = (
  kind: "errors" | "latency",
  row: BulkRow,
  ctx: RowContext,
): { usual: number | null; threshold: number | null; measured: boolean } => {
  const usual =
    positive(kind === "errors" ? row.usually : row.inputs?.p95Ms) ??
    positive(ctx.baselines[row.key]);
  if (usual) return { usual, threshold: measuredThreshold(kind, usual), measured: true };
  const measured = row.key in ctx.baselines;
  const typed = ctx.thresholds[row.key];
  // The any-error default waits for the week's measurement, which may still find a usual level.
  return {
    usual: null,
    threshold: measured ? draftThreshold(kind, null, typed) : usableThreshold(kind, typed),
    measured,
  };
};

type Checked = {
  prefill: AlertPrefill | null;
  block: RowBlock | null;
  usual: number | null;
  threshold: number | null;
};

/** The prefill built on the fields of the row's stream, or the reason it cannot be built. */
const checkedPrefill = (kind: BulkKind, row: BulkRow, ctx: RowContext): Checked => {
  const scope = row.scope;
  const none = { usual: null, threshold: null };
  if (isSource(scope)) return { prefill: buildPrefill(kind, row), block: null, ...none };
  const level = kind === "errors" || kind === "latency" ? levelOf(kind, row, ctx) : null;
  const levels = { usual: level?.usual ?? null, threshold: level?.threshold ?? null };
  const leveled = { ...row, inputs: { ...row.inputs, threshold: levels.threshold } };
  const schema = scope.schema ?? ctx.schemas[streamKeyOf(scope.stream)];
  const fieldTypes = scope.fieldTypes ?? ctx.types[streamKeyOf(scope.stream)];
  const block = scopeBlockOf(scope, schema);
  // A row still waiting for its fields keeps a provisional prefill, so its period and rule show meanwhile.
  if (block?.code === "checking") return { prefill: buildPrefill(kind, leveled), block, ...levels };
  if (block) return { prefill: null, block, ...levels };
  const match = ctx.matches ? ctx.matches[scopeIdOf(scope)] : null;
  if (match === undefined) {
    return { prefill: buildPrefill(kind, leveled), block: { code: "checking" }, ...levels };
  }
  // A filter that keeps none of the stream's rows makes an alert that can never fire.
  if (match === "none") return { prefill: null, block: { code: "noMatch" }, ...none };
  // The error field is read off the stream's fields once they arrive, never guessed before.
  const errorField =
    kind === "errors" && !row.inputs?.errorField
      ? (errorFieldOf(scope.stream.type, schema!, fieldTypes) ?? undefined)
      : row.inputs?.errorField;
  if (kind === "errors" && !errorField && scope.stream.type !== "traces") {
    return { prefill: null, block: null, ...none };
  }
  // Without a threshold the alert would return its one row on every run and never fire.
  if (level && levels.threshold === null) {
    const wait: RowBlock = level.measured
      ? { code: "noBaseline", kind: kind as "errors" | "latency" }
      : { code: "measuring" };
    return { prefill: null, block: wait, ...none };
  }
  return {
    prefill: buildPrefill(kind, {
      ...leveled,
      scope: { ...scope, schema: schema! },
      inputs: { ...leveled.inputs, errorField },
    }),
    block,
    ...levels,
  };
};

/** Whether the stream's fields rule this draft out for good; unread fields rule nothing out. */
export const cantBuild = (row: BulkRow, fields: StreamFields | null): boolean => {
  const scope = row.scope;
  if (isSource(scope) || !fields) return false;
  if (scopeBlockOf(scope, fields.names)) return true;
  return (
    row.kind === "errors" &&
    !row.inputs?.errorField &&
    scope.stream.type !== "traces" &&
    !errorFieldOf(scope.stream.type, fields.names, fields.types)
  );
};

/** The query that measures one waiting row's usual level on its stream's fields; null when it can't be scoped. */
const baselineRequestOf = (
  kind: BulkKind,
  row: BulkRow,
  ctx: RowContext,
): BaselineRequest | null => {
  const scope = row.scope;
  if (isSource(scope) || (kind !== "errors" && kind !== "latency")) return null;
  const key = streamKeyOf(scope.stream);
  const schema = scope.schema ?? ctx.schemas[key] ?? undefined;
  const fieldTypes = scope.fieldTypes ?? ctx.types[key];
  const scoped = { ...scope, schema, fieldTypes };
  const sql =
    kind === "errors"
      ? baselineSql(scoped, {
          kind,
          errorField:
            row.inputs?.errorField ?? errorFieldOf(scope.stream.type, schema ?? [], fieldTypes),
        })
      : baselineSql(scoped, { kind, durationField: row.inputs?.durationField ?? "duration" });
  return sql ? { kind, stream: scope.stream, sql } : null;
};

/** An alert the org already has wins over every other reason; until the list is read a buildable row waits for it. */
const existingBlock = (
  existing: ExistingCheck,
  checked: Checked,
  draft: Parameters<typeof findExisting>[1],
): RowBlock | null => {
  if (existing === null) return checked.block ?? { code: "checking" };
  if (existing === "failed") return checked.block ?? { code: "existsFailed" };
  const alert = findExisting(existing, draft);
  return alert ? { code: "exists", alert } : checked.block;
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
    types?: StreamTypes;
    baselines?: RowBaselines;
    thresholds?: Record<string, number>;
    owned?: Record<string, Pick<BulkRow, "team" | "notify">>;
    matches?: ScopeMatches;
    /** Left out, nothing is checked; the review always passes it. */
    existing?: ExistingCheck;
  },
): ReviewRow[] =>
  request.rows.map((given) => {
    const row = ctx.owned?.[given.key] ? { ...given, ...ctx.owned[given.key] } : given;
    const scope = row.scope;
    const named = row.team && row.team.source === "folder";
    const override = ctx.overrides[row.key];
    const folderId = override?.folder.id ?? (named ? row.team!.folderId : DEFAULT_FOLDER.id);
    const folder = override?.folder ?? {
      id: folderId,
      name: folderName(folderId, row.team, ctx.folders),
    };
    const kind = row.kind ?? request.kind;
    const checked = checkedPrefill(kind, row, {
      schemas: ctx.schemas ?? {},
      types: ctx.types ?? {},
      baselines: ctx.baselines ?? {},
      thresholds: ctx.thresholds ?? {},
      matches: ctx.matches,
    });
    const { prefill, usual, threshold } = checked;
    const block =
      ctx.existing === undefined
        ? checked.block
        : existingBlock(ctx.existing, checked, {
            name: prefill?.name || draftNameOf(scope, kind),
            folderId: folder.id,
            streamType: scope.stream.type,
            streamName: scope.stream.name,
            // A row still waiting for its fields has a provisional query, which may match the wrong alert.
            sql: waiting(checked.block) ? null : (prefill?.sql ?? null),
          });
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
      usual,
      threshold,
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

/** A row the user may tick: built or still waiting to be, in a writable folder, and not known to be unbuildable. */
export const isTickable = (row: ReviewRow): boolean =>
  !row.locked && (waiting(row.block) || (!!row.prefill && !row.block));

/** A row whose threshold is the user's to set, since no usual level was found: it fires on any error, or waits for one. */
export const asksThreshold = (row: ReviewRow): boolean =>
  row.block?.code === "noBaseline" || (!row.block && row.usual === null && row.threshold !== null);

/** A row the user can add: tickable now, or waiting only for the threshold they type. */
export const isAddable = (row: ReviewRow): boolean =>
  isTickable(row) || (!row.locked && row.block?.code === "noBaseline");

/** The rows of a list that are ticked and may be sent, as the footer and each group header count them. */
export const tickedIn = (rows: ReviewRow[], ticked: Set<string>): ReviewRow[] =>
  rows.filter((r) => ticked.has(r.key) && isTickable(r));

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
        types: state.types,
        baselines: state.baselines,
        thresholds: state.thresholds,
        owned: state.owned,
        matches: state.matches ?? undefined,
        existing: state.existing,
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
  state.types = {};
  state.baselines = {};
  state.thresholds = {};
  state.owned = {};
  state.matches = null;
  state.existing = null;
  state.ticked = startTicks(reviewRows.value);
  collapseDefaults();
  state.open = true;
};

/** Drops every late answer of the current load and cancels its running measurements. */
const stopLoads = (): void => {
  contextLoad += 1;
  measuring?.abort();
  measuring = null;
};

/** Closes the drawer and stops its loads, so no seven-day query runs for a review nobody sees. */
export const closeBulkReview = (): void => {
  state.open = false;
  stopLoads();
};

/** One stream's field names and types; null when they could not be read. */
export const readStreamFields = async (
  org: string,
  stream: { type: string; name: string },
): Promise<StreamFields | null> => {
  try {
    const res = await streamService.schema(org, stream.name, stream.type, {
      silentForbidden: true,
    });
    const fields: any[] = res.data?.schema ?? [];
    return {
      names: fields.map((f) => String(f.name)),
      types: Object.fromEntries(fields.map((f) => [String(f.name), String(f.type ?? "")])),
    };
  } catch {
    return null;
  }
};

/** Reads the fields of every stream a service row names without them, a few streams at a time. */
const readSchemas = async (
  org: string,
  load: number,
): Promise<{ schemas: StreamSchemas; types: StreamTypes }> => {
  const scopes = (state.request?.rows ?? []).flatMap((r) =>
    isSource(r.scope) || r.scope.schema ? [] : [r.scope.stream],
  );
  const streams = uniqueBy(scopes, streamKeyOf);
  const schemas: StreamSchemas = {};
  const types: StreamTypes = {};
  for (let i = 0; i < streams.length && load === contextLoad; i += SCHEMA_READS) {
    await Promise.all(
      streams.slice(i, i + SCHEMA_READS).map(async (stream) => {
        const fields = await readStreamFields(org, stream);
        schemas[streamKeyOf(stream)] = fields?.names ?? null;
        if (fields) types[streamKeyOf(stream)] = fields.types;
      }),
    );
  }
  return { schemas, types };
};

/** Each row missing a team or destination gets those its service's own alerts use, from one alert read. */
const readOwnership = async (
  org: string,
  rows: BulkRow[],
): Promise<Record<string, Pick<BulkRow, "team" | "notify">>> => {
  const wanting = rows.filter(
    (r) => r.alertIds?.length && (!r.notify?.destinations.length || r.team?.source !== "folder"),
  );
  const ids = [...new Set(wanting.flatMap((r) => r.alertIds ?? []))];
  const alerts = await loadOwnedAlerts(org, ids);
  const owned: Record<string, Pick<BulkRow, "team" | "notify">> = {};
  for (const row of wanting) {
    const mine = alerts.filter((a) => a.id && row.alertIds!.includes(a.id));
    const found = notifyOf(serviceName(row.scope), mine);
    const notify = row.notify?.destinations.length ? row.notify : found;
    // The team follows the alerts' folder even when they notify no one, as the service drawer's review does.
    const team = row.team?.source === "folder" ? row.team : teamOf(serviceName(row.scope), mine);
    if (!notify.destinations.length && team.source !== "folder") continue;
    owned[row.key] = { team, notify };
  }
  return owned;
};

/** Loads the folders, the stream fields and, when served, the folder write rights the review shows. */
export const loadReviewContext = async (org: string): Promise<void> => {
  stopLoads();
  const load = contextLoad;
  state.matches = {};
  measuring = new AbortController();
  const { signal } = measuring;
  if (state.org !== org) {
    state.org = org;
    state.folders = [];
    state.destinations = [];
  }
  // Applied on arrival, so a slow stream read never holds back the rows the org already has.
  const existing = loadExistingAlerts(org).then(
    (list): ExistingCheck => list,
    (): ExistingCheck => "failed",
  );
  void existing.then((found) => load === contextLoad && applyExisting(found));
  // Rows that arrived with their fields are checked now; the rest once their fields are read.
  const early = matchRows(org, load, signal);
  const [folders, rights, schemas, owned] = await Promise.allSettled([
    commonService.list_Folders(org, "alerts", { skipAccessToast: true }),
    rightsSource(org),
    readSchemas(org, load),
    readOwnership(org, state.request?.rows ?? []),
    existing,
  ]);
  if (load !== contextLoad) return;
  if (owned.status === "fulfilled") applyOwnership(owned.value);
  if (schemas.status === "fulfilled") applySchemas(schemas.value);
  if (folders.status === "fulfilled") {
    state.folders = (folders.value.data?.list ?? []).map((f: any) => ({
      id: f.folderId,
      name: f.name,
    }));
  }
  if (rights.status === "fulfilled") applyRights(rights.value);
  await Promise.all([early, matchRows(org, load, signal)]);
  if (load !== contextLoad) return;
  await measureRows(org, load, signal);
};

const applyOwnership = (owned: Record<string, Pick<BulkRow, "team" | "notify">>): void => {
  state.owned = owned;
};

/** Asks, a few scopes at a time, whether each row's filter keeps any of its stream's rows; a row it rules out is unticked. */
const matchRows = async (org: string, load: number, signal: AbortSignal): Promise<void> => {
  const scopes = (state.request?.rows ?? []).flatMap((r) => {
    if (isSource(r.scope)) return [];
    const schema = r.scope.schema ?? state.schemas[streamKeyOf(r.scope.stream)];
    return schema && !scopeBlockOf(r.scope, schema) ? [{ ...r.scope, schema }] : [];
  });
  const due = uniqueBy(scopes, scopeIdOf).filter((s) => !(scopeIdOf(s) in (state.matches ?? {})));
  for (let i = 0; i < due.length; i += SCHEMA_READS) {
    await Promise.all(
      due.slice(i, i + SCHEMA_READS).map(async (scope) => {
        const value = await checkScopeMatch(org, scope, signal);
        if (load === contextLoad && state.matches) state.matches[scopeIdOf(scope)] = value;
      }),
    );
    if (load !== contextLoad) return;
  }
  for (const row of reviewRows.value) {
    if (row.block?.code === "noMatch") state.ticked.delete(row.key);
  }
};

/** Measures each waiting row's usual level, a few at a time; a row left with no threshold is unticked until one is set. */
const measureRows = async (org: string, load: number, signal: AbortSignal): Promise<void> => {
  const request = state.request;
  if (!request) return;
  const ctx = () => ({
    schemas: state.schemas,
    types: state.types,
    baselines: state.baselines,
    thresholds: state.thresholds,
  });
  const rows = reviewRows.value.filter((r) => r.block?.code === "measuring").map((r) => r.row);
  for (let i = 0; i < rows.length; i += SCHEMA_READS) {
    await Promise.all(
      rows.slice(i, i + SCHEMA_READS).map(async (row) => {
        const query = baselineRequestOf(row.kind ?? request.kind, row, ctx());
        const value = query ? await measureBaseline(org, query, signal) : null;
        if (load !== contextLoad) return;
        state.baselines[row.key] = value;
        const now = reviewRows.value.find((r) => r.key === row.key);
        if (!now || !isTickable(now)) state.ticked.delete(row.key);
      }),
    );
    if (load !== contextLoad) return;
  }
};

/** Sets what the user typed for a row the week gave no usual level (NaN when cleared), or null to go back to the default; a creatable row is ticked. */
export const setRowThreshold = (key: string, value: number | null): void => {
  if (value === null) delete state.thresholds[key];
  else state.thresholds[key] = value;
  const row = reviewRows.value.find((r) => r.key === key);
  if (row && isCreatable(row)) state.ticked.add(key);
  else state.ticked.delete(key);
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

/** Sets the org's alerts the drafts were checked against and unticks every row that already exists or can't be checked. */
export const applyExisting = (existing: ExistingCheck): void => {
  state.existing = existing;
  for (const row of reviewRows.value) {
    if (row.block?.code === "exists" || row.block?.code === "existsFailed") {
      state.ticked.delete(row.key);
    }
  }
};

/** Sets the folder write rights and unticks every row they lock. */
export const applyRights = (rights: FolderRights): void => {
  state.rights = rights;
  for (const row of reviewRows.value) if (row.locked) state.ticked.delete(row.key);
};

/** Sets the read stream fields and unticks every row they show cannot be created. */
const applySchemas = ({ schemas, types }: { schemas: StreamSchemas; types: StreamTypes }): void => {
  state.types = types;
  state.schemas = schemas;
  for (const row of reviewRows.value) {
    if (row.block && !waiting(row.block)) state.ticked.delete(row.key);
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
  tickedRows: computed(() => tickedIn(reviewRows.value, state.ticked)),
  /** Rows Add would send that name no destination; they reach on-call only through their incident. */
  silent: computed(() =>
    reviewRows.value.filter(
      (r) => state.ticked.has(r.key) && isCreatable(r) && !r.destinations.length,
    ),
  ),
  /** A ticked row still waits for its stream fields, so Create would leave it out. */
  checking: computed(() =>
    reviewRows.value.some((r) => waiting(r.block) && state.ticked.has(r.key)),
  ),
});
