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

// The curated engine's PURE passes (design §5.2-§5.5) plus the governance lint (§9) — no store, no network.

import type { FieldAlias } from "@/services/service_streams";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { b64DecodeUnicodeSafe } from "@/utils/formatters";
import { getUnitOptions } from "@/composables/dashboard/useColumnFormatting";
import { raw } from "@/types/i18n";
import { explorerDrilldown } from "./packs/drilldown";
import type {
  CuratedPageManifest,
  CuratedPanelDef,
  CuratedPagePins,
  PanelVariant,
  RequirementGroup,
  CuratedSection,
} from "./types";
import { STALENESS_24H_US } from "./types";

/** Covers the ingest flush window: doc_time_max trails live ingest (§5.3). */
export const STALE_GRACE_US = 10 * 60 * 1_000_000;

const GRID_COLUMNS = 192;

/** Labels the cardinality rule accepts as enumerable without a topk bound (§4.1). */
const ENUMERABLE_LABELS = new Set([
  "phase",
  "condition",
  "direction",
  "status",
  "action",
  // Kernel-bounded, not fleet-bounded: CPU states, block devices, mountpoints.
  "state",
  "device",
  "mountpoint",
]);

export interface StreamStats {
  doc_time_max?: number;
  [key: string]: unknown;
}

export interface StreamListEntry {
  name: string;
  stats?: StreamStats;
  schema?: Array<{ name: string }> | null;
}

export type StreamListsByType = Record<string, StreamListEntry[] | undefined>;

export type WarningKind =
  "stats" | "semantic-groups" | "groups-missing" | "field-unresolved" | "schema" | "probe";

export interface CuratedWarning {
  kind: WarningKind;
  message: string;
}

export interface MissingStreamInfo {
  name: string;
  state: "absent" | "stale";
  lastSeenUs?: number;
}

export interface HiddenGroupInfo {
  group: RequirementGroup;
  reason: "streams-missing" | "probe-empty" | "field-unresolved";
  missingStreams: MissingStreamInfo[];
  missingFields?: string[];
  probeStream?: string;
  unresolvedConcepts?: { groupId: string; display: string }[];
  panelCount: number;
}

/** A PRESENT group that nonetheless lost panels to a variant miss (§6.2). */
export interface PartialGroupInfo {
  group: RequirementGroup;
  hiddenPanelIds: string[];
  missingStreams: MissingStreamInfo[];
}

export interface StaleGroupInfo {
  group: RequirementGroup;
  lastSeenUs: number;
  panelIds: string[];
  /** A listed-but-never-ingested stream is "not yet", not "no longer" (§5.3). */
  noDataYet?: boolean;
}

export interface ResolvedPanel {
  id: string;
  def: CuratedPanelDef;
  sectionId: string;
  groupId: string;
  hidden: boolean;
  selectedVariant?: PanelVariant;
  unit: string;
  /** Stream the selected variant queries — a probe group's resolved candidate. */
  queryStream?: string;
  resolvedFields: Record<string, string>;
  missingStreams: MissingStreamInfo[];
  unresolvedConcepts: { groupId: string; display: string }[];
}

export interface ResolvedPicker {
  def: CuratedPageManifest["scopePickers"][number];
  field: string;
  label: string;
  /**
   * The PARENT concept's field as spelled on THIS picker's own values stream.
   * The chain filter runs against the child's stream, so the parent's own
   * spelling can name a column that stream does not have (§5.4 drift).
   */
  parentField?: string;
}

export interface PickerOption {
  label: string;
  value: string;
}

export interface CuratedResolution {
  panels: ResolvedPanel[];
  presentGroupIds: string[];
  hiddenGroups: HiddenGroupInfo[];
  partialGroups: PartialGroupInfo[];
  staleGroups: StaleGroupInfo[];
  pickers: ResolvedPicker[];
  warnings: CuratedWarning[];
  /** Panel-query streams whose schema a caller must fetch for rung 2 (§5.4). */
  schemasNeeded: string[];
  needsSemanticGroups: boolean;
  stripAutoExpand: boolean;
  lastDataUs: number | null;
  probeStreams: Record<string, string | undefined>;
}

export interface ProbeVerdict {
  /** The candidate that resolved, or the furthest one tried. */
  stream?: string;
  passed: boolean;
  reason?: "streams-missing" | "probe-empty";
  missingFields?: string[];
  /** A transport failure renders the group and raises a `probe` warning. */
  warn?: boolean;
}

export interface ResolveArgs {
  manifest: CuratedPageManifest;
  streams: StreamListsByType;
  semanticGroups: FieldAlias[];
  range: { start: number; end: number };
  now: number;
  pins?: CuratedPagePins;
  lastSeenUs?: number;
  /** Pass-1b outcomes, keyed by group id — absent ⇒ the ladder has not run. */
  probeVerdicts?: Record<string, ProbeVerdict>;
  /**
   * The dictionary could not be READ (403 or transport), as opposed to an org
   * that genuinely has no group by that id. Rung 4a still runs, but the
   * `groups-missing` warning is suppressed — the caller already classified the
   * failure, and reporting every id as missing would bury it (§5.6).
   */
  dictionaryUnavailable?: boolean;
}

export interface Violation {
  rule: string;
  message: string;
}

