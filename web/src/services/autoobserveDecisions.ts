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

export type DecisionFamily = "suggestion" | "alert_finding";
export type DecisionAction = "dismiss" | "accept" | "apply";
export type DecisionReason =
  "not_needed" | "planned_work" | "false_positive" | "will_fix_later" | "intended_report" | "other";
export type DecisionState = "active" | "expired" | "undone" | "applied";
export type DecisionChange = "created" | "updated" | "unchanged" | "undone";
export type DecisionSource = "ui" | "slack" | "api";

export interface PersonRef {
  email: string;
}

/** The 403 body every decision route sends, and a preview's `locked`; `message` is written for people. */
export interface Refusal {
  code: string;
  /** The grant the caller lacks: the folder's, the Security permission (detections) or the org's. */
  reason: "folder" | "security" | "org";
  verb: string;
  message: string;
  folder: string | null;
  /** Emails of whom to ask; empty when nobody can be asked, which hides Ask admins. */
  owners: string[];
  owners_scope: "folder" | "org" | null;
  can_act: PersonRef[];
  more: number;
}

export interface SubjectInfo {
  title: string;
  folder: string | null;
  team: string | null;
}

/** One field an apply changes; values are as the alert stores them. */
export type FieldChange =
  | { field: "destinations"; from: string[]; to: string[] }
  | {
      field: "pending_period_secs" | "keep_firing_for_secs" | "silence_minutes";
      from: number;
      to: number;
    };

/** What applying a finding's suggested change would do, as the preview sends it. */
export interface ChangePreview {
  alert: { title: string; folder: string | null; team: string | null; destinations: string[] };
  fields: FieldChange[];
  /** `count` of the run's `of` acknowledged firings would no longer alert; absent when the run did not record it. */
  acknowledged_firings_dropped?: { count: number; of: number; first_at?: number };
}

export interface DecisionView {
  /** `{family}:{id}`; the undo path, never shown. */
  decision_id: string;
  family: DecisionFamily;
  id: string;
  action: DecisionAction;
  state: DecisionState;
  /** A stored reason, which can also be `expected` from an older calibration row. */
  reason: string | null;
  /** Null when none was written, or when this reader may not see it (`has_note` tells). */
  note: string | null;
  has_note: boolean;
  actor: string;
  source: DecisionSource | null;
  decided_at: number;
  until: number | null;
  revision: number;
  /** Only the list sends it. */
  subject?: SubjectInfo;
  /** An apply's alert and fields, on servers that list applies. */
  change?: { alert: { id: string; title: string }; fields: FieldChange[] };
  via?: "apply" | "editor";
  /** When and by whom an apply was undone, on servers that keep `decided_at` as the change time. */
  undone_at?: number | null;
  undone_by?: string | null;
}

export interface Preview {
  may: boolean;
  verb: string;
  decision_id: string;
  family: DecisionFamily;
  id: string;
  action: DecisionAction;
  effect: {
    scope: string;
    until: number | null;
    comes_back_when: "at_until" | "when_undone";
    mark?: string;
  };
  subject: SubjectInfo;
  /** The revision the caller saw, sent back as `expected_revision`; 0 before any decision. */
  revision: number;
  current: DecisionView | null;
  locked?: Refusal;
  /** Sent for an apply only. */
  change?: ChangePreview;
  summary?: string;
}

/** The server refuses unknown keys. */
export interface DecisionRequest {
  family: DecisionFamily;
  id: string;
  action: DecisionAction;
  reason?: DecisionReason;
  note?: string;
  /** Unix microseconds; planned work only, at most 7 days ahead. */
  until?: number;
  duration_days?: number;
  until_reopened?: boolean;
  /** Records an apply the editor's Save already wrote. */
  applied_via?: "editor";
  expected_revision?: number;
  /** One per dialog, so a double click or a retry writes once. */
  request_id?: string;
}

export interface UndoRequest {
  expected_revision: number;
  request_id?: string;
}

export interface DecisionResult {
  change: DecisionChange;
  decision: DecisionView;
}

export interface Failure {
  code: number;
  error: string;
  message: string;
}

export interface BatchItemResult {
  index: number;
  family: DecisionFamily;
  id: string;
  status: number;
  result?: DecisionResult;
  error?: Failure | Refusal;
}

export interface BatchResult {
  results: BatchItemResult[];
  written: number;
  unchanged: number;
  failed: number;
}

export interface DecisionList {
  decisions: DecisionView[];
  /** Every match this reader can see, before paging. */
  total: number;
  limit: number;
  offset: number;
}

export type PreviewParams = Pick<
  DecisionRequest,
  "family" | "id" | "action" | "reason" | "until" | "duration_days" | "until_reopened"
>;

export interface DecisionListParams {
  /** Absent lists undone applies too; `active` lists only what is in force. */
  state?: "active";
  family?: DecisionFamily;
  limit: number;
  offset: number;
}

interface HttpErrorLike {
  response?: { status?: number; data?: unknown };
}

const statusOf = (error: unknown): number | undefined =>
  (error as HttpErrorLike | null)?.response?.status;

/** The routes answer 404 while `O2_AUTOOBSERVE_DECISIONS_ENABLED` is off, and an OSS build has none. */
export const isRouteDisabled = (error: unknown): boolean => statusOf(error) === 404;

/** A 404 naming `not_found` comes from a running route whose item is gone, not from a switched-off one. */
export const isItemGone = (error: unknown): boolean =>
  statusOf(error) === 404 &&
  (error as { response?: { data?: { error?: unknown } } }).response?.data?.error === "not_found";

/** A refusal carries `decision_refused`; any other 403 is the access layer's own. */
export function refusalOf(error: unknown): Refusal | null {
  if (statusOf(error) !== 403) return null;
  const data = (error as HttpErrorLike).response?.data;
  return isRefusal(data) ? data : null;
}

export const isRefusal = (value: unknown): value is Refusal =>
  typeof value === "object" &&
  value !== null &&
  (value as { code?: unknown }).code === "decision_refused" &&
  typeof (value as { message?: unknown }).message === "string";

const base = (org: string) => `/api/v2/${encodeURIComponent(org)}/autoobserve/decisions`;

// Every call renders its own refusal, so the access boundary records no 403.
const autoobserveDecisions = {
  preview: (org: string, params: PreviewParams, signal?: AbortSignal) =>
    http().get<Preview>(`${base(org)}/preview`, { params, signal, silentForbidden: true }),
  decide: (org: string, body: DecisionRequest) =>
    http().post<DecisionResult>(base(org), body, { silentForbidden: true }),
  decideBatch: (org: string, items: DecisionRequest[]) =>
    http().post<BatchResult>(base(org), { items }, { silentForbidden: true }),
  undo: (org: string, decisionId: string, body: UndoRequest) =>
    http().post<DecisionResult>(`${base(org)}/${encodeURIComponent(decisionId)}/undo`, body, {
      silentForbidden: true,
    }),
  list: (org: string, params: DecisionListParams, signal?: AbortSignal) =>
    http().get<DecisionList>(base(org), { params, signal, silentForbidden: true }),
};

export default autoobserveDecisions;
