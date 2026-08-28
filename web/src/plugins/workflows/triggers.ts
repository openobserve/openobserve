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

// ─────────────────────────────────────────────────────────────────────────────
// Workflow trigger registry — the SINGLE source of truth for every trigger kind.
//
// A workflow always starts with one trigger node (node_type "workflow_trigger");
// what varies per kind is the copy, icon, the backend `trigger_type` enum, and
// the sample payload it hands downstream steps. Every consumer (the picker, the
// canvas card title, the config-drawer title, the read-only payload reference,
// the list's Trigger column, and the create/update body's `trigger_type`) reads
// from THIS list, so a kind is described in exactly one place.
//
// ── To add a new event/trigger kind ──────────────────────────────────────────
//   1. Add one entry to WORKFLOW_TRIGGERS below.
//   2. Give it a `buildSample()` (inline, or a builder like testSample.ts /
//      incidentSample.ts) describing the payload it emits.
//   3. Add its i18n strings under `workflow.triggerKind.<camelKind>` in
//      en-US.json: { label, node, desc, intro }.
// Nothing else needs touching — no picker/title/label/mapping edits.
// ─────────────────────────────────────────────────────────────────────────────

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nKey } from "@/types/i18n";
import { buildTestSample } from "./testSample";
import { buildIncidentSample, INCIDENT_EVENT_TYPES, INCIDENT_COMMON_KEYS } from "./incidentSample";
import { ALERT_PAYLOAD_FIELDS } from "./alertFields";
import type { WorkflowFieldOption } from "./alertFields";
import { INCIDENT_PAYLOAD_FIELDS } from "./incidentFields";

// A selectable variant of a trigger's sample payload. When a kind defines more
// than one (e.g. an incident's lifecycle event_types), the trigger drawer shows
// a dropdown so the user can preview each variant's exact payload.
export interface TriggerSampleVariant {
  /** Stable key + the underlying event_type value (used for `event_type == "..."`). */
  key: string;
  /** i18n key for the human-readable dropdown label; falls back to `key` when absent. */
  labelKey?: I18nKey;
  /** This variant's sample payload. */
  build: () => unknown[];
}

export interface WorkflowTriggerDef {
  /** Per-node kind, stored in node.data/meta.trigger_kind (backend snake_case). */
  kind: string;
  /** Top-level workflow `trigger_type` the backend expects (PascalCase enum). */
  triggerType: string;
  /** Whether this kind is offered in the trigger picker ("coming soon" = false). */
  enabled: boolean;
  icon: IconName;
  /** i18n key — picker label + the list's Trigger column. */
  labelKey: I18nKey;
  /** i18n key — canvas card + config-drawer title (e.g. "Alert Trigger"). */
  nodeTitleKey: I18nKey;
  /** i18n key — picker sub-label. */
  descKey: I18nKey;
  /** i18n key — intro copy above the read-only payload reference. */
  introKey: I18nKey;
  /**
   * The payload this trigger hands downstream steps — a one-element array of
   * events (read-only reference + Function "Events" sample + Test seed). When
   * `sampleVariants` is set this is the DEFAULT variant.
   */
  buildSample: () => unknown[];
  /**
   * Optional selectable sample payloads. When present (>1), the trigger drawer
   * renders a dropdown (labelled by `sampleVariantLabelKey`) so the user can
   * preview each — e.g. an incident's per-`event_type` payloads.
   */
  sampleVariants?: TriggerSampleVariant[];
  /** i18n key for the sample-variant dropdown's label. */
  sampleVariantLabelKey?: I18nKey;
  /**
   * When set, the trigger drawer splits the selected variant's `meta` into a
   * COMMON block (these keys, in this order — shown on top as the always-present
   * baseline) and an EVENT-SPECIFIC block (the rest — shown below). Omit to show
   * a single combined payload.
   */
  commonMetaKeys?: string[];
  /**
   * Flattened `meta_*` field suggestions offered to the Condition builder for
   * this kind (the backend flattens the `{ meta }` envelope). allow-custom-columns
   * still lets the user type anything not listed.
   */
  conditionFields: WorkflowFieldOption[];
  /**
   * Optional i18n key for a caveat rendered under the payload reference — the
   * alert kind notes its `data[]` columns come from the query; the incident kind
   * notes its event-specific fields vary by `event_type`. Omit for none.
   */
  payloadNoteKey?: I18nKey;
  /**
   * True when this kind can be associated with alerts — after creating such a
   * workflow the editor offers the "link alerts" prompt (the link is stored on
   * the alert side). Only Alert Fired makes sense here; other kinds skip it.
   */
  linksAlerts?: boolean;
}

