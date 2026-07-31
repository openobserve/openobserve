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

/** What the API returns for one SLO's measurement.
 *
 *  Every derived field is nullable, and that is load-bearing: below the
 *  coverage floor the backend reports `no_data` with the derived figures
 *  absent rather than an SLI computed from a fraction of the window. A UI that
 *  defaults them to 0 would render a frozen SLO as 0% available — the exact
 *  failure coverage gating exists to prevent. */
export interface SloStatus {
  group_key: string;
  /** 0..1 */
  coverage: number;
  no_data: boolean;
  /** Percentage 0..100, or null when frozen / not yet measured. */
  sli: number | null;
  /** PERCENTAGE remaining, signed. Negative means overspent. */
  error_budget_remaining: number | null;
  burn_rate: number | null;
  time_to_exhaust_secs: number | null;
  good: number;
  total: number;
  covered_slices: number;
  computed_at: number | null;
}

export type SliType = "count" | "time_slice" | "alert";

export interface SloDefinition {
  sli_type: SliType;
  config: Record<string, any>;
  group_by?: string[] | null;
  window_secs: number;
  slice_interval_secs: number;
}

export interface Slo {
  id: string;
  org: string;
  folder_id: string;
  name: string;
  description: string;
  sli_type: SliType;
  config: Record<string, any>;
  group_by?: string[] | null;
  window_secs: number;
  slice_interval_secs: number;
  target: number;
  tags: string[];
  enabled: boolean;
  owner?: string | null;
  definition_generation: number;
  groups_estimate?: number | null;
  groups_reserved: number;
}

export interface SloListItem extends Slo {
  status: SloStatus | null;
}
