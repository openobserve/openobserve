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
import type {
  Indicator,
  IndicatorMatch,
  IndicatorType,
  MatchMode,
  SweepType,
} from "@/utils/security/intel";

/** Indicators one list may hold; the validate endpoint echoes the cap it enforces. */
export const MAX_LIST_INDICATORS = 5_000;
/** Queries one sweep may run; the server stops there and reports `capped`. */
export const MAX_SWEEP_QUERIES = 200;

export interface ClassifiedValue {
  indicator: string;
  type: IndicatorType;
  /** An earlier value in the same request is the same indicator. */
  duplicate: boolean;
}

export interface ParsedIndicators {
  valid: { indicator: string; type: IndicatorType }[];
  invalid: { line: number; value: string }[];
  duplicates: number;
}

export interface ValidateRequest {
  text?: string;
  forced_type?: IndicatorType | null;
  values?: string[];
  held?: number;
}

export interface ValidateResponse {
  parsed: ParsedIndicators | null;
  values: (ClassifiedValue | null)[];
  max_indicators: number;
  /** How many more indicators the list may take. */
  room: number;
}

export interface SweepStreamTarget {
  name: string;
  /** Columns the stream's source maps to a type. */
  mapped?: Partial<Record<SweepType, string[]>>;
}

export interface SweepCoverage {
  type: SweepType;
  indicators: number;
  columns: { stream: string; column: string }[];
  skipped: { stream: string; column: string }[];
}

export interface SweepResponse {
  matches: (Omit<IndicatorMatch, "indicator"> & {
    indicator: Pick<Indicator, "indicator" | "type" | "table">;
  })[];
  streams: string[];
  unread_streams: string[];
  planned: number;
  capped: boolean;
  failed: number;
  partial_results: number;
  checked: number;
  total: number;
  partial: boolean;
  coverage: SweepCoverage[];
}

export interface SightingsRequest {
  type: SweepType;
  indicator: string;
  interval: string;
  start_time: number;
  end_time: number;
  sightings: { stream: string; column: string; mode: MatchMode }[];
}

export interface SightingsResponse {
  series: {
    stream: string;
    column: string;
    mode: MatchMode;
    hits: { zo_ts: unknown; zo_n: unknown }[];
    failed: boolean;
  }[];
}

const securityIntel = {
  validate: (org: string, body: ValidateRequest) =>
    http().post<ValidateResponse>(`/api/${org}/security/intel/validate`, body),
  sweep: (
    org: string,
    indicators: Pick<Indicator, "indicator" | "type" | "severity" | "confidence" | "table">[],
    streams: SweepStreamTarget[],
    window: { start: number; end: number },
    signal?: AbortSignal,
  ) =>
    http().post<SweepResponse>(
      `/api/${org}/security/intel/sweep`,
      {
        indicators: indicators.map((i) => ({
          indicator: i.indicator,
          type: i.type,
          severity: i.severity,
          confidence: i.confidence,
          table: i.table,
        })),
        streams,
        start_time: window.start,
        end_time: window.end,
      },
      { signal },
    ),
  sightings: (org: string, body: SightingsRequest) =>
    http().post<SightingsResponse>(`/api/${org}/security/intel/sightings`, body),
};

/** Classifies cells one by one on the server; null where a cell is not an indicator. */
export async function classifyValues(
  org: string,
  values: string[],
): Promise<(ClassifiedValue | null)[]> {
  if (!values.length) return [];
  return (await securityIntel.validate(org, { values })).data.values;
}

export default securityIntel;
