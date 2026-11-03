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

export interface SlackOAuthConnection {
  webhookUrl: string;
  channel: string;
  channelId: string;
  teamId: string;
  teamName: string;
}

export interface SlackOAuthStartResponse {
  authorizationUrl: string;
}

export type JiraDeployment = "cloud" | "data_center";
export type JiraSetupAction = "connect" | "issue_types" | "fields" | "test_issue";

export interface JiraSetupRequest {
  url: string;
  deployment: JiraDeployment;
  email: string;
  token: string;
  destination?: string;
  action: JiraSetupAction;
  project_key?: string;
  issue_type_id?: string;
  priority_id?: string;
  fields?: Record<string, unknown>;
}

export interface JiraOption {
  id: string;
  name: string;
}

export interface JiraConnectResponse {
  display_name: string;
  projects: { key: string; name: string }[];
}

export interface JiraIssueTypesResponse {
  issue_types: JiraOption[];
}

export type JiraFieldKind = "text" | "number" | "option" | "options" | "unsupported";

export interface JiraRequiredField {
  id: string;
  name: string;
  kind: JiraFieldKind;
  options?: JiraOption[];
}

export interface JiraFieldsResponse {
  has_labels: boolean;
  priorities: JiraOption[];
  required_fields: JiraRequiredField[];
}

export interface JiraTestIssueResponse {
  key: string;
  url: string;
}

const destination = {
  create: ({ org_identifier, data, module }: any) => {
    let url = `/api/${org_identifier}/alerts/destinations`;
    if (module) {
      url += `?module=${module}`;
    }
    return http()
      .post(url, data)
      .then((res) => {
        analytics.track("alert_destination_created", { module: module || "alert" });
        return res;
      });
  },
  update: ({ org_identifier, destination_name, data, module }: any) => {
    let url = `/api/${org_identifier}/alerts/destinations/${encodeURIComponent(destination_name)}`;
    if (module) {
      url += `?module=${module}`;
    }
    return http()
      .put(url, data)
      .then((res) => {
        analytics.track("alert_destination_updated", { module: module || "alert" });
        return res;
      });
  },
  list: ({ org_identifier, page_num, page_size, desc, sort_by, module, include_usage }: any) => {
    // Construct the base URL with required parameters
    let url = `/api/${org_identifier}/alerts/destinations?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}`;
    // Append module if it is defined
    if (module) {
      url += `&module=${module}`;
    }
    if (include_usage) {
      url += `&include_usage=true`;
    }
    return http().get(url);
  },
  get_by_name: ({ org_identifier, destination_name }: any) => {
    return http().get(
      `/api/${org_identifier}/alerts/destinations/${encodeURIComponent(destination_name)}`,
    );
  },
  delete: ({ org_identifier, destination_name }: any) => {
    return http()
      .delete(`/api/${org_identifier}/alerts/destinations/${encodeURIComponent(destination_name)}`)
      .then((res) => {
        analytics.track("alert_destination_deleted", { count: 1 });
        return res;
      });
  },
  bulkDelete: (org_identifier: string, data: any) => {
    return http()
      .delete(`/api/${org_identifier}/alerts/destinations/bulk`, { data })
      .then((res) => {
        const count = res.data?.successful?.length ?? 0;
        if (count > 0) analytics.track("alert_destination_deleted", { count });
        return res;
      });
  },
  test: ({ org_identifier, data }: any) => {
    return http()
      .post(`/api/${org_identifier}/alerts/destinations/test`, data)
      .then((res) => {
        analytics.track("alert_destination_test_completed", { success: !!res.data?.success });
        return res;
      });
  },
  startSlackOAuth: ({ org_identifier }: { org_identifier: string }) =>
    http().post<SlackOAuthStartResponse>(
      `/api/${encodeURIComponent(org_identifier)}/alerts/destinations/slack/oauth/start`,
    ),
  exchangeSlackOAuth: ({
    org_identifier,
    code,
    state,
  }: {
    org_identifier: string;
    code: string;
    state: string;
  }) =>
    http()
      .post<SlackOAuthConnection>(
        `/api/${encodeURIComponent(org_identifier)}/alerts/destinations/slack/oauth/exchange`,
        { code, state },
      )
      .then((res) => {
        analytics.track("alert_destination_slack_connected");
        return res;
      }),
  // The browser cannot call Jira directly, so lookups and the test issue go through the server.
  jiraSetup: <T>(org_identifier: string, data: JiraSetupRequest) =>
    http().post<T>(
      `/api/${encodeURIComponent(org_identifier)}/alerts/destinations/jira/setup`,
      data,
    ),
  // Renders a content-template spec/saved template and DISPATCHES it to the
  // named destination's real channel, marked `[TEST] `. See Task 15 — unlike
  // `test()` above (which only exercises raw URL/webhook connectivity), this
  // reaches the destination's actual endpoint and requires destination write
  // permission.
  testSend: ({ org_identifier, destination_name, data }: any) => {
    return http()
      .post(
        `/api/${org_identifier}/alerts/destinations/${encodeURIComponent(destination_name)}/test_send`,
        data,
      )
      .then((res) => {
        analytics.track("alert_template_test_sent");
        return res;
      });
  },
};

export default destination;
