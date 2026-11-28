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

import http from "./http";

export type SecretKind = "secret" | "variable";
export type SecretState = "active" | "deleted" | "purged" | "conflict";
export type ValueState = "set" | "unset" | "inherit" | "deleted";
export type ConsumerType =
  "alert_destination" | "pipeline_destination" | "synthetics_check" | "ai_toolset";
export type PinMode = "none" | "hosts" | "any" | "legacy";
export type PrivateLocations = "off" | "on" | "legacy";
/** `mixed`: environments disagree on where the value lives. */
export type SecretSource = "local" | "external" | "mixed";

/** The org-wide value; every other env is an override of it. */
export const ORG_ENV_ID = "_org";

export const CONSUMER_TYPES: readonly ConsumerType[] = [
  "alert_destination",
  "pipeline_destination",
  "synthetics_check",
  "ai_toolset",
];

export interface AllowedConsumer {
  type: ConsumerType;
  /** Absent means every consumer of the type. */
  ids?: string[];
}

export interface SecretEnvSummary {
  env: string;
  state: ValueState;
  value_version: number;
}

export interface SecretListItem {
  id: string;
  name: string;
  kind: SecretKind;
  description: string;
  state: SecretState;
  allowed_types: ConsumerType[];
  selected_count: number;
  allowed_hosts: string[];
  pin_mode: PinMode;
  pin_override_reason?: string;
  private_locations: PrivateLocations;
  private_locations_reason?: string;
  envs: SecretEnvSummary[];
  usage_count: number;
  source: SecretSource;
  /** Unix microseconds. */
  updated_at: number;
  updated_by: string;
  /** Variables only: a secret's value is never returned. */
  value?: string;
}

/** Picker row of `GET /secrets?usable_by=`: names and pin state only, never a value or host. */
export interface SecretPickerItem {
  id: string;
  name: string;
  kind: SecretKind;
  pin_mode: PinMode;
  pin_override_reason?: string;
  private_locations: PrivateLocations;
  allowed_here: boolean;
  /** Caller's rights on the secret; binding an any-host secret needs manage access (V40). */
  rights: SecretRights;
}

/** Transient consumer-save option (§3.6.1); never stored on the consumer. */
export interface SecretBind {
  secret_id: string;
  allow_this_consumer: boolean;
  pin: "keep" | string[];
  expected_policy_rev: string;
}

/** What a person gets back from a test of a saved consumer (§3.6.5). */
export interface StatusOnlyOutcome {
  ok: boolean;
  status?: number;
  class?: string;
}

export interface SecretListPage {
  items: SecretListItem[];
  next?: string;
}

export interface SecretEnvDetail extends SecretEnvSummary {
  /** Unix microseconds. */
  updated_at: number;
  updated_by: string;
}

export interface SecretDetail {
  id: string;
  name: string;
  description: string;
  kind: SecretKind;
  state: SecretState;
  envs: SecretEnvDetail[];
  allowed_consumers: AllowedConsumer[];
  allowed_hosts: string[];
  pin_mode: PinMode;
  pin_override_reason?: string;
  private_locations: PrivateLocations;
  private_locations_reason?: string;
  policy_rev: string;
  usage_count: number;
  /** The caller's own rights; the UI hides what the server would refuse. */
  rights: SecretRights;
  value?: string;
}

export interface SecretRights {
  see: boolean;
  use: boolean;
  manage: boolean;
  manage_access: boolean;
}

/** `VersionSelector`: externally tagged, so a stage or id is a one-key object. */
export type SecretVersionSelector = "latest" | { stage: string } | { id: string };

/** An external value: where the backend keeps it (`external::Pointer`, deny_unknown_fields). */
export interface SecretPointer {
  backend_id: string;
  locator: string;
  version_selector: SecretVersionSelector;
  json_key?: string;
}

