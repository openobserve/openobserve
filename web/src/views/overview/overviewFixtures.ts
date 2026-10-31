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
    quiet_count: 3,
    schema_changes_24h: 5,
    compaction_pending: 12,
  }),
  alerts: ok({
    total: 12,
    enabled: 10,
    disabled: 2,
    by_state: {
      firing: 3,
      pending: 2,
      normal: 1,
      succeeded: 0,
      error: 4,
      skipped: 0,
      notify_failed: 0,
      suppressed: 0,
      never_evaluated: 0,
    },
    by_level: { ok: 0, warning: 1, critical: 2, no_data: 0, unclassified: 0 },
    failed_evaluation: 4,
    firing: [
      { name: "high_cpu", stream: "cpu_usage", level: "critical", since: 1_699_996_400_000_000 },
      { name: "slow_requests", stream: "web_logs", level: "warning", since: 1_699_999_000_000_000 },
    ],
    firing_by_level: { ok: 0, warning: 1, critical: 2, no_data: 0, unclassified: 0 },
  }),
  pipelines: ok({ total: 9, enabled: 8, disabled: 1, errored: 2 }),
  limits: ok({
    scope: "deployment",
    ingestion_used_percent: 85.5,
    expired: false,
    days_over_limit: 1,
    used_today_gb: 85.5,
    limit_today_gb: 100,
    allowed_days: 3,
    resets_at: 1_700_006_400_000_000,
  }),
  generated_at: 1_700_000_000_000_000,
  cached: false,
  ...over,
});

export const buildHealthyOverview = (): OrgOverview =>
  buildOverview({
    alerts: ok({
      total: 12,
      enabled: 10,
      disabled: 2,
      by_state: {
        firing: 0,
        pending: 0,
        normal: 10,
        succeeded: 0,
        error: 0,
        skipped: 0,
        notify_failed: 0,
        suppressed: 0,
        never_evaluated: 0,
      },
      by_level: { ok: 0, warning: 0, critical: 0, no_data: 0, unclassified: 0 },
      failed_evaluation: 0,
      firing: [],
      firing_by_level: { ok: 0, warning: 0, critical: 0, no_data: 0, unclassified: 0 },
    }),
    pipelines: ok({ total: 9, enabled: 8, disabled: 1, errored: 0 }),
  });
