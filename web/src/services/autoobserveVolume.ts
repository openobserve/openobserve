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

export type VolumeStatus = "volume" | "presence_only" | "warmup" | "irregular" | "no_data";

export type VolumeClass =
  "low" | "high" | "normal" | "spread" | "quiet" | "missing" | "busy_missing";

/** One bucket as the stream watch judged it; times are microseconds, nulls are unjudged. */
export interface VolumeBucket {
  t: number;
  actual: number | null;
  expected: number | null;
  lower: number | null;
  upper: number | null;
  expected_present: boolean | null;
  class: VolumeClass | null;
}

export interface VolumeForecast {
  t: number;
  expected: number | null;
  lower: number | null;
  upper: number | null;
}

export interface VolumeMarker {
  t: number;
  decided_at: number;
  kind: string;
  reason: string;
  ratio: number | null;
  decision_id: string;
  incident_id: string | null;
  recovered_at: number | null;
}

export interface VolumeSeries {
  stream_type: string;
  stream_name: string;
  width_secs: number;
  status: VolumeStatus;
  rows_per_day: number | null;
  exact: boolean;
  days: { day: number; trained_day: number | null; resolution: number }[];
  buckets: VolumeBucket[];
  forecast: VolumeForecast[];
  markers: VolumeMarker[];
}

/** Ids the caller may not read come back in `denied`, never as a whole-request 403. */
export interface VolumeSeriesList {
  series: VolumeSeries[];
  denied: string[];
}

// The route takes at most this many ids and a range of at most seven days.
export const VOLUME_MAX_IDS = 50;

const autoobserveVolume = {
  streams: (org: string, ids: string[], fromUs: number, toUs: number) =>
    http().get<VolumeSeriesList>(`/api/v2/${org}/autoobserve/streams/volume`, {
      params: { ids: ids.join(","), from: fromUs, to: toUs },
      silentForbidden: true,
    }),
};

export default autoobserveVolume;
