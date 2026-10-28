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

export type OverviewSectionStatus = "ok" | "error" | "locked" | "forbidden";

export interface OverviewSection<T> {
  status: OverviewSectionStatus;
  data?: T;
  error?: string;
  reason?: string;
}

export interface OverviewTopStream {
  name: string;
  doc_num: number;
  storage_size_mb: number;
}

export interface OverviewStreamTypeSummary {
  stream_type: string;
  count: number;
  doc_num: number;
  storage_size_mb: number;
  compressed_size_mb: number;
  top: OverviewTopStream[];
}

export interface OverviewStreamsData {
  total_streams: number;
  total_storage_size_mb: number;
  by_type: OverviewStreamTypeSummary[];
}

export interface OverviewAlertsData {
  total: number;
  enabled: number;
  disabled: number;
  by_state: Record<string, number>;
  by_level: Record<string, number>;
  failed_evaluation: number;
}

export interface OverviewPipelinesData {
  total: number;
  enabled: number;
  disabled: number;
  errored: number;
}

export interface OverviewLimitsData {
  scope: string;
  ingestion_used_percent: number;
  expired: boolean;
  days_over_limit: number;
}

export interface OrgOverview {
  streams: OverviewSection<OverviewStreamsData>;
  alerts: OverviewSection<OverviewAlertsData>;
  pipelines: OverviewSection<OverviewPipelinesData>;
  limits: OverviewSection<OverviewLimitsData>;
  generated_at: number;
  cached: boolean;
}