/** Backslash-escape `\` and `"` for a PromQL string literal. */
export function promEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Double single quotes for a SQL string literal. */
export function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

/** The panels a manifest declares, each tagged with its section. */
function manifestPanels(
  manifest: CuratedPageManifest,
): Array<{ panel: CuratedPanelDef; sectionId: string }> {
  return manifest.sections.flatMap((section) =>
    section.panels.map((panel) => ({ panel, sectionId: section.id })),
  );
}

/**
 * The engine's whole pure core: presence+liveness, per-panel concept resolution,
 * staleness and the strip model. `probeVerdicts` carries pass-1b's answers so
 * the ladder's I/O stays in the composable.
 */
export function resolveManifest(args: ResolveArgs): CuratedResolution {
  const {
    manifest,
    streams,
    semanticGroups,
    range,
    now,
    pins,
    lastSeenUs,
    probeVerdicts,
    dictionaryUnavailable,
  } = args;

  const byId = new Map(semanticGroups.map((group) => [group.id, group]));
  const warnings: CuratedWarning[] = [];
  const pushWarning = (kind: WarningKind, message: string) => {
    if (!warnings.some((w) => w.kind === kind && w.message === message)) {
      warnings.push({ kind, message });
    }
  };

  const entriesByType = new Map<string, Map<string, StreamListEntry>>();
  const listFor = (type: string): Map<string, StreamListEntry> => {
    let found = entriesByType.get(type);
    if (!found) {
      found = new Map((streams[type] ?? []).map((entry) => [entry.name, entry]));
      entriesByType.set(type, found);
    }
    return found;
  };

  let statsMissing = false;
  const docTimeMax = (entry: StreamListEntry | undefined): number | undefined => {
    const value = entry?.stats?.doc_time_max;
    if (typeof value !== "number") {
      if (entry) statsMissing = true;
      return undefined;
    }
    return value;
  };

  // Grace stops a healthy stream being BADGED; it has no business widening a liveness gate.
  const livenessFloor = Math.min(range.start, now - STALENESS_24H_US);
  const isLive = (entry: StreamListEntry | undefined): boolean => {
    const seen = docTimeMax(entry);
    // A never-ingested stream serializes all-zero stats — "not yet", not dead.
    if (seen === undefined || seen === 0) return true;
    return seen >= livenessFloor;
  };

  const groupById = new Map(manifest.groups.map((group) => [group.id, group]));
  const panelDefs = manifestPanels(manifest);

  const schemaFieldsOf = (type: string, name: string | undefined): Set<string> | undefined => {
    if (!name) return undefined;
    const schema = listFor(type).get(name)?.schema;
    // `undefined` = never fetched / fetch failed, distinct from an empty [].
    if (schema == null) return undefined;
    return new Set(schema.map((field) => field.name));
  };

  const schemasNeeded = new Set<string>();
  let needsSemanticGroups = false;

  const resolveConcept = (
    gid: string,
    group: RequirementGroup,
    schemaFields: Set<string> | undefined,
    schemaStream: string | undefined,
    schemaWasFetched: boolean,
  ): { field?: string; display: string } => {
    const dictEntry = byId.get(gid);
    const display = dictEntry?.display ?? gid;

    const override = group.fieldOverrides?.[gid];
    if (override) return { field: override, display };

    // Every rung past 1 consults the dictionary and the panel's own schema.
    needsSemanticGroups = true;
    if (schemaStream) schemasNeeded.add(schemaStream);

    if (!schemaWasFetched) {
      // A transport failure is not evidence of a missing field, so resolve to the group's first spelling and render.
      const fallback = dictEntry?.fields?.[0] ?? group.probeFields?.[gid]?.[0];
      if (fallback) {
        pushWarning("schema", raw(`schema unavailable for ${schemaStream ?? gid}`));
        return { field: fallback, display };
      }
    }

    if (dictEntry) {
      const hit = dictEntry.fields.find((field) => schemaFields?.has(field));
      if (hit) return { field: hit, display };
      return { display };
    }

    if (!dictionaryUnavailable) {
      pushWarning("groups-missing", raw(`semantic group ${gid} is not in this org's groups`));
    }
    const probe = group.probeFields?.[gid];
    const probeHit = probe?.find((field) => schemaFields?.has(field));
    if (probeHit) return { field: probeHit, display };
    return { display };
  };

  const tokensIn = (text: string, prefix: "f" | "scope"): string[] => {
    const pattern = new RegExp(`\\$\\{${prefix}:([^}]+)\\}`, "g");
    return [...text.matchAll(pattern)].map((match) => match[1]);
  };

  /**
   * Required ids come from `${f:}` tokens — a panel cannot query without them.
   * Scope-derived ids are OPTIONAL: a `${scope:}` token whose picker cannot
   * resolve collapses to nothing (substituteQuery returns "" and tidyMatchers
   * cleans the braces), so hiding the panel would lose a fleet-wide chart that
   * renders perfectly well unscoped. An id used BOTH ways stays required.
   */
  const conceptsUsedBy = (variant: PanelVariant): { required: string[]; optional: string[] } => {
    const required = new Set<string>();
    const optional = new Set<string>();
    for (const query of variant.queries) {
      for (const id of tokensIn(query.query, "f")) required.add(id);
      for (const id of tokensIn(query.legend ?? "", "f")) required.add(id);
      for (const name of tokensIn(query.query, "scope")) {
        const picker = manifest.scopePickers.find((p) => p.name === name);
        if (picker) optional.add(picker.group);
      }
    }
    return {
      required: [...required],
      optional: [...optional].filter((id) => !required.has(id)),
    };
  };

  // Which candidate the COUNT runs against is decidable off the lists alone: present + live + carries every probe column.

  const candidateFor = (group: RequirementGroup): { stream?: string; furthest?: string } => {
    let furthest: string | undefined;
    for (const name of group.probe!.streams) {
      const entry = listFor(group.streamType).get(name);
      if (!entry || !isLive(entry)) continue;
      furthest = name;
      const fields = schemaFieldsOf(group.streamType, name);
      if (fields && group.probe!.fields.every((column) => fields.has(column))) {
        return { stream: name, furthest: name };
      }
    }
    return { furthest };
  };

  const probeCandidates = new Map<string, { stream?: string; furthest?: string }>();
  for (const group of manifest.groups) {
    if (group.probe) probeCandidates.set(group.id, candidateFor(group));
  }

  const probeStreamOf = (groupId: string): string | undefined =>
    probeVerdicts?.[groupId]?.stream ?? probeCandidates.get(groupId)?.stream;

  // ── Pass 1: variant satisfiability, gated on presence AND liveness ────────

  const resolvedPanels: ResolvedPanel[] = [];

  for (const { panel, sectionId } of panelDefs) {
    const group = groupById.get(panel.groupId);
    const base: ResolvedPanel = {
      id: panel.id,
      def: panel,
      sectionId,
      groupId: panel.groupId,
      hidden: true,
      unit: panel.unit,
      resolvedFields: {},
      missingStreams: [],
      unresolvedConcepts: [],
    };
    if (!group) {
      resolvedPanels.push(base);
      continue;
    }

    const streamType = group.streamType;
    const verdict = group.probe ? probeVerdicts?.[group.id] : undefined;

    if (group.probe) {
      // A COUNT verdict is required whenever the ladder runs: the candidate walk alone would claim data nothing confirmed.
      const resolvedProbe = probeStreamOf(group.id);
      const confirmed = probeVerdicts ? verdict?.passed === true : Boolean(resolvedProbe);
      if (!resolvedProbe || !confirmed) {
        resolvedPanels.push(base);
        continue;
      }
      base.selectedVariant = panel.variants[0];
      base.queryStream = resolvedProbe;
    } else {
      const missing: MissingStreamInfo[] = [];
      let selected: PanelVariant | undefined;
      for (const variant of panel.variants) {
        const required = variant.requiresStreams ?? [];
        const unmet = required.filter((name) => {
          const entry = listFor(streamType).get(name);
          return !entry || !isLive(entry);
        });
        if (unmet.length === 0) {
          selected = variant;
          break;
        }
        if (missing.length === 0) {
          // Only the FIRST variant's spellings are reported — the strip names what the user would install.
          for (const name of unmet) {
            const entry = listFor(streamType).get(name);
            missing.push(
              entry
                ? { name, state: "stale", lastSeenUs: docTimeMax(entry) }
                : { name, state: "absent" },
            );
          }
        }
      }
      if (!selected) {
        base.missingStreams = missing;
        resolvedPanels.push(base);
        continue;
      }
      base.selectedVariant = selected;
      base.queryStream = selected.requiresStreams?.[0];
    }

    base.unit = base.selectedVariant?.unit ?? panel.unit;

    // ── Pass 3: concepts resolve against THIS panel's own query stream ──────
    const ownFields = schemaFieldsOf(streamType, base.queryStream);
    const anchorFields =
      ownFields ?? schemaFieldsOf(group.streamType, group.anchorStream) ?? undefined;
    const schemaStream = ownFields ? base.queryStream : (group.anchorStream ?? base.queryStream);
    const schemaWasFetched = anchorFields !== undefined;

    let unresolved = false;
    const { required, optional } = conceptsUsedBy(base.selectedVariant!);
    for (const gid of required) {
      const { field, display } = resolveConcept(
        gid,
        group,
        anchorFields,
        schemaStream,
        schemaWasFetched,
      );
      if (field) {
        base.resolvedFields[gid] = field;
      } else {
        unresolved = true;
        base.unresolvedConcepts.push({ groupId: gid, display });
        pushWarning("field-unresolved", raw(`no ${display} field found on ${schemaStream ?? ""}`));
      }
    }
    // An unresolvable OPTIONAL scope collapses its matcher and the panel renders
    // fleet-wide. It raises no warning either: a cluster-less org is a normal org,
    // not a misconfiguration, and warning per panel warned three times over one fact.
    for (const gid of optional) {
      const { field } = resolveConcept(gid, group, anchorFields, schemaStream, schemaWasFetched);
      if (field) base.resolvedFields[gid] = field;
    }

    base.hidden = unresolved;
    resolvedPanels.push(base);
  }

  // ── Group presence, hidden and partial models ─────────────────────────────

  const hiddenGroups: HiddenGroupInfo[] = [];
  const partialGroups: PartialGroupInfo[] = [];
  const presentGroupIds: string[] = [];

  for (const group of manifest.groups) {
    const panels = resolvedPanels.filter((panel) => panel.groupId === group.id);
    const visible = panels.filter((panel) => !panel.hidden);
    const hiddenPanels = panels.filter((panel) => panel.hidden);
    const verdict = group.probe ? probeVerdicts?.[group.id] : undefined;

    const unresolvedHere = dedupeConcepts(
      hiddenPanels.flatMap((panel) => panel.unresolvedConcepts),
    );

    if (visible.length > 0) {
      presentGroupIds.push(group.id);
      if (hiddenPanels.length > 0) {
        partialGroups.push({
          group,
          hiddenPanelIds: hiddenPanels.map((panel) => panel.id),
          missingStreams: dedupeStreams(hiddenPanels.flatMap((panel) => panel.missingStreams)),
        });
      }
      // A concept the stream does not carry is reportable even when siblings render — the strip must name what was lost (§5.4).
      if (unresolvedHere.length > 0) {
        hiddenGroups.push({
          group,
          reason: "field-unresolved",
          missingStreams: [],
          unresolvedConcepts: unresolvedHere,
          panelCount: hiddenPanels.length,
        });
      }
      continue;
    }

    // A probe group with an unsettled ladder is neither present nor reportable.
    if (group.probe && !verdict) continue;

    const unresolvedConcepts = unresolvedHere;
    const reason: HiddenGroupInfo["reason"] = group.probe
      ? (verdict?.reason ?? "probe-empty")
      : unresolvedConcepts.length > 0
        ? "field-unresolved"
        : "streams-missing";

    hiddenGroups.push({
      group,
      reason,
      missingStreams: dedupeStreams(hiddenPanels.flatMap((panel) => panel.missingStreams)),
      ...(verdict?.missingFields ? { missingFields: verdict.missingFields } : {}),
      ...(group.probe
        ? { probeStream: verdict?.stream ?? probeCandidates.get(group.id)?.furthest }
        : {}),
      ...(unresolvedConcepts.length > 0 ? { unresolvedConcepts } : {}),
      panelCount: panels.length,
    });
  }

  // ── Pass 2: staleness, off the same cached list ───────────────────────────

  const staleFloor = Math.min(range.start, now - STALE_GRACE_US);
  const threshold = manifest.stalenessThresholdUs;
  const staleGroups: StaleGroupInfo[] = [];
  let lastDataUs: number | null = null;

  for (const groupId of presentGroupIds) {
    const group = groupById.get(groupId)!;
    const panels = resolvedPanels.filter((panel) => panel.groupId === groupId && !panel.hidden);
    const sources =
      group.stalenessStreams ??
      (group.probe
        ? [probeStreamOf(groupId)].filter((name): name is string => Boolean(name))
        : dedupeNames(panels.flatMap((panel) => panel.selectedVariant?.requiresStreams ?? [])));

    const seenValues = sources
      .map((name) => docTimeMax(listFor(group.streamType).get(name)))
      .filter((value): value is number => typeof value === "number");
    if (seenValues.length === 0) continue;

    const streamMax = Math.max(...seenValues);
    // Stream stats are fleet-wide, so a pinned page badges off the row's OWN last-seen or a dead host never badges.
    const lastSeen = lastSeenUs ?? streamMax;

    if (lastSeen > (lastDataUs ?? -1)) lastDataUs = lastSeen;

    const noDataYet = lastSeen === 0;
    const beyondThreshold = threshold != null && now - lastSeen > threshold;
    if (noDataYet || lastSeen < staleFloor || beyondThreshold) {
      staleGroups.push({
        group,
        lastSeenUs: lastSeen,
        panelIds: panels.map((panel) => panel.id),
        ...(noDataYet ? { noDataYet: true } : {}),
      });
    }
  }

  if (staleGroups.length > 0) lastDataUs = null;
  if (statsMissing) pushWarning("stats", raw("stream statistics are unavailable"));

  // ── Scope pickers ─────────────────────────────────────────────────────────

  const pickers: ResolvedPicker[] = [];
  for (const picker of manifest.scopePickers) {
    if (pins?.[picker.group]) continue;
    const source = picker.valuesFrom;
    const entry = listFor(source.streamType).get(source.stream);
    if (!entry || !isLive(entry)) continue;

    // `omitWhenFieldAbsent` TESTS the resolved field against this stream's schema,
    // so the schema must actually be fetched. A rung-1 override resolves without
    // consulting any schema (and deliberately registers none — the host drawer
    // depends on that), which left this check reading an EMPTY field set and
    // dropping a picker whose field is really there. Registering only the streams
    // that will be tested keeps rung 1's zero-fetch promise everywhere else.
    if (picker.omitWhenFieldAbsent) schemasNeeded.add(source.stream);

    const group = groupById.get(source.groupId);
    if (!group) continue;
    const schemaFields = schemaFieldsOf(source.streamType, source.stream);
    const { field, display } = resolveConcept(
      picker.group,
      group,
      schemaFields,
      source.stream,
      schemaFields !== undefined,
    );
    if (!field) continue;
    if (picker.omitWhenFieldAbsent && schemaFields && !schemaFields.has(field)) continue;

    // The chain filter is applied to THIS picker's values stream, so the parent
    // concept must be spelled the way that stream spells it — the parent's own
    // field comes from a different stream and can name a column missing here,
    // which returns an empty list rather than an error.
    const parentName = picker.chainedOn?.[0]?.picker;
    const parentDef = parentName
      ? manifest.scopePickers.find((entry) => entry.name === parentName)
      : undefined;
    const parentField = parentDef
      ? resolveConcept(
          parentDef.group,
          group,
          schemaFields,
          source.stream,
          schemaFields !== undefined,
        ).field
      : undefined;

    pickers.push({ def: picker, field, label: display, ...(parentField ? { parentField } : {}) });
  }

  const overviewSectionId = manifest.sections[0]?.id;
  const stripAutoExpand = hiddenGroups.some((hidden) =>
    resolvedPanels.some(
      (panel) => panel.groupId === hidden.group.id && panel.sectionId === overviewSectionId,
    ),
  );

  return {
    panels: resolvedPanels,
    presentGroupIds,
    hiddenGroups,
    partialGroups,
    staleGroups,
    pickers,
    warnings,
    schemasNeeded: [...schemasNeeded],
    needsSemanticGroups,
    stripAutoExpand,
    lastDataUs,
    probeStreams: Object.fromEntries(
      manifest.groups
        .filter((group) => group.probe)
        .map((group) => [group.id, probeStreamOf(group.id)]),
    ),
  };
}

