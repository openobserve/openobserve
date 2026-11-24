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

/** Response of GET /api/{org}/anomaly_detection/{id}/explore, Phase 1 shape. */
export type AnomalyExploreState = "ongoing" | "back_in_range" | "none" | "no_runs";

export type AnomalyExploreTarget = "logs" | "traces" | "metrics";

export type AnomalySummaryKind = "value" | "absence" | "partial_drop";

export interface AnomalyExploreSummary {
  kind: AnomalySummaryKind;
  actual: number | null;
  expected: number | null;
  expected_lower: number | null;
  expected_upper: number | null;
  change_percent: number | null;
  started_us: number | null;
  since_us: number | null;
}

export interface AnomalyExploreWindow {
  start_us: number;
  end_us: number;
  clipped: boolean;
}

export interface AnomalyExploreResponse {
  url: string;
  label: string;
  target: AnomalyExploreTarget;
  filter_applied: boolean;
  name: string;
  measure: string;
  stream: string;
  filter: string | null;
  state: AnomalyExploreState;
  state_source: "buckets";
  summary: AnomalyExploreSummary | null;
  /** current_model_version when trained, else 0. */
  model_version: number;
  last_detection_run: number | null;
  cursor_us: number | null;
  no_new_data_since_us: number | null;
  window: AnomalyExploreWindow | null;
  explore_start_us: number;
}

/** Query of the explore request; a point link sends one bucket as start and end with pad 0. */
export interface AnomalyExploreQuery {
  start?: number;
  end?: number;
  pad?: 0 | 1;
  model_version?: number;
}
