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
import type { NormalizedEvent } from "@/utils/security/ocsf";

export interface SigmaLogsource {
  category?: string;
  product?: string;
  service?: string;
}

export interface ValueSignal {
  field: string;
  any: string[];
}

/** One built-in source type, as the server's catalog describes it; the UI reads only its display and field-map parts. */
export interface SourceType {
  id: string;
  label: string;
  vendor: string;
  sigma: SigmaLogsource;
  sigmaAliases?: SigmaLogsource[];
  ocsfClass: number;
  required?: string[];
  signals?: string[];
  absent?: string[];
  valueSignals?: ValueSignal[];
  weight?: number;
  map: Partial<Record<keyof NormalizedEvent, string[]>>;
  constants?: Partial<Record<keyof NormalizedEvent, string>>;
  failureWhenPresent?: string[];
  ocsfStatusFields?: string[];
  /** Event codes that mean the event failed; fields use `a|b` for either spelling. */
  failureWhen?: {
    field: string;
    codes: number[];
    statusCodes?: number[];
    status?: string;
    keywords?: string;
  };
  telemetryOnly?: boolean;
}

export interface Classification {
  source: SourceType;
  confidence: number;
  matchedRequired: string[];
  matchedSignals: string[];
  /** A confident match to a source with security semantics, not plain telemetry. */
  isSecurity: boolean;
}

/** The server's OCSF severity SQL for a stream, shared by the tiles, chart and rows. */
export interface SeveritySql {
  sql: string;
  columns: string[];
  fromOutcome: boolean;
}

export interface SourceMatch {
  classification: Classification | null;
  isSecurity: boolean;
  severity: SeveritySql | null;
}

export type SourceDecision = "auto" | "suggested" | "ignored";
export type SourceReason = "auto" | "manual" | "pack";
export type SourceState = "mapped" | "included" | "excluded" | "not_mapped";
export type SourceHealth = "live" | "quiet" | "never";
export type SourceNoticeCode =
  | "pack_removed_outside"
  | "attached_without_record"
  | "pipeline_not_writing_back"
  | "pipeline_disabled";

export interface SourceVerdict {
  decision: SourceDecision;
  source_id: string;
  label: string;
  confidence: number;
}

export interface PackRef {
  id: string;
  version: number;
  label: string;
}

export interface SecuritySettingChange {
  at: number;
  by: string;
  summary: string;
}

export interface SourceRow {
  name: string;
  state: SourceState;
  reason: SourceReason | null;
  suggested: boolean;
  verdict: SourceVerdict | null;
  source_type: string;
  offered_pack: PackRef | null;
  detach_pack: PackRef | null;
  health: SourceHealth;
  activity: { doc_num: number; doc_time_max: number };
  included: boolean | null;
  updated_by: string;
  updated_at: number;
  last_change: SecuritySettingChange | null;
  /** The stored setting, which an include or exclude writes back with one field changed. */
  setting: SecuritySetting | null;
}

export interface SourceListing {
  streams: SourceRow[];
  /** Names of the org's Security sources. */
  sources: string[];
  /** Undecided suggestions, most confident first. */
  suggestions: string[];
  notices: { code: SourceNoticeCode; stream: string }[];
  /** False when the caller may read no logs stream; absent from servers that predate it. */
  streams_readable?: boolean;
}

export type AttachErrorCode =
  | "function_edited_outside"
  | "pipeline_no_access"
  | "pipeline_conflict"
  | "permission_denied"
  | "blocked"
  | "unknown_pack";

export type BlockCode =
  | "stream_not_written"
  | "flatten_level_mismatch"
  | "global_flatten_level"
  | "schema_missing_columns"
  | "pipeline_disabled";

export interface PreAttachBlock {
  code: BlockCode;
  streams?: string[];
  columns?: string[];
}

/** The body the server answers a refused attach or detach with. */
export interface AttachError {
  code: AttachErrorCode;
  message: string;
  blocks?: PreAttachBlock[];
}

