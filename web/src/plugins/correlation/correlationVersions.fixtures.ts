import type { Scope } from "@/services/service_versions";

// A real `_services` row from web/src/test/unit/fixtures/serviceVersions/stage7.json (services_rum), trimmed to the fields the drawer reads.
const golden: Scope = {
  active_version_keys: {
    "0.0.1": "vk-16",
    "0.0.2": "vk-8",
  },
  active_versions: ["0.0.2", "0.0.1"],
  current_version: "0.0.2",
  env: "prod",
  env_inferred: "prod",
  env_inferred_source: "rum",
  env_source: "rum",
  env_source_value: "env=prod",
  last_good_version: null,
  newest_first_seen: 1793260650041322,
  newest_version: "0.0.2",
  newest_version_key: "vk-8",
  override_key: null,
  previous_version: "0.0.1",
  scope_key: "sk-5",
  service: "storefront",
  signals: ["rum"],
  verdict_counts: {
    watch: 1,
  },
  where: {
    k8s_cluster: "",
    k8s_namespace: "",
    kind: "env",
  },
  where_key: "env:prod",
  newest_verdict: {
    verdict_key: "vd-5",
    version_key: "vk-8",
    service: "storefront",
    where_key: "env:prod",
    version: "0.0.2",
    verdict: "watch",
    baseline: {
      env: "prod",
      initial_rule: "previous",
      rule: "previous",
      switched_at: null,
      traffic_share: null,
      version: "0.0.1",
      where_key: "env:prod",
    },
    deploy_key: "dk-6",
  },
};

const at = (service: string, where: Scope["where"], whereKey: string, env: string): Scope => ({
  ...golden,
  service,
  where,
  where_key: whereKey,
  env,
  signals: ["traces"],
  newest_verdict: golden.newest_verdict
    ? { ...golden.newest_verdict, service, where_key: whereKey }
    : golden.newest_verdict,
});

// Columns of the seeded traces stream (the stage 8 golden trace hit's fields plus its stamped resource columns).
const traceColumns = [
  "_timestamp",
  "trace_id",
  "span_id",
  "start_time",
  "end_time",
  "duration",
  "operation_name",
  "service_name",
];
const traceFields = {
  k8s: [
    ...traceColumns,
    "o2_service_version",
    "service_k8s_cluster_name",
    "service_k8s_namespace_name",
    "service_k8s_pod_name",
  ],
  plain: [...traceColumns, "o2_service_version", "service_host_name"],
  unversioned: traceColumns,
};

/** A GET /streams/{name}/schema answer listing the given columns. */
function traceSchema(fields: string[]) {
  return {
    data: {
      name: "default",
      stream_type: "traces",
      schema: fields.map((name) => ({ name, type: name === "_timestamp" ? "Int64" : "Utf8" })),
    },
  };
}

export const correlationFixtures = {
  golden,
  traceFields,
  traceSchema,
  scopes: [
    at("ingester", { kind: "k8s", k8s_cluster: "c1", k8s_namespace: "c1" }, "k8s:c1/c1", "prod"),
    at("ingester", { kind: "env", k8s_cluster: "", k8s_namespace: "" }, "env:dev", "dev"),
    at("querier", { kind: "k8s", k8s_cluster: "c1", k8s_namespace: "c1" }, "k8s:c1/c1", "prod"),
  ],
};
