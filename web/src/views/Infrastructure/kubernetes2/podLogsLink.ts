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

import searchService from "@/services/search";
import { b64EncodeUnicode, escapeSingleQuotes } from "@/utils/zincutils";

export interface PodLogsTarget {
  cluster: string;
  namespace: string;
  pod: string;
}

export interface PodLogsContext {
  orgId: string;
  start: number;
  end: number;
  // The page scope spans several clusters (cluster=*).
  multiCluster: boolean;
}

export interface PodLogsStreams {
  getStreams: (type: string, schema: boolean, notify?: boolean) => Promise<any>;
  getStream: (name: string, type: string, schema: boolean) => Promise<any>;
}

export interface PodLogsLink {
  route: { path: "/logs"; query: Record<string, string | number> };
  warnNoClusterField: boolean;
}

interface Candidate {
  stream: string;
  filter: string;
  hasClusterField: boolean;
}

// The openobserve-collector's stream first: it wins every tie.
const CANDIDATES = ["default", "logs_default"];

const pick = (fields: Set<string>, options: string[]) => options.find((f) => fields.has(f)) ?? null;

async function qualify(
  stream: string,
  target: PodLogsTarget,
  api: PodLogsStreams,
): Promise<Candidate | null> {
  const schema = await api.getStream(stream, "logs", true).catch(() => null);
  const fields = new Set<string>(
    ((schema?.schema ?? []) as Array<{ name: string }>).map((f) => f.name),
  );
  const podField = pick(fields, ["k8s_pod_name", "pod_name"]);
  const nsField = pick(fields, ["k8s_namespace_name", "namespace"]);
  if (!podField || !nsField) return null;
  const clusterField = pick(fields, ["k8s_cluster", "k8s_cluster_name", "cluster"]);
  const terms = [
    `${podField}='${escapeSingleQuotes(target.pod)}'`,
    `${nsField}='${escapeSingleQuotes(target.namespace)}'`,
  ];
  if (clusterField && target.cluster) {
    terms.push(`${clusterField}='${escapeSingleQuotes(target.cluster)}'`);
  }
  return { stream, filter: terms.join(" AND "), hasClusterField: clusterField != null };
}

async function countHits(candidate: Candidate, ctx: PodLogsContext) {
  const res: any = await searchService.search(
    {
      org_identifier: ctx.orgId,
      query: {
        query: {
          sql: `SELECT COUNT(*) AS n FROM "${candidate.stream}" WHERE ${candidate.filter}`,
          start_time: ctx.start,
          end_time: ctx.end,
          from: 0,
          size: 1,
        },
      },
      page_type: "logs",
    },
    "ui",
  );
  return Number(res?.data?.hits?.[0]?.n ?? 0);
}

export async function resolvePodLogs(
  target: PodLogsTarget,
  ctx: PodLogsContext,
  api: PodLogsStreams,
): Promise<PodLogsLink | null> {
  const list = await api.getStreams("logs", false, false).catch(() => null);
  const names = new Set(((list?.list ?? []) as Array<{ name: string }>).map((s) => s.name));
  const qualified: Candidate[] = [];
  for (const stream of CANDIDATES.filter((name) => names.has(name))) {
    const candidate = await qualify(stream, target, api);
    if (candidate) qualified.push(candidate);
  }
  if (qualified.length === 0) return null;
  let chosen = qualified[0];
  if (qualified.length === 2) {
    const [primary, generator] = await Promise.allSettled(
      qualified.map((candidate) => countHits(candidate, ctx)),
    );
    const n = (r: PromiseSettledResult<number>) => (r.status === "fulfilled" ? r.value : 0);
    if (n(primary) === 0 && n(generator) > 0) chosen = qualified[1];
  }
  return {
    route: {
      path: "/logs",
      query: {
        stream_type: "logs",
        stream: chosen.stream,
        from: ctx.start,
        to: ctx.end,
        sql_mode: "false",
        query: b64EncodeUnicode(chosen.filter),
        org_identifier: ctx.orgId,
        // The keep-alive Logs route restores URL params only on this branch.
        type: "trace_explorer",
      },
    },
    warnNoClusterField: !chosen.hasClusterField && ctx.multiCluster,
  };
}