/** Emit the inline v8 dashboard object RenderDashboardCharts consumes (§5.5). */
export function buildDashboard(
  manifest: CuratedPageManifest,
  resolution: CuratedResolution,
  pins: CuratedPagePins,
  opts: {
    timezone: string;
    nowUs: number;
    /** Threaded onto every drilldown URL so the explorer opens the SAME window. */
    drilldownRange?: { period?: string; from?: number; to?: number };
    /** Options already fetched, by picker name — a rebuild re-initializes the
     * manager, which never re-fetches an all-sentinel picker (§6.4). */
    pickerOptions?: Record<string, PickerOption[]>;
  },
): Record<string, unknown> {
  const staleByPanelId = new Map<string, StaleGroupInfo>();
  for (const stale of resolution.staleGroups) {
    for (const panelId of stale.panelIds) staleByPanelId.set(panelId, stale);
  }

  const tabs = manifest.sections
    .map((section) => {
      const panels = resolution.panels.filter(
        (panel) => panel.sectionId === section.id && !panel.hidden,
      );
      if (panels.length === 0) return null;
      return {
        tabId: section.id,
        name: section.id,
        // A caveat about THIS section's panels as a set — carried per tab so the
        // built object never depends on which tab is selected.
        ...(section.noteKey ? { curatedNoteKey: section.noteKey } : {}),
        panels: panels.map((panel, index) =>
          buildPanel(
            panel,
            index,
            panels,
            manifest,
            resolution,
            pins,
            staleByPanelId,
            opts.timezone,
            opts.nowUs,
            opts.drilldownRange,
            section,
          ),
        ),
      };
    })
    .filter((tab): tab is NonNullable<typeof tab> => tab !== null);

  return {
    version: 8,
    dashboardId: "",
    title: "",
    description: "",
    role: "",
    owner: "",
    variables: {
      list: resolution.pickers.map((picker) =>
        buildVariable(picker, resolution, manifest, opts.pickerOptions?.[picker.def.name]),
      ),
      showDynamicFilters: false,
    },
    tabs,
  };
}