// Human-readable dropdown labels per incident event_type; the raw type stays the
// stored value (and is still visible in the payload preview) for filter authoring.
const INCIDENT_EVENT_TYPE_LABEL_KEYS: Record<string, I18nKey> = {
  created: "workflow.node.incidentEventType.created",
  alert: "workflow.node.incidentEventType.alert",
  severity_upgrade: "workflow.node.incidentEventType.severity_upgrade",
  severity_override: "workflow.node.incidentEventType.severity_override",
  acknowledged: "workflow.node.incidentEventType.acknowledged",
  resolved: "workflow.node.incidentEventType.resolved",
  reopened: "workflow.node.incidentEventType.reopened",
  dimension_upgraded: "workflow.node.incidentEventType.dimension_upgraded",
  title_changed: "workflow.node.incidentEventType.title_changed",
  assignment_changed: "workflow.node.incidentEventType.assignment_changed",
  comment: "workflow.node.incidentEventType.comment",
  ai_analysis_begin: "workflow.node.incidentEventType.ai_analysis_begin",
  ai_analysis_complete: "workflow.node.incidentEventType.ai_analysis_complete",
  ai_analysis_failed: "workflow.node.incidentEventType.ai_analysis_failed",
};

export const WORKFLOW_TRIGGERS: WorkflowTriggerDef[] = [
  {
    kind: "alert_fired",
    triggerType: "AlertFired",
    enabled: true,
    icon: "notifications-active",
    labelKey: "workflow.triggerKind.alertFired.label",
    nodeTitleKey: "workflow.triggerKind.alertFired.node",
    descKey: "workflow.triggerKind.alertFired.desc",
    introKey: "workflow.triggerKind.alertFired.intro",
    buildSample: buildTestSample,
    conditionFields: ALERT_PAYLOAD_FIELDS,
    payloadNoteKey: "workflow.node.triggerDataExampleNote",
    linksAlerts: true,
  },
  {
    kind: "incident_event",
    triggerType: "IncidentEvent",
    enabled: true,
    icon: "warning",
    labelKey: "workflow.triggerKind.incidentEvent.label",
    nodeTitleKey: "workflow.triggerKind.incidentEvent.node",
    descKey: "workflow.triggerKind.incidentEvent.desc",
    introKey: "workflow.triggerKind.incidentEvent.intro",
    buildSample: buildIncidentSample,
    // One preview variant per lifecycle event_type — the dropdown value IS the
    // event_type, so it doubles as a reference for `event_type == "..."` filters.
    sampleVariants: INCIDENT_EVENT_TYPES.map((type) => ({
      key: type,
      labelKey: INCIDENT_EVENT_TYPE_LABEL_KEYS[type],
      build: () => buildIncidentSample(type),
    })),
    sampleVariantLabelKey: "workflow.node.incidentEventTypeLabel",
    commonMetaKeys: INCIDENT_COMMON_KEYS,
    conditionFields: INCIDENT_PAYLOAD_FIELDS,
  },
];

// Alert Fired is the fallback so any legacy/unset trigger behaves as before.
export const DEFAULT_TRIGGER_KIND = "alert_fired";

const BY_KIND = new Map(WORKFLOW_TRIGGERS.map((tr) => [tr.kind, tr]));

/** Resolve a kind to its definition, falling back to the default kind. */
export const triggerDef = (kind?: string): WorkflowTriggerDef =>
  BY_KIND.get(kind || "") ?? (BY_KIND.get(DEFAULT_TRIGGER_KIND) as WorkflowTriggerDef);

/** The backend `trigger_type` enum value for a per-node trigger kind. */
export const triggerTypeForKind = (kind?: string): string => triggerDef(kind).triggerType;

/** Kinds offered in the trigger picker (the empty-canvas start node). */
export const enabledTriggers = (): WorkflowTriggerDef[] =>
  WORKFLOW_TRIGGERS.filter((tr) => tr.enabled);

/** Pretty-printed sample payload a kind emits — seeds the read-only reference. */
export const buildTriggerSampleText = (kind?: string): string =>
  JSON.stringify(triggerDef(kind).buildSample(), null, 2);
