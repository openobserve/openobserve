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

import type {
  ProfileMetric,
  ProfileNode,
  QueryProfile,
  RemoteNodeProfile,
} from "@/utils/queryProfile";

const MS = 1_000_000;
export const T0 = 1_760_000_000_000_000;

function metric(name: string, kind: string, value: number, total?: number): ProfileMetric {
  return total === undefined
    ? { name, kind, value, max: value }
    : { name, kind, value, total, max: value };
}

function op(
  name: string,
  detail: string,
  computeMs: number,
  rows: number,
  children: ProfileNode[] = [],
  extra: ProfileMetric[] = [],
): ProfileNode {
  const timeName = /DataSource|Memory/.test(name) ? "time_elapsed_processing" : "elapsed_compute";
  const node: ProfileNode = {
    name,
    detail: `${name}: ${detail}`,
    partitions: 8,
    metrics: [
      metric("output_rows", "count", rows),
      metric(timeName, "time", computeMs * MS),
      ...extra,
    ],
  };
  if (children.length) node.children = children;
  return node;
}

function querierLogsPlan(scale: number): ProfileNode {
  return op(
    "ProjectionExec",
    "expr=[k8s_namespace_name, k8s_pod_name]",
    3 * scale,
    660_000 * scale,
    [
      op("FilterExec", "level@2 = error", 205 * scale, 660_000 * scale, [
        op(
          "DataSourceExec",
          "file_groups={8 groups}, file_type=parquet",
          1480 * scale,
          2_950_000 * scale,
          [],
          [
            metric("bytes_scanned", "bytes", 480_000_000 * scale),
            metric("row_groups_pruned_statistics", "pruning", 475, 560),
            metric("metadata_load_time", "time", 53 * MS * scale),
          ],
        ),
      ]),
    ],
  );
}

function ingesterLogsPlan(scale: number): ProfileNode {
  return op(
    "ProjectionExec",
    "expr=[k8s_namespace_name, k8s_pod_name]",
    0.8 * scale,
    85_000 * scale,
    [
      op("FilterExec", "level@2 = error", 27 * scale, 85_000 * scale, [
        op("UnionExec", "", 0.2 * scale, 433_000 * scale, [
          op("MemoryExec", "partitions=2", 60 * scale, 206_000 * scale),
          op("DataSourceExec", "wal parquet, 10 files", 46 * scale, 227_000 * scale),
        ]),
      ]),
    ],
  );
}

function eventsPlan(scale: number): ProfileNode {
  return op("FilterExec", "reason@4 = OOMKilled", 15 * scale, 12_000 * scale, [
    op(
      "DataSourceExec",
      "file_groups={8 groups}, file_type=parquet",
      104 * scale,
      275_000 * scale,
      [],
      [metric("selectivity", "ratio", 12_000, 275_000)],
    ),
  ]);
}

interface NodeSpec {
  name: string;
  role: string;
  startMs: number;
  endMs: number;
  plan?: ProfileNode;
  partition: number;
  cache?: [number, number, number];
}

function remote(spec: NodeSpec): RemoteNodeProfile {
  const rows = Number(spec.plan?.metrics?.find((m) => m.name === "output_rows")?.value ?? 0);
  const [files, mem, disk] = spec.cache ?? [0, 0, 0];
  return {
    partition: spec.partition,
    node_name: spec.name,
    node_address: `10.2.0.${spec.partition + 10}:5081`,
    role: spec.role,
    region: "",
    cluster: "",
    start_us: T0 + spec.startMs * 1000,
    first_batch_us: T0 + (spec.startMs + 15) * 1000,
    end_us: T0 + spec.endMs * 1000,
    output_rows: rows,
    output_batches: Math.ceil(rows / 8192),
    output_bytes: rows * 40,
    fetch_ns: (spec.endMs - spec.startMs) * MS,
    decode_ns: 2 * MS,
    assigned_files: files,
    skipped: false,
    error: "",
    peak_memory: spec.name === "q-2" ? 1_200_000_000 : 300_000_000,
    scan_stats: {
      files,
      records: rows * 4,
      original_size: rows * 160,
      compressed_size: rows * 20,
      querier_files: files,
      querier_memory_cached_files: mem,
      querier_disk_cached_files: disk,
      idx_scan_size: 0,
      idx_took: files ? 40 : 0,
      file_list_took: 0,
      aggs_cache_ratio: 0,
      peak_memory_usage: 0,
      wait_in_queue: 0,
    },
    plan: spec.plan,
  };
}

/** Join of logs (4 queriers + 2 ingesters, q-2 a straggler) with k8s_events (4 queriers). */
export function joinProfile(): QueryProfile {
  const logs = [
    remote({
      name: "q-0",
      role: "querier",
      partition: 0,
      startMs: 322,
      endMs: 935,
      plan: querierLogsPlan(1),
      cache: [104, 43, 53],
    }),
    remote({
      name: "q-1",
      role: "querier",
      partition: 1,
      startMs: 324,
      endMs: 962,
      plan: querierLogsPlan(1),
      cache: [104, 41, 54],
    }),
    remote({
      name: "q-2",
      role: "querier",
      partition: 2,
      startMs: 326,
      endMs: 1688,
      plan: querierLogsPlan(2.2),
      cache: [104, 3, 9],
    }),
    remote({
      name: "q-3",
      role: "querier",
      partition: 3,
      startMs: 323,
      endMs: 891,
      plan: querierLogsPlan(0.9),
      cache: [100, 44, 50],
    }),
    remote({
      name: "i-0",
      role: "ingester",
      partition: 4,
      startMs: 325,
      endMs: 566,
      plan: ingesterLogsPlan(1),
    }),
    remote({
      name: "i-1",
      role: "ingester",
      partition: 5,
      startMs: 325,
      endMs: 583,
      plan: ingesterLogsPlan(1.1),
    }),
  ];
  const events = ["q-0", "q-1", "q-2", "q-3"].map((name, i) =>
    remote({
      name,
      role: "querier",
      partition: i,
      startMs: 321,
      endMs: 470 + i * 5,
      plan: eventsPlan(1),
      cache: [9, 4, 5],
    }),
  );
  const remoteScan = (entries: RemoteNodeProfile[], rows: number): ProfileNode => ({
    name: "RemoteScanExec",
    detail: `RemoteScanExec: input_partitions=output_partitions=${entries.length}`,
    partitions: entries.length,
    metrics: [metric("output_rows", "count", rows)],
    remote: entries,
  });
  const plan = op("SortPreservingMergeExec", "[cnt@1 DESC], fetch=10", 0.2, 10, [
    op("SortExec", "TopK(fetch=10)", 1.8, 40, [
      op("AggregateExec", "mode=FinalPartitioned, gby=[k8s_namespace_name]", 14, 1240, [
        op("RepartitionExec", "partitioning=Hash([k8s_namespace_name], 8)", 0.9, 8600, [
          op("AggregateExec", "mode=Partial, gby=[k8s_namespace_name]", 31, 8600, [
            op("HashJoinExec", "mode=CollectLeft, join_type=Inner", 96, 310_000, [
              op("CoalescePartitionsExec", "", 0.3, 48_000, [remoteScan(events, 48_000)]),
              remoteScan(logs, 2_810_000),
            ]),
          ]),
        ]),
      ]),
    ]),
  ]);
  return {
    version: 1,
    node_name: "q-1",
    node_address: "10.2.0.11:5081",
    start_us: T0 + 320_000,
    end_us: T0 + 1_840_000,
    output_rows: 10,
    plan,
  };
}
