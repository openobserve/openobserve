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

const alerts = {
  list: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string,
    org_identifier: string,
  ) => {
    return http().get(
      `/api/${org_identifier}/alerts?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`,
    );
  },
  listByFolderId: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string,
    org_identifier: string,
    folder_id?: string,
    query?: string,
  ) => {
    let url = `/api/v2/${org_identifier}/alerts?sort_by=${sort_by}&desc=${desc}&name=${name}`;
    if (folder_id) {
      url += `&folder=${folder_id}`;
    }
    if (query) {
      url += `&alert_name_substring=${query}`;
    }
    return http().get(url);
  },
  create: (
    org_identifier: string,
    stream_name: string,
    stream_type: string,
    data: any,
  ) => {
    return http().post(
      `/api/${org_identifier}/${stream_name}/alerts?type=${stream_type}`,
      data,
    );
  },
  update: (
    org_identifier: string,
    stream_name: string,
    stream_type: string,
    data: any,
  ) => {
    return http().put(
      `/api/${org_identifier}/${stream_name}/alerts/${encodeURIComponent(
        data.name,
      )}?type=${stream_type}`,
      data,
    );
  },
  get_with_name: (
    org_identifier: string,
    stream_name: string,
    alert_name: string,
  ) => {
    return http().get(
      `/api/${org_identifier}/${stream_name}/alerts/${encodeURIComponent(
        alert_name,
      )}`,
    );
  },
  delete: (
    org_identifier: string,
    stream_name: string,
    alert_name: string,
    type: string,
  ) => {
    let url = `/api/${org_identifier}/${stream_name}/alerts/${encodeURIComponent(
      alert_name,
    )}`;
    if (type != "") {
      url += "?type=" + type;
    }
    return http().delete(url);
  },
  toggleState: (
    org_identifier: string,
    stream_name: string,
    alert_name: string,
    enable: boolean,
    stream_type: string,
  ) => {
    const url = `/api/${org_identifier}/${stream_name}/alerts/${encodeURIComponent(
      alert_name,
    )}/enable?value=${enable}&type=${stream_type}`;
    return http().put(url);
  },

  preview: (
    org_identifier: string,
    stream_name: string,
    alert_name: string,
    stream_type: string,
  ) => {
    const url = `/api/${org_identifier}/${stream_name}/alerts/${encodeURIComponent(
      alert_name,
    )}/preview?type=${stream_type}`;
    return http().get(url);
  },
  create_by_alert_id: (org_identifier: string, data: any, folder_id?: any) => {
    let url = `/api/v2/${org_identifier}/alerts`;
    if (folder_id) {
      url += `?folder=${folder_id}`;
    }
    return http().post(url, data);
  },
  update_by_alert_id: (org_identifier: string, data: any, folder_id?: any) => {
    let url = `/api/v2/${org_identifier}/alerts/${data.id}`;
    if (folder_id) {
      url += `?folder=${folder_id}`;
    }
    return http().put(url, data);
  },
  delete_by_alert_id: (
    org_identifier: string,
    alert_id: string,
    folder_id?: any,
  ) => {
    let url = `/api/v2/${org_identifier}/alerts/${alert_id}`;
    if (folder_id) {
      url += `?folder=${folder_id}`;
    }
    return http().delete(url);
  },
  toggle_state_by_alert_id: (
    org_identifier: string,
    alert_id: string,
    enable: boolean,
    folder_id?: any,
  ) => {
    let url = `/api/v2/${org_identifier}/alerts/${alert_id}/enable?value=${enable}`;
    if (folder_id) {
      url += `&folder=${folder_id}`;
    }
    return http().patch(url);
  },
  bulkToggleState: (org_identifier: string, enable: boolean, data: any) => {
    const url = `/api/v2/${org_identifier}/alerts/bulk/enable?value=${enable}`;
    return http().post(url, data);
  },
  bulkDelete: (org_identifier: string, data: any, folder_id?: string) => {
    let url = `/api/v2/${org_identifier}/alerts/bulk`;
    if (folder_id) {
      url += `?folder=${folder_id}`;
    }
    return http().delete(url, { data });
  },
  get_by_alert_id: (
    org_identifier: string,
    alert_id: string,
    folder_id?: any,
  ) => {
    let url = `/api/v2/${org_identifier}/alerts/${alert_id}`;
    if (folder_id) {
      url += `?folder=${folder_id}`;
    }
    return http().get(url);
  },
  //this endpoint is not used as we are using the common service to move the alerts across folders
  move_to_another_folder: (
    org_identifier: string,
    data: any,
    folder_id?: any,
  ) => {
    let url = `/api/v2/${org_identifier}/alerts/move`;
    if (folder_id) {
      url += `?folder=${folder_id}`;
    }
    return http().patch(url, data);
  },
  getHistory: (org_identifier: string, query: any) => {
    const params = new URLSearchParams();
    if (query.alert_id) params.append("alert_id", query.alert_id);
    if (query.start_time) params.append("start_time", query.start_time);
    if (query.end_time) params.append("end_time", query.end_time);
    params.append("from", query.from || "0");
    params.append("size", query.size || "100");
    if (query.sort_by) params.append("sort_by", query.sort_by);
    if (query.sort_order) params.append("sort_order", query.sort_order);
    return http().get(`/api/v2/${org_identifier}/alerts/history?${params}`);
  },
  getOrganizationDeduplicationConfig: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/alerts/deduplication/config`);
  },
  setOrganizationDeduplicationConfig: (org_identifier: string, data: any) => {
    return http().post(`/api/${org_identifier}/alerts/deduplication/config`, data);
  },
  deleteOrganizationDeduplicationConfig: (org_identifier: string) => {
    return http().delete(`/api/${org_identifier}/alerts/deduplication/config`);
  },
  get_dedup_summary: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/alerts/dedup/summary`);
  },
  // Semantic field groups management
  getSemanticGroups: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/alerts/deduplication/semantic-groups`);
  },
  previewSemanticGroupsDiff: (org_identifier: string, groups: any[]) => {
    return http().post(`/api/${org_identifier}/alerts/deduplication/semantic-groups/preview-diff`, groups);
  },
  saveSemanticGroups: (org_identifier: string, groups: any[]) => {
    return http().put(`/api/${org_identifier}/alerts/deduplication/semantic-groups`, groups);
  },
  trigger_alert: (
    org_identifier: string,
    alert_id: string,
    folder_id?: string,
  ) => {
    let url = `/api/v2/${org_identifier}/alerts/${alert_id}/trigger`;
    if (folder_id) {
      url += `?folder=${folder_id}`;
    }
    return http().patch(url);
  },
  generate_sql: (
    org_identifier: string,
    data: any,
  ) => {
    return http().post(
      `/api/v2/${org_identifier}/alerts/generate_sql`,
      data,
    );
  },
};

export default alerts;
