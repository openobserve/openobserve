import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { servicesQuery, versionsQuery } from "@/services/service_versions.queries";
import type { Scope, Version } from "@/services/service_versions";
import { sameBuild } from "@/utils/serviceVersionsCopy";

export interface LastGood {
  version: string;
  image: string | null;
  ran?: number;
}
interface LastGoodScope {
  org: string;
  user: string;
  service: string;
  where: string;
  current?: { version?: string | null; image?: string | null };
}

export function lastGoodOf(
  scopes: Scope[] | undefined,
  versions: Version[] | undefined,
  scope: LastGoodScope,
): LastGood | undefined {
  const found = scopes?.find(
    (row) => row.service === scope.service && row.where_key === scope.where,
  );
  const version = found?.last_good_version;
  if (!version) return undefined;
  const image = found?.last_good_image || null;
  if (scope.current && sameBuild(scope.current, { version, image })) return undefined;
  const row = versions?.find(
    (entry) => entry.where_key === scope.where && sameBuild(entry, { version, image }),
  );
  return {
    version,
    image,
    ran: row && row.last_seen > row.first_seen ? row.last_seen - row.first_seen : undefined,
  };
}

export function useLastGood(scope: () => LastGoodScope) {
  const ready = () => {
    const value = scope();
    return Boolean(value.org && value.user && value.service && value.where);
  };
  const scopes = useQuery(
    computed(() => ({
      ...servicesQuery(scope().org, scope().user, { q: scope().service, where: scope().where }),
      enabled: ready(),
    })),
  );
  // Same key as the drawer and panel version lists, so this shares their request.
  const versions = useQuery(
    computed(() => ({
      ...versionsQuery(scope().org, scope().user, {
        service: scope().service,
        where: scope().where,
        include_inactive: true,
        limit: 10000,
      }),
      enabled: ready(),
    })),
  );
  return computed(() =>
    lastGoodOf(scopes.data.value?.services, versions.data.value?.versions, scope()),
  );
}
