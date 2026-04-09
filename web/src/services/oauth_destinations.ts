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

export type OAuthProvider = "slack" | "discord" | "pagerduty" | "msteams" | "servicenow";

export interface AvailableResponse {
  enabled: boolean;
  has_channel_picker: boolean;
  display_name: string;
}

export interface StartResponse {
  oauth_url: string;
  state: string;
  connection_id: string;
}

export interface StatusResponse {
  status: "pending" | "complete" | "error";
  team_name?: string;
  team_id?: string;
  error_reason?: string;
  has_channel_picker: boolean;
}

export interface ChannelItem {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
}

export interface ChannelsResponse {
  channels: ChannelItem[];
  truncated: boolean;
}

const oauthDestinations = {
  /**
   * Check whether OAuth is available for this provider on this instance.
   */
  available: (orgId: string, provider: OAuthProvider) => {
    return http().get<AvailableResponse>(
      `/api/${orgId}/oauth/${provider}/available`
    );
  },

  /**
   * Initiate the OAuth flow. Returns the authorization URL and state token.
   * Pass `existingConnectionId` to trigger a reconnect flow.
   */
  start: (
    orgId: string,
    provider: OAuthProvider,
    existingConnectionId?: string
  ) => {
    const params = existingConnectionId
      ? `?existing_connection_id=${encodeURIComponent(existingConnectionId)}`
      : "";
    return http().get<StartResponse>(
      `/api/${orgId}/oauth/${provider}/start${params}`
    );
  },

  /**
   * Poll for the OAuth flow status. Call every 2s after opening the popup.
   */
  status: (orgId: string, provider: OAuthProvider, state: string) => {
    return http().get<StatusResponse>(
      `/api/${orgId}/oauth/${provider}/status?state=${encodeURIComponent(state)}`
    );
  },

  /**
   * List channels for providers with a channel picker (e.g. Slack, Discord).
   * Pass either `state` (create flow) or `connectionId` (edit flow).
   */
  channels: (
    orgId: string,
    provider: OAuthProvider,
    params: { state?: string; connectionId?: string }
  ) => {
    const qs = params.state
      ? `?state=${encodeURIComponent(params.state)}`
      : params.connectionId
        ? `?connection_id=${encodeURIComponent(params.connectionId)}`
        : "";
    return http().get<ChannelsResponse>(
      `/api/${orgId}/oauth/${provider}/channels${qs}`
    );
  },

  /**
   * Send a test notification.
   */
  test: (
    orgId: string,
    provider: OAuthProvider,
    params: { state?: string; connectionId?: string },
    channelId?: string
  ) => {
    const qs = params.state
      ? `?state=${encodeURIComponent(params.state)}`
      : params.connectionId
        ? `?connection_id=${encodeURIComponent(params.connectionId)}`
        : "";
    return http().post(
      `/api/${orgId}/oauth/${provider}/test${qs}`,
      { channel_id: channelId ?? null }
    );
  },
};

export default oauthDestinations;
