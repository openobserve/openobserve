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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import { LIVE_STALE_TIME, MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
import secrets, {
  type ConsumerType,
  type CreateSecretRequest,
  type SecretPickerItem,
  type MetaStoreStatus,
  type SecretGrants,
  type SecretGrantsResponse,
  type OrgStoreStatus,
  type PolicyRequest,
  type PrescanHit,
  type SecretDetail,
  type SecretKind,
  type SecretListItem,
  type SecretPointer,
  type UsageEntry,
} from "./secrets";
import { secretKeys } from "./secrets.querykeys";
import syntheticsService from "./synthetics";

// The server clamps a page to 100 rows; each read follows `next` so a table sees the whole set.
const PAGE_LIMIT = 100;
const MAX_PAGES = 100;

const readAllPages = async <T>(
  read: (cursor?: string) => Promise<{ data?: { items?: T[]; next?: string } }>,
): Promise<T[]> => {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const data = (await read(cursor)).data;
    out.push(...(data?.items ?? []));
    cursor = data?.next;
    if (!cursor) break;
  }
  return out;
};

export const secretsListQuery = (org: string, kind: SecretKind, deleted = false) =>
  queryOptions({
    queryKey: secretKeys.list(org, kind, deleted),
    queryFn: (): Promise<SecretListItem[]> =>
      readAllPages((cursor) =>
        secrets.list(org, {
          kind,
          limit: PAGE_LIMIT,
          ...(deleted ? { deleted: true } : {}),
          ...(cursor ? { cursor } : {}),
        }),
      ),
    staleTime: MEDIUM_STALE_TIME,
  });

/** `q` is the server-side name search; `locations` replace a check's saved ones on the server. */
export const secretPickerQuery = (
  org: string,
  usableBy: ConsumerType,
  consumerId = "",
  q = "",
  locations: string[] = [],
) => {
  const loc = locations.join(",");
  return queryOptions({
    queryKey: secretKeys.picker(org, usableBy, consumerId, q, loc),
    queryFn: (): Promise<SecretPickerItem[]> =>
      readAllPages((cursor) =>
        secrets.picker(org, usableBy, consumerId || undefined, {
          ...(q ? { q } : {}),
          ...(loc ? { locations: loc } : {}),
          ...(cursor ? { cursor } : {}),
        }),
      ),
    staleTime: LIVE_STALE_TIME,
  });
};

/** Value environments are the synthetics environments; `global` is the org value itself. */
export const secretEnvironmentsQuery = (org: string) =>
  queryOptions({
    queryKey: secretKeys.environments(org),
    queryFn: async (): Promise<string[]> => {
      const rows = ((await syntheticsService.listEnvironments(org)).data ?? []) as {
        name: string;
        is_global?: boolean;
      }[];
      return rows.filter((e) => !e.is_global).map((e) => e.name);
    },
    staleTime: MEDIUM_STALE_TIME,
  });

export const secretStoreStatusQuery = (org: string) =>
  queryOptions({
    queryKey: secretKeys.status(org),
    queryFn: async (): Promise<OrgStoreStatus> => (await secrets.status(org)).data,
    staleTime: MEDIUM_STALE_TIME,
  });

export const secretPrescanQuery = (org: string) =>
  queryOptions({
    queryKey: secretKeys.prescan(org),
    queryFn: async (): Promise<PrescanHit[]> => (await secrets.prescan(org)).data?.items ?? [],
    staleTime: MEDIUM_STALE_TIME,
    retry: false,
  });

export const secretDetailQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: secretKeys.detail(org, id),
    queryFn: async (): Promise<SecretDetail> => (await secrets.get(org, id)).data,
    staleTime: LIVE_STALE_TIME,
  });

export const secretUsageQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: secretKeys.usage(org, id),
    queryFn: (): Promise<UsageEntry[]> => readAllPages((cursor) => secrets.usage(org, id, cursor)),
    staleTime: LIVE_STALE_TIME,
  });

const writes = (org: string) => ({ invalidates: [secretKeys.all(org)], silentError: true });

export const createSecretMutation = (org: string) =>
  mutationOptions({
    mutationFn: (body: CreateSecretRequest) => secrets.create(org, body),
    gcTime: 0,
    meta: writes(org),
  });

export const putSecretValueMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: ({
      env,
      value,
      source,
    }: {
      env: string;
      value?: string;
      source?: SecretPointer;
    }) =>
      source
        ? secrets.putSource(org, id, env, source)
        : secrets.putValue(org, id, env, value ?? ""),
    // Written values must not outlive the request in the mutation cache.
    gcTime: 0,
    meta: writes(org),
  });

export const inheritSecretValueMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: (env: string) => secrets.inheritValue(org, id, env),
    meta: writes(org),
  });

export const putSecretPolicyMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: (body: PolicyRequest) => secrets.putPolicy(org, id, body),
    meta: writes(org),
  });

export const deleteSecretMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({ id, force }: { id: string; force: boolean }) => secrets.remove(org, id, force),
    meta: writes(org),
  });

export const restoreSecretMutation = (org: string) =>
  mutationOptions({
    mutationFn: (id: string) => secrets.restore(org, id),
    meta: writes(org),
  });

export const purgeSecretMutation = (org: string) =>
  mutationOptions({
    mutationFn: (id: string) => secrets.purge(org, id),
    meta: { ...writes(org), removes: [secretKeys.all(org)] },
  });

export const renameSecretMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({ id, newName }: { id: string; newName: string }) =>
      secrets.rename(org, id, newName),
    meta: writes(org),
  });

/** A dry run writes nothing, so it invalidates nothing. */
export const dryRunSecretPolicyMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: (body: PolicyRequest) => secrets.putPolicy(org, id, body, true),
    meta: { silentError: true },
  });

export const secretGrantsQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: secretKeys.grants(org, id),
    queryFn: async (): Promise<SecretGrantsResponse> => (await secrets.getGrants(org, id)).data,
    staleTime: LIVE_STALE_TIME,
    // 409 fga_disabled and 403 are states the tab renders, not transient failures.
    retry: false,
  });

export const secretCreateGrantsQuery = (org: string) =>
  queryOptions({
    queryKey: secretKeys.createGrants(org),
    queryFn: async (): Promise<string[]> => (await secrets.getCreateGrants(org)).data?.create ?? [],
    staleTime: LIVE_STALE_TIME,
    retry: false,
  });

export const secretMetaStatusQuery = () =>
  queryOptions({
    queryKey: secretKeys.metaStatus(),
    queryFn: async (): Promise<MetaStoreStatus> => (await secrets.metaStatus()).data,
    staleTime: LIVE_STALE_TIME,
  });

export const putSecretGrantsMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: (grants: SecretGrants) => secrets.putGrants(org, id, grants),
    meta: writes(org),
  });

export const putCreateGrantsMutation = (org: string) =>
  mutationOptions({
    mutationFn: (create: string[]) => secrets.putCreateGrants(org, create),
    meta: writes(org),
  });
