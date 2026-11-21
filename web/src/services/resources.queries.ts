import { queryOptions } from "@tanstack/vue-query";
import { orgKey } from "@/composables/query/keys";
import type { ResourceSearchParams } from "@/ts/interfaces/resources";
import resources from "./resources";

export const resourceKeys = {
  scope: (org: string, subject: string, scope: number) =>
    orgKey(org, "resource-search", subject, scope),
};
export const resourcesQuery = (
  org: string,
  subject: string,
  params: ResourceSearchParams,
  scope: number,
) =>
  queryOptions({
    queryKey: [...resourceKeys.scope(org, subject, scope), params],
    queryFn: ({ signal }) => resources.search(org, params, signal),
    staleTime: 0,
    retry: false,
  });
