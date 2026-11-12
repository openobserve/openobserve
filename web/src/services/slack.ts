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
import type {
  InstallationView,
  LinkingView,
  SlackChannelDefaultRequest,
  SlackChannelDefaultRow,
  SlackChannelDefaultsResponse,
  SlackChannelsParams,
  SlackChannelsResponse,
  SlackConnectionConfirmResponse,
  SlackConnectionStartRequest,
  SlackConnectionStartResponse,
  SlackConnectivityRequest,
  SlackConnectivityResponse,
  SlackConnectRequest,
  SlackConnectResponse,
  SlackCreateInstallationRequest,
  SlackCreateInstallationResponse,
  SlackCredentialsRequest,
  SlackDisconnectResponse,
  SlackHelpContact,
  SlackInsightsSettings,
  SlackInsightsSettingsRequest,
  SlackInstallationsResponse,
  SlackInstallExchangeRequest,
  SlackInstallExchangeResponse,
  SlackInstallStartRequest,
  SlackInstallStartResponse,
  SlackInstallUrlResponse,
  SlackLinkAllResult,
  SlackLinkingUpdateRequest,
  SlackLinkRequestConfirmResponse,
  SlackLinkRequestStartResponse,
  SlackLinksParams,
  SlackLinksResponse,
  SlackManifestParams,
  SlackMyLinksResponse,
  SlackOidcCallbackRequest,
  SlackOncallRemindResponse,
  SlackOncallUnlinkedResponse,
  SlackOrgAccessRequest,
  SlackOrgAccessView,
  SlackPrerequisitesResponse,
  SlackServerManifest,
  SlackSignedRequest,
  SlackTestRequest,
  SlackTestResponse,
  SlackUninstallResponse,
} from "@/types/slack";
export interface SlackRequestOptions {
  silentForbidden?: boolean;
}

// The link pages and the connect proof render every refusal themselves.
const RENDERS_FORBIDDEN: SlackRequestOptions = { silentForbidden: true };

const base = (org: string) => `/api/${encodeURIComponent(org)}/slack`;

const installation = (org: string, id: string) =>
  `${base(org)}/installations/${encodeURIComponent(id)}`;

const definedParams = <T extends object>(params: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== ""),
  ) as Partial<T>;

