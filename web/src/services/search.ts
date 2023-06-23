// Copyright 2022 Zinc Labs Inc. and Contributors

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

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
    const url = `/api/${org_identifier}/_search?type=${page_type}`;
    return http().post(url, query);
  },
  search_around: ({
    org_identifier,
    index,
    key,
    size,
    query_context,
    query_fn,
  }: {
    org_identifier: string;
    index: string;
    key: string;
    size: string;
    query_context: string;
    query_fn: string;
  }) => {
    let url = `/api/${org_identifier}/${index}/_around?key=${key}&size=${size}&sql=${query_context}`;
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
    const url = `/api/${org_identifier}/prometheus/api/v1/query_range?start=${start_time}&end=${end_time}&query=${encodeURIComponent(
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
};

export default search;