/** The governance gate (§9) — the same rules lint.spec.ts runs over the registry. */
export function lintManifest(manifest: CuratedPageManifest): Violation[] {
  const violations: Violation[] = [];
  const add = (rule: string, message: string) => violations.push({ rule, message });

  const panels = manifestPanels(manifest).map(({ panel, sectionId }) => ({ ...panel, sectionId }));
  const unitValues = new Set(
    getUnitOptions(((key: string) => raw(key)) as never)
      .map((option) => option.value)
      .filter((value): value is string => value != null),
  );
  const groupIds = new Set(manifest.groups.map((group) => group.id));
  const pickerNames = new Set(manifest.scopePickers.map((picker) => picker.name));

  const duplicates = (ids: string[]) => ids.length !== new Set(ids).size;
  if (duplicates(panels.map((panel) => panel.id))) add("unique-ids", "duplicate panel id");
  if (duplicates(manifest.groups.map((group) => group.id))) add("unique-ids", "duplicate group id");
  if (duplicates(manifest.sections.map((section) => section.id))) {
    add("unique-ids", "duplicate section id");
  }

  for (const panel of panels) {
    if (!groupIds.has(panel.groupId)) add("group-exists", `${panel.id} names ${panel.groupId}`);
    if (!unitValues.has(panel.unit)) add("unit", `${panel.id} unit ${panel.unit}`);
    if (panel.layout.w <= 0 || panel.layout.w > GRID_COLUMNS) add("layout", `${panel.id} width`);
    if (panel.layout.h <= 0) add("layout", `${panel.id} height`);

    const isProbe = Boolean(manifest.groups.find((g) => g.id === panel.groupId)?.probe);
    for (const variant of panel.variants) {
      if (!isProbe && !(variant.requiresStreams ?? []).length) {
        add("requires-streams", `${panel.id} declares no requiresStreams`);
      }
      if (variant.unit && !unitValues.has(variant.unit)) {
        add("unit", `${panel.id} variant unit ${variant.unit}`);
      }
      for (const { query } of variant.queries) {
        for (const match of query.matchAll(/[!=]~"([^"]*)"/g)) {
          if (/\s/.test(match[1])) add("matcher-whitespace", `${panel.id}: ${match[0]}`);
        }
        for (const name of [...query.matchAll(/\$\{scope:([^}]+)\}/g)].map((m) => m[1])) {
          const section = manifest.sections.find((s) => s.id === panel.sectionId);
          if (!pickerNames.has(name)) add("scope-token", `${panel.id} → ${name}`);
          if (!(section?.scopedBy ?? []).includes(name)) {
            add("scope-token", `${panel.id} not in ${panel.sectionId}.scopedBy`);
          }
        }
        lintCardinality(panel.id, query, add);
        if (/\{[^}]*\b(status|condition)\s*=/.test(query) && !/(==|>|<|>=|<=)\s*-?\d/.test(query)) {
          add("value-test", `${panel.id} selects a status label without a value test`);
        }
      }
    }

    if (!isProbe) {
      const explorer = (panel.drilldown ?? []).find(
        (entry) => (entry as { type?: string })?.type === "byUrl",
      ) as { data?: { url?: string } } | undefined;
      const url = explorer?.data?.url;
      if (!url || !url.includes("query_type=promql") || !url.includes("query=")) {
        add("drilldown", `${panel.id} has no explorer drilldown`);
      } else {
        const encoded = new URL(url, "http://localhost").searchParams.get("query");
        const decoded = encoded ? b64DecodeUnicodeSafe(encoded) : "";
        const queries = panel.variants.flatMap((variant) => variant.queries.map((q) => q.query));
        if (!queries.includes(decoded)) add("drilldown", `${panel.id} query is not its own`);
      }
    }
  }

  for (const section of manifest.sections) {
    for (const name of section.scopedBy ?? []) {
      const used = section.panels.some((panel) =>
        panel.variants.some((variant) =>
          variant.queries.some((query) => query.query.includes(`\${scope:${name}}`)),
        ),
      );
      if (!used) add("scoped-by-unused", `${section.id}.scopedBy: ${name}`);
    }

    // A picker the user can operate must move every panel beside it, or the panel must SAY it opts out.
    for (const panel of section.panels) {
      const declared = new Set(panel.fleetWide ?? []);
      for (const name of section.scopedBy ?? []) {
        const carries = panel.variants.every((variant) =>
          variant.queries.every((query) => query.query.includes(`\${scope:${name}}`)),
        );
        if (carries) {
          if (declared.has(name)) {
            add("scope-coverage", `${panel.id} marks ${name} fleetWide yet carries its token`);
          }
          continue;
        }
        const partial = panel.variants.some((variant) =>
          variant.queries.some((query) => query.query.includes(`\${scope:${name}}`)),
        );
        if (partial) {
          add("scope-coverage", `${panel.id} carries ${name} on only SOME queries`);
        } else if (!declared.has(name)) {
          add("scope-coverage", `${panel.id} omits \${scope:${name}} declared by ${section.id}`);
        }
      }
      for (const name of declared) {
        if (!(section.scopedBy ?? []).includes(name)) {
          add(
            "scope-coverage",
            `${panel.id}.fleetWide names ${name}, not in ${section.id}.scopedBy`,
          );
        }
      }
    }
  }

  for (const group of manifest.groups) {
    if (!group.capabilityKey) add("capability-key", `${group.id} declares none`);
    if (group.probe && !group.fieldOverrides) {
      add("probe-overrides", `${group.id} probes without fieldOverrides`);
    }
    if (group.probe) {
      const candidates = group.probe.streams;
      if (candidates.length < 2 || candidates[candidates.length - 1] !== "default") {
        add("probe-candidates", `${group.id} candidate list must end in "default"`);
      }
    }
  }

  for (const picker of manifest.scopePickers) {
    if (picker.labelKey) add("picker-label", `${picker.name} declares a labelKey`);
    const required = new Set(
      panels
        .filter((panel) => panel.groupId === picker.valuesFrom.groupId)
        .flatMap((panel) => panel.variants.flatMap((variant) => variant.requiresStreams ?? [])),
    );
    if (!required.has(picker.valuesFrom.stream)) {
      add("values-from", `${picker.name} → ${picker.valuesFrom.stream}`);
    }
  }

  return violations;
}

