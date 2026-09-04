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

// Curated page manifest types (design §4.1): no concept table here — the org's semantic field groups JSON is the dictionary (§3.3).

import type { I18nKey } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { WorkloadId } from "@/composables/useWorkloadDetection";

/**
 * A semantic GROUP ID from the org's semantic field groups. Branded rather than
 * a closed union: the pack set is open, and the closed set that matters is the
 * one lint enforces against the committed defaults snapshot (§3.3.1).
 */
export type SemanticGroupId = string & { readonly __semanticGroupId?: never };

export type CuratedStreamType = "metrics" | "logs" | "traces";

export type CuratedPagePins = Record<SemanticGroupId, string>;

export interface RequirementGroup {
  id: string;
  /** Capability first, collector origin in parentheses (§6.2). */
  labelKey: I18nKey;
  /** One sentence naming what the user LOSES when this group is absent. */
  capabilityKey: I18nKey;
  setupHintKey: I18nKey;
  setup: { kind: "card"; slug: string } | { kind: "route"; routeName: string };
  streamType: CuratedStreamType;
  /** Content probe over an ORDERED candidate stream list (§5.2 pass 1b). */
  probe?: { streams: string[]; sqlFilter: string; fields: string[] };
  /** Defaults to the union of the panels' selected-variant streams (§5.3). */
  stalenessStreams?: string[];
  /** Rung 1 of §5.4 — authored certainty, no group lookup and no schema fetch. */
  fieldOverrides?: Record<SemanticGroupId, string>;
  /** Rung 4a — used ONLY when the named group is absent from the org's groups. */
  probeFields?: Record<SemanticGroupId, string[]>;
  /** Group-level fallback only; panels resolve against their own query stream. */
  anchorStream?: string;
}

export interface PanelVariant {
  /** Full stream set; satisfiable iff every name is present AND live (§5.2). */
  requiresStreams?: string[];
  queryType: "promql" | "sql";
  queries: { query: string; legend: string }[];
  /** v8 fields block for SQL panels; promql panels omit it. */
  fields?: unknown;
  /** Unit override where a variant's semantics differ (cores vs ratio). */
  unit?: string;
}

export interface CuratedPanelDef {
  id: string;
  titleKey: I18nKey;
  type: "line" | "area-stacked" | "bar" | "metric" | "gauge" | "table";
  unit: string;
  groupId: string;
  variants: PanelVariant[];
  /** 192-col grid cell; x/y flow-computed per section (§5.5). */
  layout: { w: number; h: number };
  drilldown?: unknown[];
  /**
   * Pickers this panel deliberately ignores though its section declares them —
   * a fleet-wide reading is the panel's POINT, not an oversight. Lint requires
   * every omitted scope token to appear here, so silence is never a decision.
   */
  fleetWide?: string[];
}

export interface CuratedSection {
  id: string;
  titleKey: I18nKey;
  /** Pickers that apply within this section — scoping is declared, never implicit. */
  scopedBy?: string[];
  /**
   * A caveat about the section's panels TAKEN TOGETHER — e.g. that three phase
   * tiles are not a partition. It belongs to the set, not to any one tile, so it
   * renders once above the grid; inlining it per tile ate the titles it qualified.
   */
  noteKey?: I18nKey;
  panels: CuratedPanelDef[];
}

export interface ScopePickerDef {
  name: string;
  /** Optional override; v1 packs take the group's own `display` instead (§8.4). */
  labelKey?: I18nKey;
  group: SemanticGroupId;
  valuesFrom: { groupId: string; stream: string; streamType: CuratedStreamType };
  multiSelect: boolean;
  chainedOn?: { picker: string }[];
  omitWhenFieldAbsent?: boolean;
  /** Schema presence is not resolvability — omit at values-load time (§6.4). */
  omitWhenValuesEmpty?: boolean;
}

export interface CuratedPageManifest {
  id: WorkloadId;
  titleKey: I18nKey;
  icon: IconName;
  contentVersion: number;
  groups: RequirementGroup[];
  scopePickers: ScopePickerDef[];
  sections: CuratedSection[];
  stalenessThresholdUs?: number;
  defaultRelativePeriod: string;
}

/**
 * The v1 packs' group ids, copied VERBATIM from the defaults JSON (§3.3). The
 * inconsistent "-name" suffixing is the JSON's, not a convention.
 */
export const GROUP = {
  namespace: "k8s-namespace",
  pod: "k8s-pod-name",
  node: "k8s-node-name",
  cluster: "k8s-cluster",
  container: "k8s-container-name",
  host: "host",
} as const satisfies Record<string, SemanticGroupId>;

/** All v1 packs' stalenessThresholdUs — the useAlertLibrary 24h precedent, in µs. */
export const STALENESS_24H_US = 24 * 60 * 60 * 1_000_000;