export interface CreateSecretRequest {
  name: string;
  kind: SecretKind;
  description?: string;
  value?: string;
  /** Exclusive with `value`; `kind=secret` only. */
  source?: SecretPointer;
  allowed_consumers: AllowedConsumer[];
  allowed_hosts?: string[];
  grants?: { use: string[]; manage: string[] };
}

export interface PolicyRequest {
  allowed_consumers: AllowedConsumer[];
  allowed_hosts: string[];
  pin_mode?: "hosts" | "any";
  pin_override_reason?: string;
  private_locations?: "on" | "off";
  private_locations_reason?: string;
  expected_policy_rev: string;
}

export interface NowFailing {
  consumer_type: ConsumerType;
  consumer_id: string;
  consumer_name: string;
  code: string;
}

export interface PolicyResponse {
  policy_rev?: string;
  policy_version?: number;
  now_failing: NowFailing[];
  effective?: boolean | string;
}

export interface UsageHop {
  consumer_type: ConsumerType;
  consumer_id: string;
  consumer_name: string;
}

export interface UsageEntry {
  path: UsageHop[];
  field: string;
  status: string;
  token_name: string;
}

export interface UsagePage {
  items: UsageEntry[];
  next?: string;
}

export interface PrescanHit {
  consumer_type: ConsumerType;
  consumer_id: string;
  field: string;
  token: string;
}

/** Tenant view of `GET /secrets/status`; `region` is empty in a single cluster. */
export interface OrgStoreStatus {
  mode: "single_cluster" | "super_cluster";
  region: string;
  store_ready: boolean;
  not_ready_reason: string;
  fga: "on" | "off";
  /** Whether the caller may create; absent on an older server, which decides on save. */
  can_create?: boolean;
}

export type GrantRight = "see" | "use" | "manage" | "manage_access";
export const GRANT_RIGHTS: readonly GrantRight[] = ["see", "use", "manage", "manage_access"];

/** Role names per right on one secret; `use` is the wire name of the use list. */
export type SecretGrants = Record<GrantRight, string[]> & {
  expected_grants_rev?: string;
};

export interface SecretGrantsResponse extends SecretGrants {
  grants_rev: string;
  /** What FGA did not apply after an ambiguous error (R14-14). */
  unapplied?: SecretGrants;
}

export interface NodeStoreStatus {
  node: string;
  level: number;
  refs_enabled: boolean;
  fga_mode: string;
}

/** Root view of `GET /api/_meta/secrets/status`. */
export interface MetaStoreStatus {
  gate: "closed" | "writable" | "latched";
  nodes: NodeStoreStatus[];
  unprefixed_cipher_rows: number;
  aesenc_system_rows: number;
  wrap_floor: string;
}

export interface SecretErrorBody {
  code: string;
  message: string;
}

export interface ListSecretsParams {
  kind?: SecretKind;
  q?: string;
  cursor?: string;
  limit?: number;
  /** `true` lists only deleted (restorable) rows. */
  deleted?: boolean;
}

const base = (org: string) => `/api/${encodeURIComponent(org)}/secrets`;
const one = (org: string, id: string) => `${base(org)}/${encodeURIComponent(id)}`;

