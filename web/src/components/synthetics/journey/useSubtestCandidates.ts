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

import { computed, toValue, watch, type MaybeRefOrGetter } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { formatDistanceToNowStrict } from "date-fns";
import { useI18nTyped } from "@/types/i18n";
import type { SubtestRef } from "@/types/synthetics";
import syntheticsService from "@/services/synthetics";
import { syntheticsMonitorsQuery } from "@/services/synthetics.queries";
import { useOrgId } from "@/composables/query/useOrgId";
import { resolveBadgeLabel } from "@/lib/core/Badge/badgeGroups";
import { syntheticsFolderName } from "@/utils/synthetics/routes";

/** One browser test that could be referenced as a subtest, with its row labels already resolved. */
export interface SubtestCandidate {
  id: string;
  name: string;
  folderName: string;
  /** "N steps", or "" when the list does not report a count. */
  stepsLabel: string;
  /** "Used by N tests", or "" when nothing references it. */
  usedByLabel: string;
  /** "Paused", or "" while the test is enabled. */
  pausedLabel: string;
  /** "<status> <ago>", or "" before its first completed run. */
  lastRunLabel: string;
}

interface ListRow {
  id: string;
  name: string;
  type: string;
  folder_id?: string;
  steps?: number | null;
  referenced_by?: number;
  references?: number | null;
  enabled?: boolean;
  status?: string;
  last_check_at?: number | null;
}

/** Joins a candidate's non-empty labels with " · ". */
export function candidateSummary(parts: string[]): string {
  return parts.filter(Boolean).join(" · ");
}

/** GETs a picked test and throws when it cannot be loaded, so no caller stores a reference it cannot expand. */
export async function loadPickedSubtest(
  org: string,
  id: string,
  fallbackName = "",
): Promise<{ reference: SubtestRef; stepCount: number }> {
  const check = (await syntheticsService.get(org, id)).data;
  return {
    reference: { id, name: check.name ?? fallbackName },
    stepCount: check.config?.steps?.length ?? 0,
  };
}

/** The org's browser tests a journey can reference, split into usable and nested-holding. */
export function useSubtestCandidates(
  ownCheckId: () => string | undefined,
  options: { enabled: MaybeRefOrGetter<boolean>; onError?: (err: unknown) => void },
) {
  const { t } = useI18nTyped();
  const store = useStore();
  const org = useOrgId();
  const enabled = computed(() => !!org.value && toValue(options.enabled));

  // undefined folder omits ?folder= so every folder is listed: references are cross-folder by design.
  const list = useQuery(() =>
    Object.assign(syntheticsMonitorsQuery(org.value), { enabled: enabled.value }),
  );

  /** Everything on a row comes from the list response — nothing costs a request per option. */
  function toCandidate(r: ListRow): SubtestCandidate {
    const folders = store.state.organizationData?.foldersByType?.synthetics ?? [];
    const usedByCount = r.referenced_by ?? 0;
    return {
      id: r.id,
      name: r.name,
      folderName: syntheticsFolderName(folders, r.folder_id),
      stepsLabel:
        r.steps != null
          ? t("synthetics.journey.subtest.pickSteps", { count: r.steps }, r.steps)
          : "",
      usedByLabel:
        usedByCount > 0
          ? t("synthetics.journey.subtest.pickUsedBy", { count: usedByCount }, usedByCount)
          : "",
      pausedLabel: r.enabled === false ? resolveBadgeLabel("alertStatus", "paused") : "",
      lastRunLabel:
        r.last_check_at && r.status !== "unknown"
          ? t("synthetics.journey.subtest.pickLastRun", {
              status: resolveBadgeLabel("serviceStatus", r.status),
              ago: formatDistanceToNowStrict(new Date(r.last_check_at / 1000), {
                addSuffix: true,
              }),
            })
          : "",
    };
  }

  const rows = computed(() =>
    ((list.data.value ?? []) as ListRow[]).filter(
      (r) => r.type === "browser" && r.id !== ownCheckId(),
    ),
  );
  // Nesting is one level deep, so a check that already holds a reference is shown but not pickable.
  const holdsSubtest = (r: ListRow) => (r.references ?? 0) > 0;
  const usable = computed(() => rows.value.filter((r) => !holdsSubtest(r)).map(toCandidate));
  /** Tests that already hold a subtest: listed so the author sees why, never pickable. */
  const blocked = computed(() => rows.value.filter(holdsSubtest).map(toCandidate));
  const hasData = computed(() => list.data.value !== undefined);
  // A failed background refetch keeps the cached rows on screen instead of an error.
  const loadError = computed(() => list.isError.value && !list.isFetching.value && !hasData.value);
  const isLoading = computed(() => enabled.value && !hasData.value && !loadError.value);
  /** True only once the list has loaded and holds no other browser test. */
  const isEmpty = computed(() => hasData.value && rows.value.length === 0);

  watch(list.error, (err) => {
    if (err) options.onError?.(err);
  });

  /** Always reaches the server: it backs Retry. */
  const refetch = () => list.refetch();

  return { org, usable, blocked, isLoading, isEmpty, loadError, refetch };
}
