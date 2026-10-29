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

import {
  deleteEditorDraft,
  hasEditorDraft,
  type EditorDraftKind,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";

export const ALERT_DRAFT_KIND: EditorDraftKind = "alert";

/** New anomaly detections keep their own new-item slot, apart from new alerts. */
export const ANOMALY_DRAFT_VARIANT = "anomaly";

/** How many alerts a bulk delete's by-id check asks the server for at once. */
export const ALERT_LOOKUP_CONCURRENCY = 4;

/** How the editor tells its host about a save; `navigate: false` is the leave dialog's Save. */
export interface AlertSavedOptions {
  navigate: boolean;
}

// Written by every evaluation, so they would flag every draft as changed on the server.
const ALERT_RUNTIME_FIELDS = ["last_triggered_at", "last_satisfied_at"];

// Written by training and detection runs, never by the person editing the config.
const ANOMALY_RUNTIME_FIELDS = [
  "status",
  "is_trained",
  "current_model_version",
  "band_k",
  "last_error",
  "training_started_at",
  "training_completed_at",
  "training_data_start_us",
  "training_data_end_us",
  "notice_class",
  "last_detection_run",
  "next_run_at",
  "last_processed_timestamp",
  "retries",
  "last_failed_at",
  "last_alert_fired_at",
  "last_recovery_notified_at",
  "last_anomaly_detected_at",
  "last_outcome",
  "last_outcome_at",
  "last_updated",
  "created_at",
  "updated_at",
];

const omitFields = (
  value: Record<string, unknown> | null | undefined,
  fields: string[],
): Record<string, unknown> => {
  const copy: Record<string, unknown> = JSON.parse(JSON.stringify(value ?? {}));
  fields.forEach((field) => delete copy[field]);
  return copy;
};

export const isNotFoundError = (error: unknown): boolean =>
  (error as { response?: { status?: unknown } } | null)?.response?.status === 404;

/** The ids the server answers 404 for, asked at most `concurrency` at a time; any other answer keeps the id. */
export const findDeletedAlertIds = async (
  ids: string[],
  getAlert: (id: string) => Promise<unknown>,
  concurrency: number = ALERT_LOOKUP_CONCURRENCY,
): Promise<string[]> => {
  const queue = [...ids];
  const gone = new Set<string>();
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        await getAlert(id);
      } catch (error) {
        if (isNotFoundError(error)) gone.add(id);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), queue.length) }, worker),
  );
  return ids.filter((id) => gone.has(id));
};

/** The saved alert as the draft's base: the server copy without its evaluation bookkeeping. */
export const alertDraftBase = (alert: Record<string, unknown> | null | undefined) =>
  omitFields(alert, ALERT_RUNTIME_FIELDS);

/** The anomaly config the user edits, without the fields training and detection keep updating. */
export const anomalyDraftConfig = (config: Record<string, unknown> | null | undefined) =>
  omitFields(config, ANOMALY_RUNTIME_FIELDS);

/** Drops this user's draft of an alert the server no longer has; true when there was one. */
export const dropDraftOfMissingAlert = (scope: Omit<EditorDraftScope, "kind">): boolean => {
  const full: EditorDraftScope = { ...scope, kind: ALERT_DRAFT_KIND };
  if (!hasEditorDraft(full)) return false;
  deleteEditorDraft(full);
  return true;
};
