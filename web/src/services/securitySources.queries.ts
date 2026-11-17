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
import { orgKey } from "@/composables/query/keys";
import {
  LIVE_STALE_TIME,
  NORMAL_STALE_TIME,
  SESSION_STALE_TIME,
} from "@/composables/query/cachePolicy";
import { queryClient } from "@/composables/query/queryClient";
import securitySources, {
  type SecuritySetting,
  type SourceListing,
  type SourceMatch,
  type SourceType,
} from "./securitySources";

export const securitySourceKeys = {
  list: (org: string) => orgKey(org, "security", "sources"),
  types: (org: string) => orgKey(org, "security", "sources", "types"),
  match: (org: string, fields: string[], sample: Record<string, unknown> | null) =>
    orgKey(org, "security", "sources", "match", [...fields].sort().join(","), sample ?? null),
};

/** Every stream with its verdict, health and pack, plus the org's source names and suggestions. */
export const securitySourcesQuery = (org: string) =>
  queryOptions({
    queryKey: securitySourceKeys.list(org),
    queryFn: async (): Promise<SourceListing> => (await securitySources.list(org)).data,
    staleTime: LIVE_STALE_TIME,
  });

/** The built-in source-type catalog; fixed for the life of the server build. */
export const sourceTypesQuery = (org: string) =>
  queryOptions({
    queryKey: securitySourceKeys.types(org),
    queryFn: async (): Promise<SourceType[]> => (await securitySources.types(org)).data ?? [],
    staleTime: SESSION_STALE_TIME,
  });

/** The best source type for a field list and an optional sample row. */
export const sourceMatchQuery = (
  org: string,
  fields: string[],
  sample: Record<string, unknown> | null = null,
) =>
  queryOptions({
    queryKey: securitySourceKeys.match(org, fields, sample),
    queryFn: (): Promise<SourceMatch> => securitySources.match(org, fields, sample),
    staleTime: NORMAL_STALE_TIME,
  });

/** For code outside a component: the cached match, fetched once per field list. */
export const fetchSourceMatch = (
  org: string,
  fields: string[],
  sample: Record<string, unknown> | null = null,
): Promise<SourceMatch> => queryClient.fetchQuery(sourceMatchQuery(org, fields, sample));

/** For code outside a component: the cached source list. */
export const fetchSecuritySources = (org: string): Promise<SourceListing> =>
  queryClient.fetchQuery(securitySourcesQuery(org));

/** For code outside a component: the cached catalog. */
export const fetchSourceTypes = (org: string): Promise<SourceType[]> =>
  queryClient.fetchQuery(sourceTypesQuery(org));

/** Classifies on the server and stores verdicts; only a triager runs it. */
export const classifySourcesMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (streams: string[] = []) =>
      (await securitySources.classify(org, streams)).data,
    meta: { invalidates: [securitySourceKeys.list(org)], silentError: true },
  });

/** The listing with one stream's row moved to the setting an attach just stored, as the server would list it. */
export function withAttachedSetting(
  listing: SourceListing | undefined,
  stream: string,
  setting: SecuritySetting,
): SourceListing | undefined {
  if (!listing) return listing;
  const pack = { id: setting.pack_id, version: setting.pack_version };
  return {
    ...listing,
    sources: listing.sources.includes(stream) ? listing.sources : [...listing.sources, stream],
    streams: listing.streams.map((row) =>
      row.name !== stream
        ? row
        : {
            ...row,
            state: "mapped" as const,
            setting,
            source_type: setting.source_type || row.source_type,
            detach_pack: {
              ...pack,
              label: row.offered_pack?.id === pack.id ? row.offered_pack.label : "",
            },
            update_available: null,
          },
    ),
  };
}

/** The page shows the server's refusal itself, so the default error toast stays quiet. */
export const attachPackMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: { stream: string; packId?: string; packVersion?: number }) =>
      (
        await securitySources.attach(org, vars.stream, {
          pack_id: vars.packId,
          pack_version: vars.packVersion,
        })
      ).data,
    // The row reads mapped at once; the listing refetch that follows confirms it.
    onSuccess: (res, vars) => {
      if (!res?.setting) return;
      queryClient.setQueryData<SourceListing>(securitySourceKeys.list(org), (old) =>
        withAttachedSetting(old, vars.stream, res.setting),
      );
    },
    meta: { invalidates: [securitySourceKeys.list(org)], silentError: true },
  });

/** A dry run: the server runs every attach check and returns the plan, writing nothing. */
export const attachPlanMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (stream: string) =>
      (await securitySources.attach(org, stream, { dry_run: true })).data,
    meta: { silentError: true },
  });

export const detachPackMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (stream: string) => (await securitySources.detach(org, stream)).data,
    meta: { invalidates: [securitySourceKeys.list(org)], silentError: true },
  });

/** A manual source type; the page shows a refusal itself. */
export const setSourceTypeMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: { stream: string; sourceType: string }) =>
      (await securitySources.setSourceType(org, vars.stream, vars.sourceType)).data,
    meta: { invalidates: [securitySourceKeys.list(org)], silentError: true },
  });
