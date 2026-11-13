import type {
  Environment,
  IdentityEnvsResponse,
  IdentityOverride,
} from "@/services/service_versions";

// Trimmed and anonymised from the recorded producer run in test/unit/fixtures/serviceVersions/stage7.json.
const golden = {
  override: {
    created_at: 1793171174807348,
    created_by: "root@example.com",
    deleted_at: null,
    inferred_source: "namespace",
    inferred_value: "prod",
    k8s_cluster: "eu-a",
    org_id: "stage7_8351bfaa",
    rule_key: "rk-3",
    rule_type: "env_override",
    scope: "where",
    service_name: "",
    updated_at: 1793171174807348,
    updated_by: "root@example.com",
    value: "eu1cloud",
    where_key: "k8s:eu-a/shop-cloud-prod",
    writer_cluster: "node-2",
  } satisfies IdentityOverride,
  envs: {
    can_edit: true,
    envs: [{ env: "prod", services: 3, sources: ["namespace", "rum"], versions: 5, wheres: 2 }],
    scope_counts: { cluster: 1, service: 1, where: 1 },
    scope_versions: { cluster: 2, service: 2, where: 2 },
  } satisfies IdentityEnvsResponse,
  envsRum: {
    can_edit: true,
    envs: [{ env: "prod", services: 3, sources: ["namespace", "rum"], versions: 5, wheres: 2 }],
    scope_counts: { service: 0, where: 2 },
    scope_versions: { service: 0, where: 3 },
  } satisfies IdentityEnvsResponse,
  rumIdentity: {
    where_key: "env:prod",
    where: { k8s_cluster: "", k8s_namespace: "", kind: "env" },
    env: "prod",
    env_source: "rum",
    env_source_value: "env=prod",
    env_inferred: "prod",
    env_inferred_source: "rum",
    override_key: null,
  } satisfies Environment,
};
const previous: IdentityOverride = golden.override;
const overrideRow: IdentityOverride = { ...previous, affected: { services: 1, versions: 2 } };
const identity: Environment = {
  where_key: previous.where_key,
  where: { kind: "k8s", k8s_cluster: "eu-a", k8s_namespace: "shop-cloud-prod" },
  env: previous.inferred_value,
  env_source: previous.inferred_source,
  env_source_value: "shop-cloud-prod",
  env_inferred: previous.inferred_value,
  env_inferred_source: previous.inferred_source,
  override_key: null,
};
const overrideIdentity: Environment = {
  ...identity,
  env: previous.value,
  env_source: "override",
  env_source_value: previous.rule_key,
  override_key: previous.rule_key,
};
const created: IdentityOverride = { ...previous, value: "staging" };
// The golden run wrote one where rule; the service and cluster rules reuse its row with their own scope fields.
const serviceRule: IdentityOverride = {
  ...previous,
  rule_key: "svc-rule",
  scope: "service",
  service_name: "ingester",
  value: "eu1svc",
  affected: { services: 1, versions: 2 },
};
const clusterRule: IdentityOverride = {
  ...previous,
  rule_key: "cluster-rule",
  scope: "cluster",
  where_key: "",
  value: "eu1all",
  affected: { services: 24, versions: 41 },
};
const serviceIdentity: Environment = {
  ...overrideIdentity,
  env: serviceRule.value,
  env_source_value: serviceRule.rule_key,
  override_key: serviceRule.rule_key,
};
// The golden org has one env and equal scope counts, so scope switching needs distinct counts on the same shape.
const labels: IdentityEnvsResponse = {
  can_edit: true,
  envs: [
    { env: "demo-k8s", services: 1, wheres: 1, sources: ["cluster_name"], versions: 2 },
    { env: "prod", services: 24, wheres: 3, sources: ["namespace", "attribute"], versions: 48 },
    { env: "pentest", services: 8, wheres: 1, sources: ["namespace"], versions: 16 },
    { env: "staging", services: 12, wheres: 2, sources: ["namespace"], versions: 24 },
  ],
};
const scoped: IdentityEnvsResponse = {
  ...labels,
  scope_counts: { where: 9, service: 1, cluster: 24 },
  scope_versions: { where: 14, service: 2, cluster: 41 },
};

export const envFixtures = {
  golden,
  identity,
  overrideIdentity,
  previous,
  overrideRow,
  created,
  serviceRule,
  clusterRule,
  serviceIdentity,
  labels,
  scoped,
};
