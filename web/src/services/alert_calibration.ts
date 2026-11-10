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

import { isAxiosError } from "axios";
import http from "./http";
import analytics from "./product_analytics";
import type { I18nText, TranslateFn } from "@/types/i18n";
import type {
  DismissalPage,
  DismissalView,
  DismissBody,
} from "@/components/alert_calibration/dismissals";

/** The stored row `GET` and `PUT /api/v2/{org}/alert_calibration/config` return. */
export interface AlertCalibrationConfig {
  id: string;
  org: string;
  enabled: boolean;
  frequency_minutes: number;
  window_minutes: number;
  created_at: number;
  updated_at: number;
  /** Whether the caller may change this config; a server that does not say leaves it out, so only `false` limits the page. */
  can_edit?: boolean;
  /** Whether the caller may request a run; only `false` limits the page. */
  can_run?: boolean;
}

/** A partial update: an absent field keeps its stored value, and the server refuses any other key. */
export interface UpdateAlertCalibrationConfig {
  enabled?: boolean;
  frequency_minutes?: number;
  window_minutes?: number;
}

/** How the latest attempted run ended; a failed run writes no digest, so only this says why. */
export interface AlertCalibrationLastRun {
  status: "succeeded" | "skipped" | "error";
  error: string | null;
  finished_at: number;
  /** The digest stream was upgraded too recently for this run to write; a later run does. */
  deferred?: boolean;
}

export interface AlertCalibrationStatus {
  last_run: AlertCalibrationLastRun | null;
}

/** The list's query: `state` defaults to active on the server, and `cursor` is the previous page's `next_cursor`. */
export interface DismissalListParams {
  state?: "active" | "expired" | "reopened" | "all";
  cursor?: string;
  limit?: number;
}

/** The digest reads, as paths under `/digests`: runs, runs flagging an alert, one run's records, and per-rule tallies. */
export type DigestRead = "" | "/alerts" | "/records" | "/rules";

/** What a failed read was loading, named in its error copy. */
export type ReadSubject = "runs" | "run" | "settings";

interface HttpErrorLike {
  name?: string;
  message?: string;
  response?: { status?: number; data?: unknown };
}

export const httpStatus = (error: unknown): number | undefined =>
  (error as HttpErrorLike | null)?.response?.status;

/** The server's message when it sent one: a JSON `{ message }`, or the plain text axum answers a bad body with. */
export function errorMessage(error: unknown): string {
  const e = error as HttpErrorLike | null;
  const data = e?.response?.data;
  const body =
    typeof data === "object" && data !== null ? (data as { message?: unknown }).message : data;
  return typeof body === "string" && body ? body : (e?.message ?? "");
}

/** The one copy for a failed calibration read; the server's own words never reach the reader. */
export function readErrorCopy(
  t: TranslateFn,
  error: unknown,
  subject: ReadSubject = "runs",
): I18nText {
  if (httpStatus(error) === 403) return t("alertCalibration.readError.forbidden");
  if (isAxiosError(error) && !error.response) return t("alertCalibration.readError.unreachable");
  return t(`alertCalibration.readError.${subject}`);
}

export const isAbort = (error: unknown): boolean => {
  const name = (error as HttpErrorLike | null)?.name;
  return name === "CanceledError" || name === "AbortError";
};

const base = (org: string) => `/api/v2/${encodeURIComponent(org)}/alert_calibration`;

const alertCalibration = {
  getConfig: (org: string) => http().get<AlertCalibrationConfig>(`${base(org)}/config`),
  updateConfig: (org: string, body: UpdateAlertCalibrationConfig) =>
    http()
      .put<AlertCalibrationConfig>(`${base(org)}/config`, body)
      .then((res) => {
        analytics.track("alert_calibration_settings_updated", {
          enabled: res.data?.enabled,
          frequency_minutes: res.data?.frequency_minutes,
          window_minutes: res.data?.window_minutes,
        });
        return res;
      }),
  requestRun: (org: string) =>
    http()
      // The page words a refused run itself, so the access boundary records no 403.
      .post(`${base(org)}/digests/run`, undefined, { silentForbidden: true })
      .then((res) => {
        analytics.track("alert_calibration_run_requested");
        return res;
      }),
  getStatus: (org: string) => http().get<AlertCalibrationStatus>(`${base(org)}/status`),
  /** Read through the module's endpoints, so its permission, not the digest stream's, decides who sees them. */
  readDigests: async <T>(
    org: string,
    read: DigestRead,
    params: Record<string, string | number>,
    signal?: AbortSignal,
    options?: { silentForbidden?: boolean },
  ): Promise<T[]> => {
    const res = await http().get<T[]>(`${base(org)}/digests${read}`, {
      params,
      signal,
      ...(options?.silentForbidden ? { silentForbidden: true } : {}),
    });
    return res.data ?? [];
  },
  // The dismissal calls render their own refusal, so the access boundary records no 403 (P5a-D5).
  listDismissals: (org: string, params: DismissalListParams, signal?: AbortSignal) =>
    http().get<DismissalPage>(`${base(org)}/dismissals`, {
      params,
      signal,
      silentForbidden: true,
    }),
  dismissFinding: (org: string, findingId: string, body: DismissBody) =>
    http().post<DismissalView>(
      `${base(org)}/findings/${encodeURIComponent(findingId)}/dismiss`,
      body,
      { silentForbidden: true },
    ),
  reopenDismissal: (org: string, id: string, expectedRevision: number) =>
    http().post<DismissalView>(
      `${base(org)}/dismissals/${encodeURIComponent(id)}/reopen`,
      { expected_revision: expectedRevision },
      { silentForbidden: true },
    ),
};

export default alertCalibration;
