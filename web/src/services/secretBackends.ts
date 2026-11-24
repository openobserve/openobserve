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

// External stores (design §6 P1-E); shapes mirror `config::meta::secret_store::api`.

export type BackendKind = "aws_sm" | "gcp_sm" | "azure_kv";
export type BackendAuthMode = "static" | "mapped" | "region_issuer";
export type AzureCloud = "public" | "us_gov" | "china";
export type AwsPartition = "aws" | "aws-cn";

/** One `BackendItem` as the list route returns it; never a credential. */
export interface SecretBackend {
  id: string;
  name: string;
  kind: BackendKind;
  description: string;
  /** Provider settings: AWS `partition`, `region`, `account`; GCP `project_id`; Azure `vault_url`… */
  config: Record<string, string>;
  path_prefixes: string[];
  auth_mode: BackendAuthMode;
  cred_set: boolean;
  /** A readiness row exists at the current revisions; a failed test deletes it. */
  ready: boolean;
  secrets_count: number;
  ttl_secs: number;
  stale_max_secs: number;
  backend_rev: string;
  created_by: string;
  created_at: number;
  updated_by: string;
  updated_at: number;
}

export interface CreateBackendRequest {
  name: string;
  kind: BackendKind;
  description?: string;
  config: Record<string, string>;
  path_prefixes: string[];
  auth_mode: BackendAuthMode;
}

/** `PUT …/backends/{id}`: `deny_unknown_fields`, so no `kind`. */
export interface UpdateBackendRequest {
  name?: string;
  description?: string;
  config?: Record<string, string>;
  path_prefixes?: string[];
  auth_mode?: BackendAuthMode;
  expected_backend_rev: string;
}

/** `POST …/test {locator}`: only a result class and code, never the value (V37). */
export interface BackendTestResult {
  ok: boolean;
  class?: string;
  code?: string;
}

/** `GET …/backends/{id}/identity` (design §6 P1-E API). */
export interface BackendIdentity {
  provider: string;
  state: string;
  principal: string;
  org_tag: string;
  external_id_or_subject: string;
  incarnation: string;
  next_principal?: string | null;
  switch_ready: string[];
  last_verified_at?: number | null;
  error?: string | null;
}

const base = (org: string) => `/api/${encodeURIComponent(org)}/secrets/backends`;
const one = (org: string, id: string) => `${base(org)}/${encodeURIComponent(id)}`;

const secretBackends = {
  list: (org: string) =>
    http().get<{ items: SecretBackend[] } | SecretBackend[]>(base(org), { silentForbidden: true }),
  create: (org: string, body: CreateBackendRequest) => http().post<{ id: string }>(base(org), body),
  update: (org: string, id: string, body: UpdateBackendRequest) => http().put(one(org, id), body),
  remove: (org: string, id: string) => http().delete(one(org, id)),
  /** The server never returns the credential; AWS sends its key pair as JSON text. */
  putCredential: (org: string, id: string, value: string) =>
    http().put(`${one(org, id)}/credential`, { value }),
  test: (org: string, id: string, locator: string) =>
    http().post<BackendTestResult>(`${one(org, id)}/test`, { locator }),
  identity: (org: string, id: string) => http().get<BackendIdentity>(`${one(org, id)}/identity`),
};

export default secretBackends;
