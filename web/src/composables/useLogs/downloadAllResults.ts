// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or
// modify it under the terms of the GNU Affero General Public License
// as published by the Free Software Foundation, either version 3 of
// the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { ref } from "vue";
import searchService from "@/services/search";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped, raw } from "@/types/i18n";
import { searchState } from "./searchState";

export type DownloadFormat = "csv" | "json";

// Matches the largest single export the custom-range dialog offers.
const DOWNLOAD_PAGE_SIZE = 10000;

export const useDownloadAllResults = () => {
  const { searchObj } = searchState();
  const { t } = useI18nTyped();
  const isDownloadingAll = ref(false);

  // hits holds one page only — re-fetch the full set or columns unique to unloaded rows are lost.
  const downloadAllResults = async (
    format: DownloadFormat,
    downloadLogs: (rows: any[], format: DownloadFormat) => any,
  ) => {
    if (isDownloadingAll.value) return;

    const hits = searchObj.data.queryResults?.hits ?? [];
    const total = searchObj.data.queryResults?.total ?? 0;
    const querySnapshot = searchObj.data.customDownloadQueryObj;

    // Null executed means the hits came from search-around, so the snapshot is for a different query.
    const trackedRun = !!searchObj.meta.executed?.complete;
    if (!trackedRun || !querySnapshot?.query || total <= hits.length) {
      await downloadLogs(hits, format);
      return;
    }

    isDownloadingAll.value = true;
    const runSignature = searchObj.meta.executed?.signature;
    try {
      let allRows: any[] = [];
      let from = 0;
      let size = Math.max(DOWNLOAD_PAGE_SIZE, total);
      // total is a paging lower bound ("51+") when the histogram is off, so only a short page ends the loop.
      for (;;) {
        const queryReq = JSON.parse(JSON.stringify(querySnapshot));
        queryReq.query.from = from;
        queryReq.query.size = size;
        const res = await searchService.search(
          {
            org_identifier: searchObj.organizationIdentifier,
            query: queryReq,
            page_type: searchObj.data.stream.streamType,
          },
          "ui",
        );
        const page = res?.data?.hits ?? [];
        allRows = allRows.concat(page);
        if (page.length < size) break;
        from += size;
        size = DOWNLOAD_PAGE_SIZE;
      }
      // A different run took over mid-fetch; downloadLogs's disabled guard would silently drop the file.
      if (searchObj.meta.executed?.signature !== runSignature) {
        toast({
          message: t("search.somethingWentWrong"),
          variant: "error",
        });
        return;
      }
      // Retention can expire rows between the run and the refetch — the loaded hits are the run's own rows.
      const exportRows = allRows.length >= hits.length ? allRows : hits;
      if (exportRows.length > 0) {
        await downloadLogs(exportRows, format);
      } else {
        toast({
          message: t("logs.searchBar.noDataToDownload"),
          variant: "warning",
        });
      }
    } catch (err: unknown) {
      toast({
        message: raw(
          err instanceof Error && err.message ? err.message : t("search.somethingWentWrong"),
        ),
        variant: "error",
      });
    } finally {
      isDownloadingAll.value = false;
    }
  };

  return { downloadAllResults, isDownloadingAll };
};
