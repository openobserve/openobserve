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

import http from "./http";
import analytics from "./product_analytics";

// POST /{org_id}/reports  -- Create Report
// GET /{org_id}/reports/{name} -- Get One Report
// GET /{org_id}/reports -- List of Reports
// PUT /{org_id}/reports/{name} -- Update Report
// DELETE /{org_id}/reports/{name} -- Delete Report
// PUT /{org_id}/reports/{name}/enable?value=<true|false> -- Enable/disable
// PUT /{org_id}/reports/{name}/trigger -- trigger report immediately

const reports = {
  // v1 API — used by the create/edit form
  list: (
    org_identifier: string = "",
    folder_id: string = "",
    dashboard_id: string = "",
    cache: boolean = false,
  ) => {
    const params = [];
    if (folder_id) params.push(`folder_id=${folder_id}`);
    if (dashboard_id) params.push(`dashboard_id=${dashboard_id}`);
    if (cache) params.push(`cache=${cache}`);
    const query = params.join("&");
    return http().get(`/api/${org_identifier}/reports?${query}`);
  },
  getReport: (org_identifier: string, reportName: string) => {
    return http().get(`/api/${org_identifier}/reports/${encodeURIComponent(reportName)}`);
  },
  createReport: (org_identifier: string, payload: any, folder_id?: string) => {
    let url = `/api/${org_identifier}/reports`;
    if (folder_id) url += `?folder=${folder_id}`;
    return http().post(url, payload);
  },
  updateReport: (org_identifier: string, payload: any) => {
    return http()
      .put(`/api/${org_identifier}/reports/${encodeURIComponent(payload.name)}`, payload)
      .then((res) => {
        analytics.track("report_updated");
        return res;
      });
  },
  deleteReport: (org_identifier: string, reportName: string) => {
    return http().delete(`/api/${org_identifier}/reports/${encodeURIComponent(reportName)}`);
  },
  bulkDelete: (org_identifier: string, data: any) => {
    return http().delete(`/api/${org_identifier}/reports/bulk`, { data });
  },
  triggerReport: (org_identifier: string, reportName: string) => {
    return http().put(`/api/${org_identifier}/reports/${encodeURIComponent(reportName)}/trigger`);
  },
  toggleReportState: (org_identifier: string, reportName: string, state: boolean) => {
    return http().put(
      `/api/${org_identifier}/reports/${encodeURIComponent(reportName)}/enable?value=${state}`,
    );
  },

  // v2 — folder-aware, ID-based
  getReportById: (org_identifier: string, report_id: string) => {
    return http().get(`/api/v2/${org_identifier}/reports/${report_id}`);
  },
  createReportV2: (org_identifier: string, payload: any, folder_id?: string) => {
    let url = `/api/v2/${org_identifier}/reports`;
    if (folder_id) url += `?folder=${encodeURIComponent(folder_id)}`;
    return http()
      .post(url, payload)
      .then((res) => {
        analytics.track("report_created");
        return res;
      });
  },
  updateReportById: (
    org_identifier: string,
    report_id: string,
    payload: any,
    new_folder_id?: string,
  ) => {
    let url = `/api/v2/${org_identifier}/reports/${report_id}`;
    if (new_folder_id) url += `?folder=${encodeURIComponent(new_folder_id)}`;
    return http()
      .put(url, payload)
      .then((res) => {
        analytics.track("report_updated");
        return res;
      });
  },
  listByFolderId: (
    org_identifier: string,
    folder_id?: string,
    dashboard_id?: string,
    cache?: boolean,
    name_substring?: string,
  ) => {
    const params: string[] = [];
    if (folder_id) params.push(`folder=${folder_id}`);
    if (dashboard_id) params.push(`dashboard_id=${dashboard_id}`);
    if (name_substring) params.push(`report_name_substring=${encodeURIComponent(name_substring)}`);
    if (typeof cache == "boolean") params.push(`cache=${cache}`);
    const query = params.length ? `?${params.join("&")}` : "";
    return http().get(`/api/v2/${org_identifier}/reports${query}`);
  },
  deleteReportById: (org_identifier: string, report_id: string) => {
    return http()
      .delete(`/api/v2/${org_identifier}/reports/${report_id}`)
      .then((res) => {
        analytics.track("report_deleted", { count: 1 });
        return res;
      });
  },
  bulkDeleteById: (org_identifier: string, data: { ids: string[] }) => {
    return http()
      .delete(`/api/v2/${org_identifier}/reports/bulk`, { data })
      .then((res) => {
        const count = res.data?.successful?.length ?? 0;
        if (count > 0) analytics.track("report_deleted", { count });
        return res;
      });
  },
  triggerReportById: (org_identifier: string, report_id: string) => {
    return http().put(`/api/v2/${org_identifier}/reports/${report_id}/trigger`);
  },
  toggleReportStateById: (org_identifier: string, report_id: string, state: boolean) => {
    return http()
      .patch(`/api/v2/${org_identifier}/reports/${report_id}/enable?value=${state}`)
      .then((res) => {
        analytics.track(state ? "report_enabled" : "report_disabled", { count: 1 });
        return res;
      });
  },
};

export default reports;

export interface ReportListFilters {
  /** undefined = search across every folder. */
  folder?: string;
  isCache?: boolean;
  nameQuery?: string;
}
