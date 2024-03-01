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

// POST /{org_id}/reports  -- Create Report
// GET /{org_id}/reports/{name} -- Get One Report
// GET /{org_id}/reports -- List of Reports
// PUT /{org_id}/reports/{name} -- Update Report
// DELETE /{org_id}/reports/{name} -- Delete Report
// PUT /{org_id}/reports/{name}/enable?value=<true|false> -- Enable/disable
// PUT /{org_id}/reports/{name}/trigger -- trigger report immediately

const reports = {
  list: (org_identifier: string) => {
    return new Promise((resolve) => {
      resolve({
        data: [
          {
            dashboards: [
              {
                folder: "7146907899342770176VPxgzI",
                dashboard: "71508289400960532486HWxIK",
                tabs: ["default"],
                variables: [
                  {
                    name: "",
                    value: "var",
                    id: "327e2981-02ab-4da8-a9cb-8f4c11218b88",
                    key: "var",
                  },
                ],
                timerange: {
                  type: "relative",
                  period: "45m",
                  from: 1709272558251000,
                  to: 1709275258251000,
                },
              },
            ],
            description: "Daily Report",
            destinations: [
              {
                email: "hello",
              },
            ],
            enabled: true,
            media_type: "Pdf",
            name: "report1",
            title: "hello",
            message: "hello",
            org_id: "default",
            start: 1711769400000000,
            frequency: {
              interval: 1,
              type: "days",
            },
            user: "",
            password: "",
            timezone: "Asia/Calcutta",
          },
        ],
      });
    });
    // return http().get(`/api/${org_identifier}/reports`);
  },
  getReport: (org_identifier: string, reportName: string) => {
    return new Promise((resolve) => {
      resolve({
        data: {
          dashboards: [
            {
              folder: "7146907899342770176VPxgzI",
              dashboard: "71508289400960532486HWxIK",
              tabs: ["default"],
              variables: [
                {
                  name: "",
                  value: "var",
                  id: "327e2981-02ab-4da8-a9cb-8f4c11218b88",
                  key: "var",
                },
              ],
              timerange: {
                type: "relative",
                period: "45m",
                from: 1709272558251000,
                to: 1709275258251000,
              },
            },
          ],
          description: "Daily Report",
          destinations: [
            {
              email: "hello",
            },
          ],
          enabled: true,
          media_type: "Pdf",
          name: "report1",
          title: "hello",
          message: "hello",
          org_id: "default",
          start: 1711769400000000,
          frequency: {
            interval: 1,
            type: "days",
          },
          user: "",
          password: "",
          timezone: "Asia/Calcutta",
        },
      });
    });
    // return http().get(`/api/${org_identifier}/reports/${reportName}`);
  },
  createReport: (org_identifier: string, payload: any) => {
    return http().post(`/api/${org_identifier}/reports`, payload);
  },
  updateReport: (org_identifier: string, payload: any) => {
    return http().put(
      `/api/${org_identifier}/reports/${payload.name}`,
      payload
    );
  },
  deleteReport: (org_identifier: string, reportName: string) => {
    return http().delete(`/api/${org_identifier}/reports/${reportName}`);
  },
  triggerReport: (org_identifier: string, reportName: string) => {
    return http().put(`/api/${org_identifier}/reports/${reportName}/trigger`);
  },
  toggleReportState: (
    org_identifier: string,
    reportName: string,
    state: boolean
  ) => {
    return http().put(
      `/api/${org_identifier}/reports/${reportName}/enable?value=${state}`
    );
  },
};

export default reports;
