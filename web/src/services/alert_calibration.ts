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
import searchService from "./search";

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

export interface DigestSearchRange {
  startTime: number;
  endTime: number;
}

interface HttpErrorLike {
  name?: string;
  message?: string;
  response?: { status?: number; data?: unknown };
}

export const httpStatus = (error: unknown): number | undefined =>
  (error as HttpErrorLike | null)?.response?.status;

/** The `code` of an O2 error body, which for a search is its `ErrorCodes` number. */
export function errorCode(error: unknown): number | undefined {
  const data = (error as HttpErrorLike | null)?.response?.data;
  const code =
    typeof data === "object" && data !== null ? (data as { code?: unknown }).code : undefined;
  return typeof code === "number" ? code : undefined;
}

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
  /** Digests are log records, so they are read with an ordinary logs search over the digest stream. */
  searchDigests: async <T>(
    org: string,
    sql: string,
    range: DigestSearchRange,
    size: number,
    signal?: AbortSignal,
  ): Promise<T[]> => {
    const res = await searchService.search(
      {
        org_identifier: org,
        query: {
          query: { sql, start_time: range.startTime, end_time: range.endTime, from: 0, size },
        },
        page_type: "logs",
        signal,
      },
      "ui",
    );
    return (res?.data?.hits ?? []) as T[];
  },
};

export default alertCalibration;
