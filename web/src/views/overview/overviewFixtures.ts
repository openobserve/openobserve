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

import type { OrgOverview, OverviewSection } from "@/ts/interfaces/overview";

const ok = <T>(data: T): OverviewSection<T> => ({ status: "ok", data });

export const buildOverview = (over: Partial<OrgOverview> = {}): OrgOverview => ({
  streams: ok({
    total_streams: 7,
    total_storage_size_mb: 2048,
    by_type: [
      {
        stream_type: "logs",
        count: 4,
        doc_num: 1000,
        storage_size_mb: 1536,
        compressed_size_mb: 300,
        top: [
          { name: "app_logs", doc_num: 900, storage_size_mb: 1024 },
          { name: "web_logs", doc_num: 100, storage_size_mb: 400 },
        ],
      },
      {
        stream_type: "metrics",
        count: 3,
        doc_num: 50,
        storage_size_mb: 512,
        compressed_size_mb: 100,
        top: [{ name: "cpu_usage", doc_num: 50, storage_size_mb: 512 }],
      },
    ],
  }),
  alerts: ok({
    total: 12,
    enabled: 10,
    disabled: 2,
    by_state: { firing: 3, pending: 2, error: 4, normal: 1 },
    by_level: {},
    failed_evaluation: 4,
  }),
  pipelines: ok({ total: 9, enabled: 8, disabled: 1, errored: 2 }),
  limits: ok({
    scope: "deployment",
    ingestion_used_percent: 85.5,
    expired: false,
    days_over_limit: 1,
  }),
  generated_at: 1_700_000_000_000_000,
  cached: false,
  ...over,
});
