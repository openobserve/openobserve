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

/** The stored row `GET` and `PUT /api/v2/{org}/alert_calibration/config` return. */
export interface AlertCalibrationConfig {
  id: string;
  org: string;
  enabled: boolean;
  frequency_minutes: number;
  window_minutes: number;
  created_at: number;
  updated_at: number;
}

/** A partial update: an absent field keeps its stored value, and the server refuses any other key. */
export interface UpdateAlertCalibrationConfig {
  enabled?: boolean;
  frequency_minutes?: number;
  window_minutes?: number;
}

/** How the latest attempted run ended; a failed run writes no digest, so only this says why. */
export interface AlertCalibrationLastRun {
  status: "succeeded" | "error";
  error: string | null;
  finished_at: number;
}

export interface AlertCalibrationStatus {
  last_run: AlertCalibrationLastRun | null;
}

/** The digest reads, as paths under `/digests`: runs, runs flagging an alert, one run's records, and per-rule tallies. */
export type DigestRead = "" | "/alerts" | "/records" | "/rules";

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

export const isAbort = (error: unknown): boolean => {
  const name = (error as HttpErrorLike | null)?.name;
  return name === "CanceledError" || name === "AbortError";
};

const base = (org: string) => `/api/v2/${encodeURIComponent(org)}/alert_calibration`;

const alertCalibration = {
  getConfig: (org: string) => http().get<AlertCalibrationConfig>(`${base(org)}/config`),
  updateConfig: (org: string, body: UpdateAlertCalibrationConfig) =>
    http().put<AlertCalibrationConfig>(`${base(org)}/config`, body),
  requestRun: (org: string) => http().post(`${base(org)}/digests/run`),
  getStatus: (org: string) => http().get<AlertCalibrationStatus>(`${base(org)}/status`),
  /** Read through the module's endpoints, so its permission, not the digest stream's, decides who sees them. */
  readDigests: async <T>(
    org: string,
    read: DigestRead,
    params: Record<string, string | number>,
    signal?: AbortSignal,
  ): Promise<T[]> => {
    const res = await http().get<T[]>(`${base(org)}/digests${read}`, { params, signal });
    return res.data ?? [];
  },
};

export default alertCalibration;
