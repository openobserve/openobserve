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

import http from "./http";

export type SigmaLevel = "informational" | "low" | "medium" | "high" | "critical";

export interface SigmaLogsource {
  category?: string;
  product?: string;
  service?: string;
}

/** A shipped Sigma rule or correlation, as the server's catalog describes it. */
export interface CatalogRule {
  /** The rule's id, else its title. */
  key: string;
  id: string | null;
  title: string;
  description: string | null;
  status: string | null;
  author: string | null;
  date: string | null;
  modified: string | null;
  level: SigmaLevel | null;
  tags: string[];
  techniques: string[];
  tactics: string[];
  falsepositives: string[];
  references: string[];
  logsource: SigmaLogsource;
  logsourceLabel: string;
  correlation: boolean;
  /** A correlation's window, which is also its detection's period. */
  timespanMinutes: number | null;
  yaml: string;
  /** Source type ids the rule was written for. */
  sources: string[];
}

export interface CompiledSigma {
  where: string;
  runnable: boolean;
  unsupported: string[];
  assumedAbsent: string[];
  fields: string[];
  error?: string;
  /** Why the rule cannot run yet, such as a missing column; folded in from the response. */
  reason?: string;
  /** The server-built detection SQL, projecting host and user columns; folded in from the response. */
  sql?: string;
  /** Documented columns no event has carried yet; they are created before the detection is saved. */
  unseenFields?: UnseenField[];
}

export interface UnseenField {
  name: string;
  type: string;
}

/** One group a detection firing fired on, and the events behind it. */
export interface EvidenceGroup {
  values: Record<string, unknown>;
  first_seen: number;
  last_seen: number;
  event_count: number;
  sql: string;
  rows: Record<string, unknown>[];
}

export interface DetectionEvidence {
  stream: string;
  correlation: boolean;
  /** False when the firing predates stored groups and they were re-derived from its window. */
  stored: boolean;
  groups: EvidenceGroup[];
  error?: string;
}

export interface EvidenceParams {
  firing_time: number;
  start_time: number;
  end_time: number;
}

export interface CompiledCorrelation {
  sql: string;
  where: string;
  groupColumns: string[];
  timespanMinutes: number;
  runnable: boolean;
  reason: string;
}

export interface ApplicableRule {
  key: string;
  runnable?: boolean;
  reason?: string | null;
  sql?: string | null;
  compiled: CompiledSigma;
}

export interface OcsfBridge {
  classUid: number;
  activityId: number | null;
  product: string | null;
}

export interface SigmaCompileRequest {
  rule_yaml?: string;
  rule_id?: string;
  source_type?: string;
  stream?: string;
  stream_type?: string;
  fields?: string[];
  field_types?: Record<string, string>;
}

export interface SigmaCompileResponse {
  rule: CatalogRule | null;
  compiled: CompiledSigma | null;
  correlation: CompiledCorrelation | null;
  applies: boolean;
  ocsfBridge: OcsfBridge | null;
  applicable: ApplicableRule[];
  parseError: string | null;
  /** The server-built SQL a single-event detection for the named rule runs. */
  sql?: string | null;
}

export interface SigmaCatalog {
  rules: CatalogRule[];
  errors: { message: string; yaml: string }[];
}

export type TechniqueState = "firing" | "covered" | "available" | "none";

export interface MatrixDetection {
  id: string;
  name: string;
  enabled: boolean;
  sigmaId: string;
  level: string;
  techniques: string[];
  tactics: string[];
}

export interface TechniqueCell {
  id: string;
  name: string;
  tactics: string[];
  /** Catalog rule keys. */
  catalogRules: string[];
  detections: MatrixDetection[];
  enabledCount: number;
  firings: number;
  lastFiredMs: number | null;
  state: TechniqueState;
}

export interface MitreCoverage {
  attackVersion: string;
  matrix: {
    columns: { tactic: string; cells: string[] }[];
    unmapped: string[];
    cells: TechniqueCell[];
  };
  summary: {
    tacticsCovered: number;
    tacticsTotal: number;
    techniquesCovered: number;
    techniquesTotal: number;
    techniquesFiring: number;
    gaps: number;
  };
}

const securitySigma = {
  catalog: (org: string) => http().get<SigmaCatalog>(`/api/${org}/security/sigma/catalog`),
  compile: (org: string, body: SigmaCompileRequest) =>
    http().post<SigmaCompileResponse>(`/api/${org}/security/sigma/compile`, body),
  coverage: (org: string) => http().get<MitreCoverage>(`/api/${org}/security/mitre/coverage`),
  evidence: (org: string, alertId: string, params: EvidenceParams) =>
    http().get<DetectionEvidence>(
      `/api/${org}/security/detections/${encodeURIComponent(alertId)}/evidence`,
      { params },
    ),
  /** Creates columns a detection reads before any event carries them, so its query plans. */
  addColumns: (org: string, stream: string, fields: UnseenField[]) =>
    http().put(`/api/${org}/streams/${encodeURIComponent(stream)}/settings?type=logs`, {
      fields: { add: fields.map((f) => ({ name: f.name, type: f.type })) },
    }),
};

export default securitySigma;
