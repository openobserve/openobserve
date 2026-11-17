import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import { isAxiosError } from "axios";
import service, {
  type AliasCreate,
  type AliasListParams,
  type AliasUpdate,
  type BulkAliasRequest,
  type CompareRequest,
  type ListParams,
  type OverrideWrite,
  type ServicesParams,
} from "./service_versions";
import { serviceVersionKeys } from "./service_versions.querykeys";
import { serviceStreamKeys } from "./service_streams.querykeys";
import { MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
const retry = (count: number, error: unknown) =>
  !isAxiosError(error)
    ? count < 1
    : error.response?.status !== 403 && error.response?.status !== 404 && count < 1;
export const versionsQuery = (org: string, user: string, params: ListParams) =>
  queryOptions({
    queryKey: serviceVersionKeys.list(org, user, "versions", params),
    queryFn: async ({ signal }) => {
      const first = (await service.versions(org, params, signal)).data;
      if (params.limit !== 10000) return first;
      const versions = [...first.versions];
      const keys = new Set(versions.map((row) => row.version_key));
      while (versions.length < first.total) {
        const page = (await service.versions(org, { ...params, offset: versions.length }, signal))
          .data;
        if (!page.versions.length) throw new Error("Incomplete version history");
        for (const row of page.versions) {
          if (keys.has(row.version_key))
            throw new Error("Version history changed while paging; retry");
          keys.add(row.version_key);
          versions.push(row);
        }
      }
      return { ...first, versions };
    },
    staleTime: MEDIUM_STALE_TIME,
    retry,
  });
type IdentityKind = "identityOverrides" | "identityEnvs" | "identityUnresolved";
type IdentityData<K extends IdentityKind> = Awaited<ReturnType<(typeof service)[K]>>["data"];
export const identityQuery = <K extends IdentityKind>(
  org: string,
  user: string,
  kind: K,
  params: ListParams = {},
) =>
  queryOptions({
    queryKey: serviceVersionKeys.list(org, user, kind, params),
    queryFn: async ({ signal }) =>
      (await service[kind](org, params, signal)).data as IdentityData<K>,
    staleTime: MEDIUM_STALE_TIME,
    retry,
  });
export const servicesQuery = (org: string, user: string, params: ServicesParams = {}) =>
  queryOptions({
    queryKey: serviceVersionKeys.list(org, user, "services", params),
    queryFn: async ({ signal }) => {
      const limit = Number(params.limit ?? 100);
      const first = (await service.services(org, { ...params, limit }, signal)).data;
      if (params.limit || params.offset) return first;
      const services = [...first.services];
      const verdict_counts = { ...first.verdict_counts };
      let unavailable = first.verdict_status === "unavailable";
      const identities = new Set(services.map((row) => row.scope_key));
      for (let offset = limit; services.length && services.length % limit === 0; offset += limit) {
        const page = (await service.services(org, { ...params, limit, offset }, signal)).data;
        for (const row of page.services) {
          if (identities.has(row.scope_key)) throw new Error("Catalog changed while paging; retry");
          identities.add(row.scope_key);
          services.push(row);
        }
        for (const [key, count] of Object.entries(page.verdict_counts || {})) {
          const verdict = key as keyof typeof verdict_counts;
          verdict_counts[verdict] = (verdict_counts[verdict] || 0) + (count || 0);
        }
        unavailable ||= page.verdict_status === "unavailable";
        if (page.services.length < limit) break;
      }
      if (unavailable) services.forEach((row) => delete row.newest_verdict);
      return {
        ...first,
        services,
        verdict_counts: unavailable ? undefined : verdict_counts,
        verdict_status: unavailable ? ("unavailable" as const) : first.verdict_status,
      };
    },
    staleTime: MEDIUM_STALE_TIME,
    retry,
  });
export const aliasesQuery = (org: string, user: string, params: AliasListParams = {}) =>
  queryOptions({
    queryKey: serviceVersionKeys.list(org, user, "aliases", params),
    queryFn: async ({ signal }) => (await service.aliases(org, params, signal)).data,
    staleTime: MEDIUM_STALE_TIME,
    retry,
  });
/** The compare body every surface sends, so a panel card and its drawer share one cached result. */
export function compareRequest(input: {
  service: string;
  where: string;
  version: string;
  image?: string;
  deployKey?: string;
  baselineVersion?: string;
  baselineImage?: string;
  baseline?: "auto" | "canary" | "previous";
  maxSpanSecs?: number;
}): CompareRequest {
  return {
    service: input.service,
    where: input.where,
    a: {
      version: input.version,
      ...(input.image ? { image: input.image } : {}),
      ...(input.deployKey ? { deploy_key: input.deployKey } : {}),
    },
    ...(input.baselineVersion
      ? {
          b: {
            version: input.baselineVersion,
            ...(input.baselineImage ? { image: input.baselineImage } : {}),
          },
        }
      : {}),
    baseline: input.baseline ?? "auto",
    signals: ["traces", "rum"],
    max_span_secs: input.maxSpanSecs ?? 86400,
  };
}
export const compareQuery = (org: string, user: string, body: CompareRequest) =>
  queryOptions({
    queryKey: serviceVersionKeys.compare(org, user, body),
    queryFn: async ({ signal }) => (await service.compare(org, body, signal)).data,
    staleTime: MEDIUM_STALE_TIME,
    retry,
  });
export const verdictsQuery = (org: string, user: string, keys: string[]) =>
  queryOptions({
    queryKey: [...serviceVersionKeys.reader(org, user), "verdicts", keys],
    queryFn: async ({ signal }) => {
      const verdicts = [];
      for (let offset = 0; offset < keys.length; offset += 100)
        verdicts.push(
          ...(
            await service.verdicts(
              org,
              { keys: keys.slice(offset, offset + 100).join(",") },
              signal,
            )
          ).data.verdicts,
        );
      return { verdicts };
    },
    staleTime: MEDIUM_STALE_TIME,
    retry,
  });
/** The stored verdict of one deploy transition; a version deployed twice has one per deploy. */
export const deployVerdictQuery = (org: string, user: string, deployKey: string) =>
  queryOptions({
    queryKey: [...serviceVersionKeys.reader(org, user), "verdicts", "deploy", deployKey],
    queryFn: async ({ signal }) =>
      (await service.verdicts(org, { deploy_key: deployKey }, signal)).data,
    staleTime: MEDIUM_STALE_TIME,
    retry,
  });
export const deploysQuery = (org: string, user: string, params: ListParams) =>
  queryOptions({
    queryKey: serviceVersionKeys.list(org, user, "deploys", params),
    queryFn: async ({ signal }) => (await service.deploys(org, params, signal)).data,
    staleTime: MEDIUM_STALE_TIME,
    retry,
  });
// Callers render write failures themselves (read-only latch on 403, mapped copy), so the shared toast stays off.
export const putOverrideMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: OverrideWrite) => (await service.putIdentityOverride(org, body)).data,
    retry: false,
    meta: { invalidates: [serviceVersionKeys.all(org)], silentError: true },
  });