/** True when THIS `by(...)` is the inner one of a `count(count by (…)(…))`. */
function isReAggregated(query: string, byIndex: number): boolean {
  const before = query.slice(0, byIndex);
  return /count\s*\(\s*count\s*$/.test(before.replace(/\s+/g, " "));
}

function lintCardinality(
  panelId: string,
  query: string,
  add: (rule: string, message: string) => void,
) {
  for (const match of query.matchAll(/\bby\s*\(([^)]*)\)/g)) {
    const labels = match[1]
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    if (labels.every((label) => ENUMERABLE_LABELS.has(label))) continue;
    // Clause-LOCAL, not query-global: one re-aggregated clause must not disarm the topk bound for the others.
    if (isReAggregated(query, match.index ?? 0)) continue;
    const topk = query.match(/topk\((\d+),/);
    if (!topk || Number(topk[1]) > 20) add("cardinality", `${panelId}: ${match[0]}`);
  }
}

function dedupeStreams(entries: MissingStreamInfo[]): MissingStreamInfo[] {
  const seen = new Map<string, MissingStreamInfo>();
  for (const entry of entries) if (!seen.has(entry.name)) seen.set(entry.name, entry);
  return [...seen.values()];
}

function dedupeConcepts(
  entries: { groupId: string; display: string }[],
): { groupId: string; display: string }[] {
  const seen = new Map<string, { groupId: string; display: string }>();
  for (const entry of entries) if (!seen.has(entry.groupId)) seen.set(entry.groupId, entry);
  return [...seen.values()];
}

function dedupeNames(names: string[]): string[] {
  return [...new Set(names)];
}

function substituteQuery(
  text: string,
  panel: ResolvedPanel,
  manifest: CuratedPageManifest,
  resolution: CuratedResolution,
  pins: CuratedPagePins,
): string {
  const matcherFor = (name: string): string => {
    const def = manifest.scopePickers.find((entry) => entry.name === name);
    if (!def) return "";
    const pinned = pins[def.group];
    const resolved = resolution.pickers.find((entry) => entry.def.name === name);
    const field = panel.resolvedFields[def.group] ?? resolved?.field;
    if (!field) return "";
    if (pinned !== undefined) return `${field}="${promEscape(pinned)}"`;
    // A picker dropped at resolution time collapses rather than emitting a matcher nothing will populate.
    if (!resolved) return "";
    return `${field}=~"$${name}"`;
  };

  const withFields = text.replace(
    /\$\{f:([^}]+)\}/g,
    (_match, gid: string) => panel.resolvedFields[gid] ?? "",
  );

  // A ${scope:} token standing alone after a metric name owns its whole matcher block and must bring the braces with it.
  let out = "";
  let depth = 0;
  for (let i = 0; i < withFields.length; i++) {
    const scope = /^\$\{scope:([^}]+)\}/.exec(withFields.slice(i));
    if (scope) {
      const matcher = matcherFor(scope[1]);
      out += matcher && depth === 0 ? `{${matcher}}` : matcher;
      i += scope[0].length - 1;
      continue;
    }
    const char = withFields[i];
    if (char === "{") depth++;
    else if (char === "}") depth = Math.max(0, depth - 1);
    out += char;
  }

  // A collapsed token must leave no empty matcher and no dangling comma.
  return tidyMatchers(out);
}

