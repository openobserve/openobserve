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

import { computed, ref } from "vue";
import { useStore } from "vuex";
import { formatDistanceToNowStrict } from "date-fns";
import { useI18nTyped } from "@/types/i18n";
import syntheticsService from "@/services/synthetics";
import { resolveBadgeLabel } from "@/lib/core/Badge/badgeGroups";
import { syntheticsFolderName } from "@/utils/synthetics/routes";

/** One browser test that could be referenced as a subtest, with its row labels already resolved. */
export interface SubtestCandidate {
  id: string;
  name: string;
  folderName: string;
  enabled: boolean;
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

/** The org's browser tests a journey can reference, split into usable and nested-holding. */
export function useSubtestCandidates(
  ownCheckId: () => string | undefined,
  options: { immediate?: boolean; onError?: (err: unknown) => void } = {},
) {
  const { t } = useI18nTyped();
  const store = useStore();
  const org = computed(() => store.state.selectedOrganization.identifier as string);

  const usable = ref<SubtestCandidate[]>([]);
  /** Tests that already hold a subtest: listed so the author sees why, never pickable. */
  const blocked = ref<SubtestCandidate[]>([]);
  const isLoading = ref(!!options.immediate);
  /** True only once the list has loaded and holds no other browser test. */
  const isEmpty = ref(false);
  const loadError = ref(false);
  let pending: Promise<boolean> | null = null;

  /** Everything on a row comes from the list response — nothing costs a request per option. */
  function toCandidate(r: ListRow): SubtestCandidate {
    const folders = store.state.organizationData?.foldersByType?.synthetics ?? [];
    const usedByCount = r.referenced_by ?? 0;
    return {
      id: r.id,
      name: r.name,
      folderName: syntheticsFolderName(folders, r.folder_id),
      enabled: r.enabled !== false,
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

  async function load(): Promise<boolean> {
    isLoading.value = true;
    loadError.value = false;
    try {
      // undefined omits ?folder= so every folder is listed: references are cross-folder by design.
      const res = await syntheticsService.listByFolderId(org.value, undefined);
      const rows = ((res.data.checks ?? []) as ListRow[]).filter(
        (r) => r.type === "browser" && r.id !== ownCheckId(),
      );
      // Nesting is one level deep, so a check that already holds a reference is shown but not pickable.
      const holdsSubtest = (r: ListRow) => (r.references ?? 0) > 0;
      usable.value = rows.filter((r) => !holdsSubtest(r)).map(toCandidate);
      blocked.value = rows.filter(holdsSubtest).map(toCandidate);
      isEmpty.value = rows.length === 0;
      return true;
    } catch (err) {
      loadError.value = true;
      options.onError?.(err);
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /** Fetches the list; a call while one is in flight joins it instead of racing it. */
  function reload(): Promise<boolean> {
    pending ??= load().finally(() => {
      pending = null;
    });
    return pending;
  }

  if (options.immediate) void reload();

  return { usable, blocked, isLoading, isEmpty, loadError, reload };
}
