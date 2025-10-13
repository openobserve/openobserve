// Copyright 2023 OpenObserve Inc.
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

import { searchState } from "@/composables/useLogs/searchState";

export const useSearchPagination = () => {
  const {
    searchObj,
    notificationMsg,
  } = searchState();

  const getAggsTotal = () => {
    return (searchObj.data.queryResults.aggs || []).reduce(
      (acc: number, item: { zo_sql_num: number }) => acc + item.zo_sql_num,
      0,
    );
  };

  const refreshPagination = (regenerateFlag: boolean = false) => {
    try {
      const { rowsPerPage } = searchObj.meta.resultGrid;
      const { currentPage } = searchObj.data.resultGrid;

      if (searchObj.meta.jobId != "")
        searchObj.meta.resultGrid.rowsPerPage = 100;

      let total = 0;
      let totalPages = 0;

      total = getAggsTotal();

      if ((searchObj.data.queryResults.pageCountTotal || -1) > total) {
        total = searchObj.data.queryResults.pageCountTotal;
      }

      searchObj.data.queryResults.total = total;
      searchObj.data.queryResults.pagination = [];

      totalPages = Math.ceil(total / rowsPerPage);

      for (let i = 0; i < totalPages; i++) {
        if (i + 1 > currentPage + 10) {
          break;
        }
        searchObj.data.queryResults.pagination.push({
          from: i * rowsPerPage + 1,
          size: rowsPerPage,
        });
      }
    } catch (e: any) {
      console.log("Error while refreshing partition pagination", e);
      notificationMsg.value = "Error while refreshing partition pagination.";
      return false;
    }
  };

  const updateResult = async (
    queryReq: any,
    response: any,
    isPagination: boolean,
    appendResult: boolean = false,
  ) => {
    if (
      searchObj.meta.refreshInterval > 0 &&
      window.location.pathname.includes("logs")
    ) {
      searchObj.data.queryResults.from = response.content.results.from;
      searchObj.data.queryResults.scan_size =
        response.content.results.scan_size;
      searchObj.data.queryResults.took = response.content.results.took;
      searchObj.data.queryResults.aggs = response.content.results.aggs;
      searchObj.data.queryResults.hits = response.content.results.hits;
    }

    if (searchObj.meta.refreshInterval == 0) {
      if (!queryReq.query.hasOwnProperty("track_total_hits")) {
        delete response.content.total;
      }

      if (appendResult) {
        await chunkedAppend(
          searchObj.data.queryResults.hits,
          response.content.results.hits,
        );

        searchObj.data.queryResults.total += response.content.results.total;
        searchObj.data.queryResults.took += response.content.results.took;
        searchObj.data.queryResults.scan_size +=
          response.content.results.scan_size;
      } else {
        if (response.content?.streaming_aggs) {
          searchObj.data.queryResults = {
            ...response.content.results,
            took:
              (searchObj.data?.queryResults?.took || 0) +
              response.content.results.took,
            scan_size:
              (searchObj.data?.queryResults?.scan_size || 0) +
              response.content.results.scan_size,
          };
        } else if (isPagination) {
          searchObj.data.queryResults.hits = response.content.results.hits;
          searchObj.data.queryResults.from = response.content.results.from;
          searchObj.data.queryResults.scan_size =
            response.content.results.scan_size;
          searchObj.data.queryResults.took = response.content.results.took;
          searchObj.data.queryResults.total = response.content.results.total;
        } else {
          searchObj.data.queryResults = response.content.results;
        }
      }
    }

    if (searchObj.data.queryResults) {
      searchObj.data.queryResults.time_offset = response.content?.time_offset;
    }
  };

  const chunkedAppend = async (target: any, source: any, chunkSize = 5000) => {
    for (let i = 0; i < source.length; i += chunkSize) {
      target.push.apply(target, source.slice(i, i + chunkSize));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  const handlePageCountResponse = (
    queryReq: any,
    traceId: string,
    response: any,
  ) => {
    if (searchObj.data.queryResults.aggs == null) {
      searchObj.data.queryResults.aggs = [];
    }

    let regeneratePaginationFlag = false;
    if (
      response.content.results.hits.length !=
      searchObj.meta.resultGrid.rowsPerPage
    ) {
      regeneratePaginationFlag = true;
    }

    searchObj.data.queryResults.aggs.push(...response.content.results.hits);
    searchObj.data.queryResults.scan_size += response.content.results.scan_size;
    searchObj.data.queryResults.took += response.content.results.took;

    refreshPagination(regeneratePaginationFlag);
  };

  const calculatePageInfo = () => {
    const { rowsPerPage } = searchObj.meta.resultGrid;
    const { currentPage } = searchObj.data.resultGrid;
    const total = searchObj.data.queryResults.total || 0;

    const totalPages = Math.ceil(total / rowsPerPage);
    const from = (currentPage - 1) * rowsPerPage + 1;
    const to = Math.min(currentPage * rowsPerPage, total);

    return {
      totalPages,
      from,
      to,
      total,
      currentPage,
      rowsPerPage,
    };
  };

  const resetPagination = () => {
    searchObj.data.queryResults.pagination = [];
    searchObj.data.queryResults.total = 0;
    searchObj.data.queryResults.pageCountTotal = undefined;
  };

  const updatePageCountTotal = (
    queryReq: any,
    currentHits: number,
    totalHits: number,
  ) => {
    try {
      const shouldGetPageCountResult = shouldGetPageCount(queryReq);

      if (shouldGetPageCountResult && totalHits === queryReq.query.size) {
        searchObj.data.queryResults.pageCountTotal =
          searchObj.meta.resultGrid.rowsPerPage *
            searchObj.data.resultGrid.currentPage +
          1;
      } else if (shouldGetPageCountResult && totalHits !== queryReq.query.size) {
        searchObj.data.queryResults.pageCountTotal =
          searchObj.meta.resultGrid.rowsPerPage *
            Math.max(searchObj.data.resultGrid.currentPage - 1, 0) +
          currentHits;
      }
    } catch (e: any) {
      console.error("Error while updating page count total", e);
    }
  };

  const trimPageCountExtraHit = (queryReq: any, totalHits: number) => {
    try {
      const shouldGetPageCountResult = shouldGetPageCount(queryReq);

      if (shouldGetPageCountResult && totalHits === queryReq.query.size) {
        searchObj.data.queryResults.hits =
          searchObj.data.queryResults.hits.slice(
            0,
            searchObj.data.queryResults.hits.length - 1,
          );
      }
    } catch (e: any) {
      console.error("Error while trimming page count extra hit", e);
    }
  };

  const shouldGetPageCount = (queryReq: any): boolean => {
    // Simplified logic - in the actual implementation this would be more complex
    if (!queryReq || !queryReq.query) return false;

    // Check if it's a simple query that supports page count
    const hasLimit = queryReq.query.sql?.includes("LIMIT");
    const hasDistinct = queryReq.query.sql?.includes("DISTINCT");
    const hasGroupBy = queryReq.query.sql?.includes("GROUP BY");

    return !hasLimit && !hasDistinct && !hasGroupBy;
  };

  const getCurrentPageData = () => {
    const pageInfo = calculatePageInfo();
    const startIndex = (pageInfo.currentPage - 1) * pageInfo.rowsPerPage;
    const endIndex = startIndex + pageInfo.rowsPerPage;

    return {
      data: searchObj.data.queryResults.hits?.slice(startIndex, endIndex) || [],
      pageInfo,
    };
  };

  return {
    refreshPagination,
    updateResult,
    chunkedAppend,
    handlePageCountResponse,
    calculatePageInfo,
    resetPagination,
    updatePageCountTotal,
    trimPageCountExtraHit,
    shouldGetPageCount,
    getCurrentPageData,
    getAggsTotal,
  };
};

export default useSearchPagination;