/** Collapse the residue an omitted picker leaves behind (§4.2 token conventions). */
function tidyMatchers(query: string): string {
  return query
    .replace(/\{\s*,/g, "{")
    .replace(/,\s*\}/g, "}")
    .replace(/,\s*,/g, ",")
    .replace(/\{\s*\}/g, "");
}

function buildPanel(
  panel: ResolvedPanel,
  index: number,
  siblings: ResolvedPanel[],
  manifest: CuratedPageManifest,
  resolution: CuratedResolution,
  pins: CuratedPagePins,
  staleByPanelId: Map<string, StaleGroupInfo>,
  timezone: string,
  nowUs: number,
  drilldownRange?: { period?: string; from?: number; to?: number },
  section?: CuratedSection,
): Record<string, unknown> {
  const variant = panel.selectedVariant!;
  const stale = staleByPanelId.get(panel.id);
  const layout = flowLayout(siblings, index);
  const probeStream = panel.queryStream ?? "";

  const queries = variant.queries.map((query) => ({
    query: tidyMatchers(
      substituteQuery(query.query, panel, manifest, resolution, pins).replace(
        /<probe>/g,
        probeStream,
      ),
    ),
    legend: substituteQuery(query.legend ?? "", panel, manifest, resolution, pins),
  }));

  const config: Record<string, unknown> = {
    show_legends: true,
    legends_position: "bottom",
    unit: panel.unit,
    unit_custom: null,
    // Rebuilt from the SUBSTITUTED query and the variant that won — the authored one carries tokens and variant 1's stream.
    drilldown: (panel.def.drilldown ?? []).map((entry) =>
      entry.name === "openInMetricsExplorer" && queries[0]
        ? explorerDrilldown(panel.queryStream ?? "", queries[0].query, drilldownRange)
        : entry,
    ),
  };

  // "single" (the converter's default) emits only Timestamp/Value, which hides the
  // very labels an inventory table exists to name — same reason the metrics
  // handoff sets it at utils/metrics/metricsHandoff.ts:180-183.
  if (panel.def.type === "table") config.promql_table_mode = "all";

  if (stale) {
    config.curated_badge = {
      key: stale.noDataYet ? "infra.curated.staleNoDataBadge" : "infra.curated.staleBadge",
      date: timestampToTimezoneDate(Math.floor(stale.lastSeenUs / 1000), timezone),
      // lastSeenUs travels so the CONSUMER computes elapsed time at render time.
      // Baking the count here froze it at build time, so the badge counted from
      // one clock while the page banner counted from another and they drifted apart.
      lastSeenUs: stale.lastSeenUs,
      duration: durationParts(stale.lastSeenUs, nowUs),
    };
  }
  // An instant table returns a clean empty vector when nothing is unhealthy, so
  // it can distinguish "nothing is wrong" from a failed query the way tiles do.
  if (panel.def.type === "metric" || variant.queryMode === "instant") {
    // The resolver cannot know whether a query returned series, only whether a "no data" claim would be honest (§6.3).
    config.curated_no_data_eligible = !stale;
    // Rides the SAME gate: a green "all clear" on a stale collector would assert
    // something the page cannot know, so it is stamped only where the no-data
    // verdict itself is trustworthy.
    if (!stale && section?.emptyMeansHealthy) config.curated_empty_means_healthy = true;
  }
  return {
    id: panel.id,
    type: panel.def.type,
    // The KEY, not the copy: buildDashboard is pure and i18n-free, so the view translates this (§5.5, §8.2).
    title: panel.def.titleKey,
    description: "",
    config,
    queryType: variant.queryType,
    queries: queries.map((built) => ({
      query: built.query,
      vrlFunctionQuery: "",
      customQuery: true,
      fields: (variant.fields as Record<string, unknown> | undefined) ?? {
        stream: "",
        stream_type: "metrics",
        x: [],
        y: [],
        z: [],
        breakdown: [],
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
      },
      config: {
        promql_legend: built.legend,
        // usePanelPromQLExecutor reads query_type per query and sends start == end for "instant".
        ...(variant.queryMode ? { query_type: variant.queryMode } : {}),
      },
    })),
    layout: { ...layout, i: index },
  };
}

