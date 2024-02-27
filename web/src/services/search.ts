// Copyright 2023 Zinc Labs Inc.
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

import http from "./http";

const search = {
  search: ({
    org_identifier,
    query,
    page_type = "logs",
  }: {
    org_identifier: string;
    query: any;
    page_type: string;
  }) => {
    let url = `/api/${org_identifier}/_search?type=${page_type}`;
    if (typeof query.query.sql != "string") {
      url = `/api/${org_identifier}/_search_multi?type=${page_type}`;
      if (query.hasOwnProperty("aggs")) {
        return http().post(url, { ...query.query, aggs: query.aggs });
      } else {
        return http().post(url, query.query);
      }
    }
    return http().post(url, query);
  },
  search_around: ({
    org_identifier,
    index,
    key,
    size,
    query_context,
    query_fn,
    stream_type,
  }: {
    org_identifier: string;
    index: string;
    key: string;
    size: string;
    query_context: any;
    query_fn: any;
    stream_type: string;
  }) => {
    let url = `/api/${org_identifier}/${index}/_around?key=${key}&size=${size}&sql=${query_context}&type=${stream_type}`;
    if (query_fn.trim() != "") {
      url = url + `&query_fn=${query_fn}`;
    }
    return http().get(url);
  },
  metrics_query_range: ({
    org_identifier,
    query,
    start_time,
    end_time,
  }: {
    org_identifier: string;
    query: string;
    start_time: number;
    end_time: number;
  }) => {
    const url = `/api/${org_identifier}/prometheus/api/v1/query_range?start=${start_time}&end=${end_time}&step=0&query=${encodeURIComponent(
      query
    )}`;
    return http().get(url);
  },
  metrics_query: ({
    org_identifier,
    query,
    start_time,
    end_time,
  }: {
    org_identifier: string;
    query: string;
    start_time: number;
    end_time: number;
  }) => {
    const url = `/api/${org_identifier}/prometheus/api/v1/query?time=${end_time}&query=${query}`;
    return http().get(url);
  },
  get_promql_series: ({
    org_identifier,
    labels,
    start_time,
    end_time,
  }: {
    org_identifier: string;
    labels: string;
    start_time: number;
    end_time: number;
  }) => {
    const url = `/api/${org_identifier}/prometheus/api/v1/series?match[]=${labels}&start=${start_time}&end=${end_time}`;
    return http().get(url);
  },

  get_traces: ({
    org_identifier,
    filter,
    start_time,
    end_time,
    from,
    size,
    stream_name,
  }: {
    org_identifier: string;
    filter: string;
    start_time: number;
    end_time: number;
    from: number;
    size: number;
    stream_name: string;
  }) => {
    const url = `/api/${org_identifier}/${stream_name}/traces/latest?filter=${filter}&start_time=${start_time}&end_time=${end_time}&from=${from}&size=${size}`;
    return http().get(url);
  },
  partition: ({
    org_identifier,
    query,
    page_type = "logs",
  }: {
    org_identifier: string;
    query: any;
    page_type: string;
  }) => {
    let url = `/api/${org_identifier}/_search_partition?type=${page_type}`;
    if (typeof query.sql != "string") {
      url = `/api/${org_identifier}/_search_partition_multi?type=${page_type}`;
    }
    return http().post(url, query);
  },
};

export default search;
