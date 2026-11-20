import type { LocationQueryRaw } from "vue-router";
import { b64EncodeUnicode, escapeSingleQuotes } from "@/utils/zincutils";
import type { CompareResponse, NotServingPod } from "@/services/service_versions";
import type { PodLogsStreams } from "@/views/Infrastructure/kubernetes2/podLogsLink";
import { leadingVerdict } from "./verdictText";
export const POD_EVENTS_STREAM = "k8s_events";
export interface PodEventsLink {
  route: { path: "/logs"; query: LocationQueryRaw };
}
// The live preview cannot see K1 pods, so a stored not_serving verdict supplies them.
export function notServingPods(result: CompareResponse | undefined) {
  if (!result || result.stored_verdict?.restricted || result.live_verdict?.restricted)
    return { pods: [] as NotServingPod[], total: 0 };
  const source = [leadingVerdict(result), result.stored_verdict, result.live_verdict].find(
    (verdict) => verdict?.verdict === "not_serving" && verdict.pods?.length,
  );
  const pods = source?.pods ?? [];
  return { pods, total: Math.max(source?.pods_total ?? 0, pods.length) };
}
const quote = (value: string) => `'${escapeSingleQuotes(value)}'`;
const regarding = (field: string) => `json_get_str(body_object_regarding,'${field}')`;
function podTerms(pods: NotServingPod[], clusterField: boolean) {
  const groups = new Map<string, { cluster: string; namespace: string; names: string[] }>();
  for (const pod of pods) {
    const key = `${clusterField ? pod.k8s_cluster : ""}\u0000${pod.k8s_namespace}`;
    const group = groups.get(key) ?? {
      cluster: clusterField ? pod.k8s_cluster : "",
      namespace: pod.k8s_namespace,
      names: [],
    };
    group.names.push(pod.k8s_pod);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const terms = [
      `${regarding("namespace")} = ${quote(group.namespace)}`,
      `${regarding("name")} IN (${group.names.map(quote).join(", ")})`,
    ];
    if (group.cluster) terms.push(`k8s_cluster = ${quote(group.cluster)}`);
    return `(${terms.join(" AND ")})`;
  });
}
// The events stream is read through Logs, so the caller's own stream permissions apply.
export async function resolvePodEvents(
  pods: NotServingPod[],
  ctx: { orgId: string; start: number; end: number },
  api: PodLogsStreams,
): Promise<PodEventsLink | null> {
  if (!pods.length) return null;
  const list = await api.getStreams("logs", false, false).catch(() => null);
  const names = new Set(((list?.list ?? []) as Array<{ name: string }>).map((s) => s.name));
  if (!names.has(POD_EVENTS_STREAM)) return null;
  const schema = await api.getStream(POD_EVENTS_STREAM, "logs", true).catch(() => null);
  const fields = new Set<string>(
    ((schema?.schema ?? []) as Array<{ name: string }>).map((f) => f.name),
  );
  if (!fields.has("body_object_regarding")) return null;
  const filter = [
    `${regarding("kind")} = 'Pod'`,
    `(${podTerms(pods, fields.has("k8s_cluster")).join(" OR ")})`,
  ].join(" AND ");
  return {
    route: {
      path: "/logs",
      query: {
        stream_type: "logs",
        stream: POD_EVENTS_STREAM,
        from: ctx.start,
        to: ctx.end,
        sql_mode: "false",
        query: b64EncodeUnicode(filter),
        org_identifier: ctx.orgId,
        // Logs reads an absent quick_mode as on, which hides the event fields.
        quick_mode: "false",
        // The kept-alive Logs page re-reads the URL on activation only for this type.
        type: "trace_explorer",
      },
    },
  };
}
