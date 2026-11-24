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
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import secretBackends, {
  type CreateBackendRequest,
  type SecretBackend,
  type UpdateBackendRequest,
} from "./secretBackends";
import { secretKeys } from "./secrets.querykeys";

const writes = (org: string) => ({
  invalidates: [secretKeys.backends(org)],
  silentError: true,
});

export const secretBackendsQuery = (org: string) =>
  queryOptions({
    queryKey: secretKeys.backends(org),
    queryFn: async (): Promise<SecretBackend[]> => {
      const data = (await secretBackends.list(org)).data;
      return Array.isArray(data) ? data : (data?.items ?? []);
    },
    staleTime: LIVE_STALE_TIME,
  });

export const backendIdentityQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: secretKeys.backendIdentity(org, id),
    queryFn: async () => (await secretBackends.identity(org, id)).data,
    staleTime: LIVE_STALE_TIME,
  });

export const createBackendMutation = (org: string) =>
  mutationOptions({
    mutationFn: (body: CreateBackendRequest) => secretBackends.create(org, body),
    meta: writes(org),
  });

export const updateBackendMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({ id, body }: { id: string; body: UpdateBackendRequest }) =>
      secretBackends.update(org, id, body),
    meta: writes(org),
  });

export const putBackendCredentialMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      secretBackends.putCredential(org, id, value),
    gcTime: 0,
    meta: writes(org),
  });

export const testBackendMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({ id, locator }: { id: string; locator: string }) =>
      secretBackends.test(org, id, locator),
    meta: writes(org),
  });
