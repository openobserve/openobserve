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

    // A null executed means the hits did not come from a tracked run (search-around view),
    // so the snapshot belongs to a different query and must not be re-fetched.
    const trackedRun = !!searchObj.meta.executed?.complete;
    if (!trackedRun || !querySnapshot?.query || total <= hits.length) {
      await downloadLogs(hits, format);
      return;
    }

    isDownloadingAll.value = true;
    try {
      const queryReq = JSON.parse(JSON.stringify(querySnapshot));
      queryReq.query.from = 0;
      queryReq.query.size = total;
      const res = await searchService.search(
        {
          org_identifier: searchObj.organizationIdentifier,
          query: queryReq,
          page_type: searchObj.data.stream.streamType,
        },
        "ui",
      );
      const rows = res?.data?.hits ?? [];
      if (rows.length > 0) {
        await downloadLogs(rows, format);
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
