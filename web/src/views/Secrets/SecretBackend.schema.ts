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

import { z } from "zod";
import type { TranslateFn } from "@/types/i18n";
import type {
  AwsPartition,
  AzureCloud,
  BackendKind,
  CreateBackendRequest,
  SecretBackend,
  UpdateBackendRequest,
} from "@/services/secretBackends";

export const BACKEND_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const AWS_REGION = /^[a-z]{2}(-gov|-iso[a-z]*)?-[a-z]+-\d+$/;
const AWS_ACCOUNT = /^\d{12}$/;
const AWS_ACCESS_KEY_ID = /^[A-Za-z0-9]+$/;
// Azure tenant: a GUID or a domain name (design §6 P1-E static credential).
const AZURE_TENANT =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|([a-z0-9-]+\.)+[a-z]{2,})$/i;
const VAULT_HOST: Record<AzureCloud, string> = {
  public: ".vault.azure.net",
  us_gov: ".vault.usgovcloudapi.net",
  china: ".vault.azure.cn",
};

export const AZURE_CLOUDS: readonly AzureCloud[] = ["public", "us_gov", "china"];
export const AWS_PARTITIONS: readonly AwsPartition[] = ["aws", "aws-cn"];

export const makeBackendSchema = (t: TranslateFn, kind: BackendKind, credentialSet: boolean) =>
  z
    .object({
      name: z.string().trim().regex(BACKEND_NAME_PATTERN, t("secrets.backends.form.nameInvalid")),
      path_prefixes: z.array(z.string().trim().min(1)),
      partition: z.enum(["aws", "aws-cn"]),
      region: z.string().trim(),
      account: z.string().trim(),
      access_key_id: z.string().trim(),
      project_id: z.string().trim(),
      tenant_id: z.string().trim(),
      cloud: z.enum(["public", "us_gov", "china"]),
      client_id: z.string().trim(),
      vault_url: z.string().trim(),
      credential: z.string(),
    })
    .superRefine((v, ctx) => {
      const need = (path: keyof typeof v, ok: boolean, key: Parameters<TranslateFn>[0]) => {
        if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: t(key) });
      };
      // A new backend needs its credential; a saved one keeps it until replaced (V37).
      need(
        "credential",
        credentialSet || !!v.credential,
        "secrets.backends.form.credentialRequired",
      );
      need("path_prefixes", v.path_prefixes.length > 0, "secrets.backends.form.prefixRequired");
      if (kind === "aws_sm") {
        need("region", AWS_REGION.test(v.region), "secrets.backends.form.regionInvalid");
        need("account", AWS_ACCOUNT.test(v.account), "secrets.backends.form.accountInvalid");
        // The key pair is one credential, so a new secret key needs its key ID too.
        if (v.credential) {
          need(
            "access_key_id",
            AWS_ACCESS_KEY_ID.test(v.access_key_id),
            "secrets.backends.form.required",
          );
        }
      }
      if (kind === "gcp_sm") need("project_id", !!v.project_id, "secrets.backends.form.required");
      if (kind === "azure_kv") {
        need("tenant_id", AZURE_TENANT.test(v.tenant_id), "secrets.backends.form.tenantInvalid");
        need("client_id", !!v.client_id, "secrets.backends.form.required");
        need(
          "vault_url",
          vaultMatchesCloud(v.vault_url, v.cloud),
          "secrets.backends.form.vaultCloudMismatch",
        );
      }
    });

export type BackendForm = z.infer<ReturnType<typeof makeBackendSchema>>;

/** The vault URL must be https on the chosen cloud's vault suffix (`azure_cloud_mismatch`). */
export const vaultMatchesCloud = (url: string, cloud: AzureCloud): boolean => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(VAULT_HOST[cloud]);
  } catch {
    return false;
  }
};

const oneOf = <T extends string>(values: readonly T[], value: string | undefined, fallback: T) =>
  (values as readonly string[]).includes(value ?? "") ? (value as T) : fallback;

export const backendDefaults = (backend?: SecretBackend | null): BackendForm => {
  const c = backend?.config ?? {};
  return {
    name: backend?.name ?? "",
    path_prefixes: backend?.path_prefixes ?? [],
    partition: oneOf(AWS_PARTITIONS, c.partition, "aws"),
    region: c.region ?? "",
    account: c.account ?? "",
    access_key_id: "",
    project_id: c.project_id ?? "",
    tenant_id: c.tenant_id ?? "",
    cloud: oneOf(AZURE_CLOUDS, c.cloud, "public"),
    client_id: c.client_id ?? "",
    vault_url: c.vault_url ?? "",
    credential: "",
  };
};

const backendConfig = (kind: BackendKind, v: BackendForm): Record<string, string> =>
  kind === "aws_sm"
    ? { partition: v.partition, region: v.region, account: v.account }
    : kind === "gcp_sm"
      ? { project_id: v.project_id }
      : {
          tenant_id: v.tenant_id,
          cloud: v.cloud,
          client_id: v.client_id,
          vault_url: v.vault_url,
        };

const prefixes = (v: BackendForm) => v.path_prefixes.map((p) => p.trim()).filter(Boolean);

/** Static only until cloud identity (V15) is live; the credential goes in its own PUT. */
export const buildBackendRequest = (kind: BackendKind, v: BackendForm): CreateBackendRequest => ({
  name: v.name.trim(),
  kind,
  config: backendConfig(kind, v),
  path_prefixes: prefixes(v),
  auth_mode: "static",
});

/** Settings the form does not show (endpoint, CA bundle, tenant role) stay as saved. */
export const buildBackendUpdate = (
  kind: BackendKind,
  v: BackendForm,
  row: SecretBackend,
): UpdateBackendRequest => ({
  name: v.name.trim(),
  config: { ...row.config, ...backendConfig(kind, v) },
  path_prefixes: prefixes(v),
  expected_backend_rev: row.backend_rev,
});

/** AWS parses its credential as `AwsCredentials` JSON; GCP and Azure take the text as is. */
export const buildBackendCredential = (kind: BackendKind, v: BackendForm): string =>
  kind === "aws_sm"
    ? JSON.stringify({ access_key_id: v.access_key_id.trim(), secret_access_key: v.credential })
    : v.credential;

export type BackendStatus = "ready" | "pending";

/** A failed test deletes the readiness row, so a row is either Ready or Pending test (X5). */
export const backendStatus = (b: SecretBackend): BackendStatus => (b.ready ? "ready" : "pending");