export const deleteOverrideMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (ruleKey: string) =>
      (await service.deleteIdentityOverride(org, ruleKey)).data,
    retry: false,
    meta: { invalidates: [serviceVersionKeys.all(org)], silentError: true },
  });
// An alias write changes the display fields of every list that renders service names.
const aliasMeta = (org: string) => ({
  invalidates: [serviceVersionKeys.all(org), serviceStreamKeys.servicesList(org)],
  silentError: true,
});
export const createAliasMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: AliasCreate) => (await service.createAlias(org, body)).data,
    retry: false,
    meta: aliasMeta(org),
  });
export const updateAliasMutation = (org: string) =>
  mutationOptions({
    mutationFn: async ({ aliasKey, body }: { aliasKey: string; body: AliasUpdate }) =>
      (await service.updateAlias(org, aliasKey, body)).data,
    retry: false,
    meta: aliasMeta(org),
  });
export const deleteAliasMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (aliasKey: string) => (await service.deleteAlias(org, aliasKey)).data,
    retry: false,
    meta: aliasMeta(org),
  });
export const bulkAliasesMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: BulkAliasRequest) => (await service.bulkAliases(org, body)).data,
    retry: false,
    meta: aliasMeta(org),
  });
export const undoAliasesMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (batchId: string) => (await service.undoAliases(org, batchId)).data,
    retry: false,
    meta: aliasMeta(org),
  });
