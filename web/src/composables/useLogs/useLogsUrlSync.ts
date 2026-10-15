//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { onBeforeUnmount, watch } from "vue";
import { useRouter } from "vue-router";
import { searchState } from "@/composables/useLogs/searchState";
import { useLogsAutoRun } from "@/composables/useLogs/logsAutoRun";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { onHitsComplete } from "@/composables/useLogs/logsRowNav";
import { activePermalink, initGenerationId } from "@/composables/useLogs/useLogPermalink";
import {
  dropLineLinkParams,
  recordShownSearch,
  routeHasLineLink,
  sharedPage,
  sharedPageNotice,
} from "@/composables/useLogs/useLogsUrl";

export interface LogsUrlSyncOptions {
  panelData?: (surface: "visualize" | "build") => unknown;
}

export function useLogsUrlSync(options: LogsUrlSyncOptions = {}) {
  const router = useRouter();
  const { searchObj } = searchState();
  const autoRun = useLogsAutoRun();
  const { updateUrlQueryParams, patchUrlViewState } = logsUtils();

  const stopShownSearch = autoRun.engine.onExecutedRecorded((event) => {
    if (router.currentRoute.value.name !== "logs") return;
    const patch = recordShownSearch(event, {
      selectedStreams: [...(searchObj.data.stream.selectedStream ?? [])],
      resolvedWindow: {
        startTime: searchObj.data.datetime.startTime,
        endTime: searchObj.data.datetime.endTime,
      },
    });
    const panel = event.surface === "visualize" ? (options.panelData?.("visualize") ?? null) : null;
    const build = event.surface === "build" ? (options.panelData?.("build") ?? null) : null;
    void updateUrlQueryParams(panel, build, patch ? "replace" : "auto");
  });

  const stopSharedPageNotice = onHitsComplete((payload) => {
    if (payload.type !== "search" || payload.isPagination || sharedPage.value === null) return;
    const generationId = (payload as { generationId?: number }).generationId;
    if (generationId === undefined || generationId !== initGenerationId()) return;
    const page = sharedPage.value;
    sharedPage.value = null;
    const executed = searchObj.meta.executed as { complete?: boolean } | null | undefined;
    if (!executed?.complete || searchObj.data.queryResults?.is_partial === true) return;
    sharedPageNotice.value = { page, lastPage: null };
  });

  watch(
    () => router.currentRoute.value.query,
    (query) => {
      if (router.currentRoute.value.name !== "logs") return;
      if (routeHasLineLink(query) && !activePermalink.value) void dropLineLinkParams();
    },
  );

  watch(
    () => [
      JSON.stringify(searchObj.data.stream.selectedFields ?? []),
      searchObj.meta.isFtsDefaultColumn,
    ],
    () => {
      const query = router.currentRoute.value.query;
      if (searchObj.shouldIgnoreWatcher || (!query.stream && query.sql_mode !== "true")) return;
      void patchUrlViewState();
    },
  );

  onBeforeUnmount(() => {
    stopShownSearch();
    stopSharedPageNotice();
  });
}
