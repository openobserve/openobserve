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
import { buildTestSample } from "./testSample";
import { buildIncidentSample } from "./incidentSample";

export interface WorkflowTriggerDef {
  /** Per-node kind, stored in node.data/meta.trigger_kind (backend snake_case). */
  kind: string;
  /** Top-level workflow `trigger_type` the backend expects (PascalCase enum). */
  triggerType: string;
  /** Whether this kind is offered in the trigger picker ("coming soon" = false). */
  enabled: boolean;
  icon: IconName;
  /** i18n key — picker label + the list's Trigger column. */
  labelKey: string;
  /** i18n key — canvas card + config-drawer title (e.g. "Alert Trigger"). */
  nodeTitleKey: string;
  /** i18n key — picker sub-label. */
  descKey: string;
  /** i18n key — intro copy above the read-only payload reference. */
  introKey: string;
  /** The payload this trigger hands downstream steps (read-only ref + test seed). */
  buildSample: () => unknown;
  /**
   * True when the payload carries alert-query `data[]` rows (whose columns depend
   * on the alert), so the body shows the "example columns" caveat. Meta-only
   * payloads (e.g. incidents) omit it.
   */
  hasQueryRows?: boolean;
}

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
    hasQueryRows: true,
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
  },
];

// Alert Fired is the fallback so any legacy/unset trigger behaves as before.
export const DEFAULT_TRIGGER_KIND = "alert_fired";

const BY_KIND = new Map(WORKFLOW_TRIGGERS.map((tr) => [tr.kind, tr]));

/** Resolve a kind to its definition, falling back to the default kind. */
export const triggerDef = (kind?: string): WorkflowTriggerDef =>
  BY_KIND.get(kind || "") ?? (BY_KIND.get(DEFAULT_TRIGGER_KIND) as WorkflowTriggerDef);

/** The backend `trigger_type` enum value for a per-node trigger kind. */
export const triggerTypeForKind = (kind?: string): string =>
  triggerDef(kind).triggerType;

/** Kinds offered in the trigger picker (the empty-canvas start node). */
export const enabledTriggers = (): WorkflowTriggerDef[] =>
  WORKFLOW_TRIGGERS.filter((tr) => tr.enabled);

/** Pretty-printed sample payload a kind emits — seeds the read-only reference. */
export const buildTriggerSampleText = (kind?: string): string =>
  JSON.stringify(triggerDef(kind).buildSample(), null, 2);