/** Flow mixed widths across 192-column rows, wrapping on overflow (§5.5). */
function flowLayout(
  siblings: ResolvedPanel[],
  index: number,
): { x: number; y: number; w: number; h: number } {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (let i = 0; i <= index; i++) {
    const { w, h } = siblings[i].def.layout;
    if (x + w > GRID_COLUMNS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    if (i === index) return { x, y, w, h };
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }
  const { w, h } = siblings[index].def.layout;
  return { x, y, w, h };
}

function buildVariable(
  picker: ResolvedPicker,
  resolution: CuratedResolution,
  manifest: CuratedPageManifest,
  loadedOptions: PickerOption[] | undefined,
): Record<string, unknown> {
  const def = picker.def;
  const parent = def.chainedOn?.[0]?.picker;
  const parentPicker = parent
    ? resolution.pickers.find((entry) => entry.def.name === parent)
    : undefined;

  // The sections this picker applies to, declared on the variable the way the
  // dashboards model declares `tabs` — read as a reactive filter at render time
  // so switching tabs never rebuilds this object. Scope stays "global": an
  // all-sentinel variable at tab scope is skipped by setTabVisibility and would
  // never fetch its options at all.
  const curatedTabs = manifest.sections
    .filter((section) => (section.scopedBy ?? []).includes(def.name))
    .map((section) => section.id);

  return {
    curatedTabs,
    curatedPickerLabel: picker.label,
    name: def.name,
    label: def.labelKey ? "" : picker.label,
    ...(def.labelKey ? { labelKey: def.labelKey } : {}),
    type: "query_values",
    multiSelect: def.multiSelect,
    // "first" makes the manager fall through to the first loaded option
    // (useVariablesManager:96-112); "all" returns the sentinel instead.
    ...(def.multiSelect
      ? { selectAllValueForMultiSelect: def.defaultFirstValue ? "first" : "all" }
      : {}),
    scope: "global",
    omitWhenValuesEmpty: def.omitWhenValuesEmpty === true,
    // Consumed by VariablesValueSelector; stored dashboards never carry them, so they stay invisible outside curated pages.
    curatedOmitWhenValuesEmpty: def.omitWhenValuesEmpty === true,
    curatedCapNotice: true,
    curatedNarrowBy: parentPicker?.label ?? "",
    // Built fresh each render, so there is no saved `options` array to fall back
    // on the way a stored dashboard has — without this the all-sentinel picker
    // never fetches and renders <ALL> over an empty list (useVariablesManager :479-491).
    loadOptionsWithAllDefault: true,
    value: "",
    options: loadedOptions ?? [],
    query_data: {
      stream_type: def.valuesFrom.streamType,
      stream: def.valuesFrom.stream,
      field: picker.field,
      max_record_size: 100,
      filter: parentPicker
        ? [
            {
              // Spelled for the stream the filter RUNS on, not the parent's own.
              name: picker.parentField ?? parentPicker.field,
              operator: "IN",
              value: `$${parent}`,
            },
          ]
        : [],
    },
  };
}

/**
 * The elapsed-time KEY and count, never formatted copy: this layer is pure and
 * i18n-free, and a string baked here would freeze at build time and speak English.
 */
export function durationParts(
  lastSeenUs: number,
  nowUs: number,
): { key: "durationMinutes" | "durationHours" | "durationDays"; count: number } {
  const minutes = Math.floor(Math.max(0, nowUs - lastSeenUs) / 60_000_000);
  if (minutes < 60) return { key: "durationMinutes", count: Math.max(1, minutes) };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { key: "durationHours", count: hours };
  return { key: "durationDays", count: Math.floor(hours / 24) };
}
