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

import { computed, watch, type Ref } from "vue";
import { useStore } from "vuex";
import { useInfiniteQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import { useNow } from "@/composables/useNow";
import { autoobserveIncidentsPagesQuery } from "@/services/autoobserve.queries";
import type { IssuesRange } from "../v2/fixtures";
import {
  ISSUES_CAP,
  ISSUES_PAGE_SIZE,
  failedDetail,
  issuesCapped,
  issuesRangeStart,
} from "./incidentsCopy";
import { statusOf } from "./liveCopy";
import {
  keepSameOrg,
  stateOf,
  useHeldSkeleton,
  useKeptFailure,
  useLiveMode,
  useLiveZone,
} from "./liveModel";

export const useLiveIssues = (
  range: Readonly<Ref<IssuesRange>>,
  cap = ISSUES_CAP,
  pageSize = ISSUES_PAGE_SIZE,
) => {
  const store = useStore();
  const live = useLiveMode();
  const now = useNow();
  const { t } = useI18nTyped();
  const zone = useLiveZone();
  const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
  const enabled = computed(() => live.value && !!org.value);
  const query = useInfiniteQuery(() =>
    Object.assign(autoobserveIncidentsPagesQuery(org.value, range.value, pageSize, cap), {
      enabled: enabled.value,
      placeholderData: keepSameOrg(org.value),
    }),
  );
  const retry = () => void query.refetch();
  const placeholder = computed(() => query.isPlaceholderData.value);
  const state = useKeptFailure(
    () => ({
      ...stateOf(query, retry),
      detail: query.isError.value
        ? failedDetail(
            t,
            zone.value.locale,
            zone.value.timeZone,
            statusOf(query.error.value),
            query.errorUpdatedAt.value,
          )
        : raw(""),
    }),
    () => `${org.value}|${range.value}`,
    () => placeholder.value,
  );
  // The range is a filter, not a scroll, so every page inside it loads without the reader asking.
  watch(
    () =>
      enabled.value && query.hasNextPage.value && !query.isFetching.value && !query.isError.value,
    (more) => {
      if (more) void query.fetchNextPage({ cancelRefetch: false });
    },
    { immediate: true },
  );
  const skeleton = useHeldSkeleton(() => enabled.value && state.value.status === "loading");
  const minute = computed(() => Math.floor(now.value / 60_000));
  const startUs = computed(() => issuesRangeStart(range.value, minute.value * 60_000));
  const pages = computed(() => query.data.value?.pages ?? []);
  const rows = computed(() =>
    pages.value
      .flatMap((page) => page.items)
      .slice(0, cap)
      .filter((item) => item.finding.first_seen_at >= startUs.value),
  );
  const capped = computed(() => issuesCapped(pages.value, startUs.value, cap));
  return {
    org,
    state,
    skeleton,
    placeholder,
    rows,
    capped,
    hasMore: computed(() => query.hasNextPage.value || capped.value),
    openCount: computed(() => rows.value.filter((i) => i.incident.status !== "resolved").length),
    paging: computed(() => pages.value[0]?.paging ?? true),
    rcaEnabled: computed(() => store.state.zoConfig?.incidents_rca_enabled === true),
    now: computed(() => minute.value * 60_000),
  };
};