const slack = {
  installStart: (org: string, body: SlackInstallStartRequest, options?: SlackRequestOptions) =>
    http().post<SlackInstallStartResponse>(`${base(org)}/install/start`, body, options),

  installExchange: (org: string, body: SlackInstallExchangeRequest) =>
    http()
      .post<SlackInstallExchangeResponse>(`${base(org)}/install/exchange`, body)
      .then((res) => {
        analytics.track("slack_app_installed");
        return res;
      }),

  getPrerequisites: (org: string, options?: SlackRequestOptions) =>
    http().get<SlackPrerequisitesResponse>(`${base(org)}/prerequisites`, options),

  checkConnectivity: (org: string, body: SlackConnectivityRequest) =>
    http().post<SlackConnectivityResponse>(`${base(org)}/connectivity`, body),

  getManifest: (org: string, params: SlackManifestParams) =>
    http().get<SlackServerManifest>(`${base(org)}/manifest`, { params }),

  createInstallation: (org: string, body: SlackCreateInstallationRequest) =>
    http()
      .post<SlackCreateInstallationResponse>(`${base(org)}/installations`, body)
      .then((res) => {
        analytics.track("slack_installation_created", {
          mode: body.mode,
          setup: "config_refresh_token" in body ? "token" : "manual",
        });
        return res;
      }),

  getInstallUrl: (org: string, id: string) =>
    http().post<SlackInstallUrlResponse>(`${installation(org, id)}/install-url`),

  updateCredentials: (org: string, id: string, body: SlackCredentialsRequest) =>
    http().put<InstallationView>(`${installation(org, id)}/credentials`, body),

  listInstallations: (org: string, options?: SlackRequestOptions) =>
    http().get<SlackInstallationsResponse>(`${base(org)}/installations`, options),

  testInstallation: (org: string, id: string, body: SlackTestRequest) =>
    http()
      .post<SlackTestResponse>(`${installation(org, id)}/test`, body)
      .then((res) => {
        analytics.track("slack_installation_tested", { with_channel: !!body.channel_id });
        return res;
      }),

  getLinking: (org: string, id: string) =>
    http().get<LinkingView>(`${installation(org, id)}/linking`),

  updateLinking: (org: string, id: string, body: SlackLinkingUpdateRequest) =>
    http()
      .put<LinkingView>(`${installation(org, id)}/linking`, body)
      .then((res) => {
        analytics.track("slack_linking_updated", { enabled: body.enabled });
        return res;
      }),

  linkAll: (org: string, id: string) =>
    http()
      .post<SlackLinkAllResult>(`${installation(org, id)}/link-all`)
      .then((res) => {
        analytics.track("slack_users_bulk_linked", { count: res.data?.linked ?? 0 });
        return res;
      }),

  startConnection: (org: string, id: string, body: SlackConnectionStartRequest) =>
    http().post<SlackConnectionStartResponse>(`${installation(org, id)}/connection/start`, body),

  confirmConnection: (org: string, body: SlackOidcCallbackRequest) =>
    http().post<SlackConnectionConfirmResponse>(
      `${base(org)}/connection/confirm`,
      body,
      RENDERS_FORBIDDEN,
    ),

  connectInstallation: (org: string, id: string, body: SlackConnectRequest) =>
    http()
      .post<SlackConnectResponse>(`${installation(org, id)}/connection`, body)
      .then((res) => {
        analytics.track("slack_installation_connected");
        return res;
      }),

  disconnectInstallation: (org: string, id: string) =>
    http()
      .delete<SlackDisconnectResponse>(`${installation(org, id)}/connection`)
      .then((res) => {
        analytics.track("slack_installation_disconnected");
        return res;
      }),

  uninstallInstallation: (org: string, id: string) =>
    http()
      .delete<SlackUninstallResponse>(installation(org, id))
      .then((res) => {
        analytics.track("slack_app_uninstalled");
        return res;
      }),

  listChannels: (org: string, id: string, params: SlackChannelsParams = {}) =>
    http().get<SlackChannelsResponse>(`${installation(org, id)}/channels`, {
      params: definedParams(params),
    }),

  listChannelDefaults: (org: string, id: string) =>
    http().get<SlackChannelDefaultsResponse>(`${installation(org, id)}/channel-defaults`),

  putChannelDefault: (
    org: string,
    id: string,
    channelId: string,
    body: SlackChannelDefaultRequest,
  ) =>
    // The drawer shows the 403, which names the org whose admin may change the row.
    http()
      .put<SlackChannelDefaultRow>(
        `${installation(org, id)}/channel-defaults/${encodeURIComponent(channelId)}`,
        body,
        RENDERS_FORBIDDEN,
      )
      .then((res) => {
        analytics.track("slack_channel_default_saved");
        return res;
      }),

  deleteChannelDefault: (org: string, id: string, channelId: string) =>
    http()
      .delete<void>(`${installation(org, id)}/channel-defaults/${encodeURIComponent(channelId)}`)
      .then((res) => {
        analytics.track("slack_channel_default_deleted");
        return res;
      }),

  listOncallUnlinked: (org: string, id: string) =>
    http().get<SlackOncallUnlinkedResponse>(`${installation(org, id)}/oncall-unlinked`, {
      silentForbidden: true,
    }),

  remindOncallUnlinked: (org: string, id: string) =>
    http()
      .post<SlackOncallRemindResponse>(`${installation(org, id)}/oncall-unlinked/remind`)
      .then((res) => {
        analytics.track("slack_oncall_reminder_sent", { count: res.data?.sent ?? 0 });
        return res;
      }),

  getHelpContact: (org: string, id: string) =>
    http().get<SlackHelpContact>(`${installation(org, id)}/help-contact`),

  putHelpContact: (org: string, id: string, body: { help_contact: string }) =>
    http().put<SlackHelpContact>(`${installation(org, id)}/help-contact`, body),

  getInsightsSettings: (org: string) =>
    http().get<SlackInsightsSettings>(`${base(org)}/insights-settings`),

  // The AutoObserve section shows every refusal, a 403 included, in its own footer.
  putInsightsSettings: (org: string, body: SlackInsightsSettingsRequest) =>
    http().put<SlackInsightsSettings>(`${base(org)}/insights-settings`, body, RENDERS_FORBIDDEN),

  getOrgAccess: (org: string, id: string) =>
    http().get<SlackOrgAccessView>(`${installation(org, id)}/org-access`),

  putOrgAccess: (org: string, id: string, body: SlackOrgAccessRequest) =>
    http()
      .put<SlackOrgAccessView>(`${installation(org, id)}/org-access`, body)
      .then((res) => {
        analytics.track("slack_org_access_updated");
        return res;
      }),

  previewOrgAccess: (org: string, id: string, body: SlackOrgAccessRequest) =>
    http().put<SlackOrgAccessView>(`${installation(org, id)}/org-access`, {
      ...body,
      preview: true,
    }),

  startLinkRequest: (org: string, requestId: string, body: SlackSignedRequest) =>
    http().post<SlackLinkRequestStartResponse>(
      `${base(org)}/link-requests/${encodeURIComponent(requestId)}/start`,
      body,
      RENDERS_FORBIDDEN,
    ),

  confirmLinkRequest: (org: string, body: SlackOidcCallbackRequest) =>
    http()
      .post<SlackLinkRequestConfirmResponse>(
        `${base(org)}/link-requests/confirm`,
        body,
        RENDERS_FORBIDDEN,
      )
      .then((res) => {
        analytics.track("slack_user_linked");
        return res;
      }),

  resendLinkRequest: (org: string, requestId: string, body: SlackSignedRequest) =>
    http().post<void>(
      `${base(org)}/link-requests/${encodeURIComponent(requestId)}/resend`,
      body,
      RENDERS_FORBIDDEN,
    ),

  getMyLinks: (org: string) => http().get<SlackMyLinksResponse>(`${base(org)}/links/me`),

  deleteLink: (org: string, linkId: string) =>
    http()
      .delete<void>(`${base(org)}/links/${encodeURIComponent(linkId)}`)
      .then((res) => {
        analytics.track("slack_user_unlinked");
        return res;
      }),

  listLinks: (org: string, params: SlackLinksParams = {}) =>
    http().get<SlackLinksResponse>(`${base(org)}/links`, { params: definedParams(params) }),
};

export default slack;