const secrets = {
  list: (org: string, params: ListSecretsParams = {}) =>
    http().get<SecretListPage>(base(org), { params }),
  picker: (
    org: string,
    usableBy: ConsumerType,
    consumerId?: string,
    page: { q?: string; cursor?: string; locations?: string } = {},
  ) =>
    http().get<{ items: SecretPickerItem[]; next?: string }>(base(org), {
      params: {
        usable_by: usableBy,
        ...(consumerId ? { consumer_id: consumerId } : {}),
        ...page,
      },
    }),
  status: (org: string) => http().get<OrgStoreStatus>(`${base(org)}/status`),
  // Only org admins may read prescan rows; for anyone else the banner is simply absent.
  prescan: (org: string) =>
    http().get<{ items: PrescanHit[] }>(`${base(org)}/prescan`, { silentForbidden: true }),
  get: (org: string, id: string) => http().get<SecretDetail>(one(org, id)),
  create: (org: string, body: CreateSecretRequest) =>
    http().post<{ id: string }>(base(org), body, { silentForbidden: true }),
  describe: (org: string, id: string, description: string) =>
    http().put(one(org, id), { description }),
  putValue: (org: string, id: string, env: string, value: string) =>
    http().put(`${one(org, id)}/values/${encodeURIComponent(env)}`, { value }),
  putSource: (org: string, id: string, env: string, source: SecretPointer) =>
    http().put(`${one(org, id)}/values/${encodeURIComponent(env)}`, { source }),
  unsetValue: (org: string, id: string, env: string) =>
    http().put(`${one(org, id)}/values/${encodeURIComponent(env)}`, { unset: true }),
  /** Drops an environment override so the env falls back to the org value. */
  inheritValue: (org: string, id: string, env: string) =>
    http().delete(`${one(org, id)}/values/${encodeURIComponent(env)}`),
  putPolicy: (org: string, id: string, body: PolicyRequest, dryRun = false) =>
    http().put<PolicyResponse>(`${one(org, id)}/policy`, body, {
      params: dryRun ? { dry_run: true } : {},
    }),
  usage: (org: string, id: string, cursor?: string) =>
    http().get<UsagePage>(`${one(org, id)}/usage`, { params: cursor ? { cursor } : {} }),
  remove: (org: string, id: string, force = false) =>
    http().delete(one(org, id), { params: force ? { force: true } : {} }),
  restore: (org: string, id: string) => http().post(`${one(org, id)}/restore`, {}),
  purge: (org: string, id: string) => http().post(`${one(org, id)}/purge`, {}),
  getGrants: (org: string, id: string) =>
    http().get<SecretGrantsResponse>(`${one(org, id)}/grants`, { silentForbidden: true }),
  putGrants: (org: string, id: string, grants: SecretGrants) =>
    http().put<SecretGrantsResponse>(`${one(org, id)}/grants`, grants),
  getCreateGrants: (org: string) =>
    http().get<{ create: string[] }>(`${base(org)}/_all/grants`, { silentForbidden: true }),
  putCreateGrants: (org: string, create: string[]) =>
    http().put<{ create: string[] }>(`${base(org)}/_all/grants`, { create }),
  metaStatus: () => http().get<MetaStoreStatus>(`/api/_meta/secrets/status`),
  /** Status-only test of a saved alert destination (§3.6.5); a draft with a ref is never sent. */
  testSavedDestination: (org: string, name: string, templateName?: string) =>
    http().post<StatusOnlyOutcome>(
      `/api/${encodeURIComponent(org)}/alerts/destinations/${encodeURIComponent(name)}/test_send`,
      templateName ? { template_name: templateName } : {},
    ),
  rename: (org: string, id: string, newName: string) =>
    http().put(`${one(org, id)}/rename`, { new_name: newName }),
};

/** The store error code of a failed call, when the server sent one. */
export const secretErrorCode = (error: unknown): string | undefined =>
  (error as { response?: { data?: Partial<SecretErrorBody> } })?.response?.data?.code;

/** What is safe to log from a failed write: an axios error's config holds the typed body. */
export const loggableError = (error: unknown): Record<string, string | number> => {
  const e = error as {
    response?: { status?: number; data?: { code?: unknown } };
    config?: { headers?: Record<string, unknown> };
  } | null;
  const out: Record<string, string | number> = {};
  if (typeof e?.response?.status === "number") out.status = e.response.status;
  if (typeof e?.response?.data?.code === "string") out.code = e.response.data.code;
  const trace = e?.config?.headers?.traceparent;
  if (typeof trace === "string") out.traceparent = trace;
  if (!e?.response && error instanceof Error) out.message = error.message;
  return out;
};

export default secrets;
