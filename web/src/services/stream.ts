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

import http from "./http";

const stream = {
  nameList: (
    org_identifier: string,
    type: string,
    schema: boolean,
    offset: number = -1,
    limit: number = -1,
    keyword: string = "",
    sort: string = "",
    asc: boolean = false,
  ) => {
    let url = `/api/${org_identifier}/streams`;

    if (type != "") {
      url += "?type=" + type;
    }

    if (offset != -1 && limit != -1) {
      url += `&offset=${offset}&limit=${limit}`;
    }

    if (keyword != "") {
      url += `&keyword=${keyword}`;
    }

    if (sort != "") {
      url += `&sort=${sort}&asc=${asc}`;
    }

    if (schema) {
      url +=
        url.indexOf("?") > 0
          ? "&fetchSchema=" + schema
          : "?fetchSchema=" + schema;
    }
    return http().get(url);
  },

  schema: (org_identifier: string, stream_name: string, type: string) => {
    let url = `/api/${org_identifier}/streams/${stream_name}/schema`;

    if (type != "") {
      url += "?type=" + type;
    }
    return http().get(url);
  },

  updateSettings: (
    org_identifier: string,
    stream_name: string,
    type: string,
    data: any,
  ) => {
    let url = `/api/${org_identifier}/streams/${stream_name}/settings`;

    if (type != "") {
      url += "?type=" + type;
    }

    return http().put(url, data);
  },
  createStream: (
    org_identifier: string,
    stream_name: string,
    type: string,
    data: any,
  ) => {
    let url = `/api/${org_identifier}/streams/${stream_name}`;

    if (type != "") {
      url += "?type=" + type;
    }
    return http().post(url, data);
  },

  fieldValues: ({
    org_identifier,
    stream_name,
    fields,
    size,
    start_time,
    end_time,
    query_context,
    query_fn,
    type,
    regions,
    clusters,
    no_count,
    action_id,
    traceparent,
  }: any) => {
    const fieldsString = fields.join(",");
    let url = `/api/${org_identifier}/${stream_name}/_values?fields=${fieldsString}&size=${size}&start_time=${start_time}&end_time=${end_time}`;
    if (query_context) url = url + `&sql=${query_context}`;
    if (no_count) url = url + `&no_count=${no_count}`;
    if (query_fn?.trim()) url = url + `&query_fn=${query_fn}`;
    if (action_id?.trim()) url = url + `&action_id=${action_id}`;
    if (type) url += "&type=" + type;
    if (regions) url += "&regions=" + regions;
    if (clusters) url += "&clusters=" + clusters;

    let headers = {};
    if (traceparent) {
      headers = { traceparent };
    }
    return http({
      headers,
    }).get(url);
  },

  // Thia API is just used for service_name and operation_name fields
  tracesFieldValues: ({
    org_identifier,
    stream_name,
    fields,
    size,
    start_time,
    end_time,
    filter,
    type,
    keyword,
  }: any) => {
    const fieldsString = fields.join(",");
    let url = `/api/${org_identifier}/${stream_name}/_values?fields=${fieldsString}&size=${size}&start_time=${start_time}&end_time=${end_time}`;
    if (filter) url = url + `&filter=${filter}`;
    if (type) url += "&type=" + type;
    if (keyword) url += "&keyword=" + keyword;

    return http().get(url);
  },

  labelValues: ({
    org_identifier,
    stream_name,
    start_time,
    end_time,
    label,
  }: any) => {
    const url = `/api/${org_identifier}/prometheus/api/v1/label/${label}/values?&match[]=${stream_name}&start=${start_time}&end=${end_time}`;
    return http().get(url);
  },

  delete: (
    org_identifier: string,
    stream_name: string,
    stream_type: string,
    deleteAssociatedAlertsPipelines: boolean = true,
  ) => {
    return http().delete(
      `/api/${org_identifier}/streams/${stream_name}?type=${stream_type}&delete_all=${deleteAssociatedAlertsPipelines}`,
    );
  },

  deleteFields: (org_identifier: string, stream_name: string, stream_type: string, fields: []) => {
    return http().put(
      `/api/${org_identifier}/streams/${stream_name}/delete_fields?type=${stream_type}`,
      {
        fields,
      },
    );
  },
};

export default stream;