export interface SecuritySetting {
  source_type: string;
  pack_id: string;
  pack_version: number;
  attached_at: number;
  pipeline_id: string;
  pipeline_created: boolean;
  included?: boolean | null;
  verdict?: SourceDecision | null;
  confidence?: number;
  updated_by?: string;
  updated_at?: number;
  changes?: SecuritySettingChange[];
}

export type PlanAction = "create" | "reuse" | "extend" | "already_present";

/** What an attach will do, from a dry run; nothing is written until the real attach. */
export interface AttachPlan {
  pack_id: string;
  pack_version: number;
  pack_label: string;
  ocsf_classes: number[];
  function_name: string;
  function_action: PlanAction;
  pipeline_action: PlanAction;
  /** Empty while the pipeline is still to be created. */
  pipeline_id: string;
  pipeline_name: string;
  /** The nodes the pack's function will feed. */
  feeds: string[];
}

export interface AttachResult {
  setting: SecuritySetting;
  pipeline_id: string;
  pipeline_created: boolean;
  plan: AttachPlan;
  dry_run: boolean;
}

export type DetachSkipReason = "pipeline_missing" | "other_stream" | "other_pack";

export interface DetachResult {
  setting: SecuritySetting | null;
  /** A recorded pipeline detach left alone because it no longer belongs to the stream. */
  skipped: { pipeline_id: string; reason: DetachSkipReason } | null;
}

interface RawClassification {
  source: SourceType;
  confidence: number;
  matched_required: string[];
  matched_signals: string[];
}

/** A readable Sigma logsource, e.g. `product=aws service=cloudtrail`. */
export function sigmaLogsourceLabel(sigma: SigmaLogsource | null | undefined): string {
  if (!sigma) return "";
  return [
    sigma.category ? `category=${sigma.category}` : "",
    sigma.product ? `product=${sigma.product}` : "",
    sigma.service ? `service=${sigma.service}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const securitySources = {
  list: (org: string) => http().get<SourceListing>(`/api/${org}/security/sources`),
  types: (org: string) => http().get<SourceType[]>(`/api/${org}/security/sources/types`),
  async match(
    org: string,
    fields: string[],
    sample: Record<string, unknown> | null = null,
  ): Promise<SourceMatch> {
    const res = await http().post<{
      classification: RawClassification | null;
      is_security: boolean;
      severity?: { sql: string; columns: string[]; from_outcome: boolean } | null;
    }>(`/api/${org}/security/sources/match`, { fields, sample });
    const severity = res.data?.severity ?? null;
    const raw = res.data?.classification ?? null;
    return {
      classification: raw
        ? {
            source: raw.source,
            confidence: raw.confidence,
            matchedRequired: raw.matched_required ?? [],
            matchedSignals: raw.matched_signals ?? [],
            isSecurity: Boolean(res.data?.is_security),
          }
        : null,
      isSecurity: Boolean(res.data?.is_security),
      severity: severity
        ? {
            sql: severity.sql,
            columns: severity.columns ?? [],
            fromOutcome: !!severity.from_outcome,
          }
        : null,
    };
  },
  classify: (org: string, streams: string[] = []) =>
    http().post(`/api/${org}/security/sources/classify`, { streams }),
  attach: (
    org: string,
    stream: string,
    body: { pack_id?: string; pack_version?: number; dry_run?: boolean } = {},
  ) =>
    http().post<AttachResult>(
      `/api/${org}/security/sources/${encodeURIComponent(stream)}/attach`,
      body,
    ),
  detach: (org: string, stream: string) =>
    http().post<DetachResult>(`/api/${org}/security/sources/${encodeURIComponent(stream)}/detach`),
};

/** The server's refusal of an attach or detach, when it sent one. */
export function attachErrorOf(err: unknown): AttachError | null {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === "object" && "code" in data && "message" in data) {
    return data as AttachError;
  }
  return null;
}

export default securitySources;
