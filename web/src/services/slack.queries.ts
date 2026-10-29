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

import { infiniteQueryOptions, mutationOptions, queryOptions } from "@tanstack/vue-query";
import slack, { type SlackRequestOptions } from "./slack";
import { slackKeys } from "./slack.querykeys";
import { destinationKeys } from "./alert_destination.querykeys";
import {
  LIVE_STALE_TIME,
  MEDIUM_STALE_TIME,
  NORMAL_STALE_TIME,
} from "@/composables/query/cachePolicy";
import type {
  SlackChannelDefaultRequest,
  SlackConnectionPurpose,
  SlackConnectRequest,
  SlackConnectivityRequest,
  SlackCreateInstallationRequest,
  SlackCredentialsRequest,
  SlackInstallExchangeRequest,
  SlackInstallSource,
  SlackInstallStartRequest,
  SlackLinkingUpdateRequest,
  SlackManifestParams,
  SlackOidcCallbackRequest,
  SlackOrgAccessRequest,
  SlackTestRequest,
} from "@/types/slack";

const nextCursor = (last: { next_cursor: string | null }) => last.next_cursor || undefined;

/** Settings renders a 403 as its no-access state; only background callers pass `silentForbidden`. */
export const slackInstallationsQuery = (org: string, options?: SlackRequestOptions) =>
  queryOptions({
    queryKey: slackKeys.installations(org),
    queryFn: async () => (await slack.listInstallations(org, options)).data,
    // Carries the socket health record, which goes stale long before a settings read would.
    staleTime: LIVE_STALE_TIME,
  });

export const slackPrerequisitesQuery = (org: string) =>
  queryOptions({
    queryKey: slackKeys.prerequisites(org),
    queryFn: async () => (await slack.getPrerequisites(org)).data,
    // The admin fixes a variable and restarts, then comes back expecting the new result.
    staleTime: LIVE_STALE_TIME,
  });

export const slackManifestQuery = (org: string, params: SlackManifestParams) =>
  queryOptions({
    queryKey: slackKeys.manifest(org, params),
    queryFn: async () => (await slack.getManifest(org, params)).data,
    staleTime: NORMAL_STALE_TIME,
  });

export const slackLinkingQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: slackKeys.linking(org, id),
    queryFn: async () => (await slack.getLinking(org, id)).data,
    // Link all keeps linking in the background, so the counts move under an open page.
    staleTime: LIVE_STALE_TIME,
  });

export const slackChannelsQuery = (org: string, id: string, q: string) =>
  infiniteQueryOptions({
    queryKey: slackKeys.channels(org, id, q),
    queryFn: async ({ pageParam }) =>
      (await slack.listChannels(org, id, { q, cursor: pageParam })).data,
    initialPageParam: "",
    getNextPageParam: nextCursor,
    // The server caches conversations.list for five minutes.
    staleTime: MEDIUM_STALE_TIME,
  });

export const slackChannelDefaultsQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: slackKeys.channelDefaults(org, id),
    queryFn: async () => (await slack.listChannelDefaults(org, id)).data,
    staleTime: NORMAL_STALE_TIME,
  });

export const slackOncallUnlinkedQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: slackKeys.oncallUnlinked(org, id),
    queryFn: async () => (await slack.listOncallUnlinked(org, id)).data,
    staleTime: NORMAL_STALE_TIME,
  });

export const slackHelpContactQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: slackKeys.helpContact(org, id),
    queryFn: async () => (await slack.getHelpContact(org, id)).data,
    staleTime: NORMAL_STALE_TIME,
  });

export const slackOrgAccessQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: slackKeys.orgAccess(org, id),
    queryFn: async () => (await slack.getOrgAccess(org, id)).data,
    staleTime: NORMAL_STALE_TIME,
  });

export const slackLinksQuery = (org: string, installationId?: string) =>
  infiniteQueryOptions({
    queryKey: slackKeys.links(org, installationId),
    queryFn: async ({ pageParam }) =>
      (await slack.listLinks(org, { installation_id: installationId, cursor: pageParam })).data,
    initialPageParam: "",
    getNextPageParam: nextCursor,
    staleTime: NORMAL_STALE_TIME,
  });

export const slackMyLinksQuery = (org: string) =>
  queryOptions({
    queryKey: slackKeys.linksMe(org),
    queryFn: async () => (await slack.getMyLinks(org)).data,
    staleTime: NORMAL_STALE_TIME,
  });

// The popup composable toasts start and exchange failures itself.
export const installStartMutation = (org: string, options?: SlackRequestOptions) =>
  mutationOptions({
    mutationFn: async (body: SlackInstallSource | SlackInstallStartRequest) =>
      (await slack.installStart(org, typeof body === "string" ? { source: body } : body, options))
        .data,
    meta: { silentError: true },
  });

// Install creates or connects the workspace and, off the form path, a destination.
export const installExchangeMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: SlackInstallExchangeRequest) =>
      (await slack.installExchange(org, body)).data,
    meta: { invalidates: [slackKeys.all(org), destinationKeys.all(org)], silentError: true },
  });

export const checkConnectivityMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: SlackConnectivityRequest) =>
      (await slack.checkConnectivity(org, body)).data,
    meta: {},
  });

export const createInstallationMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: SlackCreateInstallationRequest) =>
      (await slack.createInstallation(org, body)).data,
    meta: { invalidates: [slackKeys.all(org)] },
  });

export const installUrlMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (installationId: string) =>
      (await slack.getInstallUrl(org, installationId)).data,
    meta: { silentError: true },
  });

export const updateCredentialsMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: async (body: SlackCredentialsRequest) =>
      (await slack.updateCredentials(org, id, body)).data,
    meta: { invalidates: [slackKeys.installations(org), slackKeys.installation(org, id)] },
  });

export const testInstallationMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: async (body: SlackTestRequest) =>
      (await slack.testInstallation(org, id, body)).data,
    meta: {},
  });

export const updateLinkingMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: async (body: SlackLinkingUpdateRequest) =>
      (await slack.updateLinking(org, id, body)).data,
    meta: { invalidates: [slackKeys.installation(org, id), slackKeys.linkLists(org)] },
  });

export const linkAllMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: async () => (await slack.linkAll(org, id)).data,
    meta: { invalidates: [slackKeys.installation(org, id), slackKeys.linkLists(org)] },
  });

export const startConnectionMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: { installationId: string; purpose: SlackConnectionPurpose }) =>
      (await slack.startConnection(org, vars.installationId, { purpose: vars.purpose })).data,
    meta: { silentError: true },
  });

// Used by the popup and by the callback page, which both render the failure themselves.
export const confirmConnectionMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: SlackOidcCallbackRequest) =>
      (await slack.confirmConnection(org, body)).data,
    meta: { invalidates: [slackKeys.all(org)], silentError: true },
  });

export const connectInstallationMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: { installationId: string; body: SlackConnectRequest }) =>
      (await slack.connectInstallation(org, vars.installationId, vars.body)).data,
    meta: { invalidates: [slackKeys.all(org), destinationKeys.all(org)] },
  });

export const disconnectInstallationMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (installationId: string) =>
      (await slack.disconnectInstallation(org, installationId)).data,
    meta: { invalidates: [slackKeys.all(org), destinationKeys.all(org)] },
  });

export const uninstallInstallationMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (installationId: string) =>
      (await slack.uninstallInstallation(org, installationId)).data,
    meta: { invalidates: [slackKeys.all(org), destinationKeys.all(org)] },
  });

// The drawer renders the refusal in place.
export const putChannelDefaultMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: async (vars: { channelId: string; body: SlackChannelDefaultRequest }) =>
      (await slack.putChannelDefault(org, id, vars.channelId, vars.body)).data,
    meta: { invalidates: [slackKeys.channelDefaults(org, id)], silentError: true },
  });

export const deleteChannelDefaultMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: async (channelId: string) => {
      await slack.deleteChannelDefault(org, id, channelId);
    },
    meta: { invalidates: [slackKeys.channelDefaults(org, id)] },
  });

export const putHelpContactMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: async (helpContact: string) =>
      (await slack.putHelpContact(org, id, { help_contact: helpContact })).data,
    meta: { invalidates: [slackKeys.helpContact(org, id)] },
  });

export const putOrgAccessMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: async (body: SlackOrgAccessRequest) =>
      (await slack.putOrgAccess(org, id, body)).data,
    meta: { invalidates: [slackKeys.orgAccess(org, id), slackKeys.installations(org)] },
  });

// A preview writes nothing, so no cached entry goes stale.
export const previewOrgAccessMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: async (body: SlackOrgAccessRequest) =>
      (await slack.previewOrgAccess(org, id, body)).data,
    meta: {},
  });

// The link pages map every refusal status to their own state message.
export const startLinkRequestMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: { requestId: string; sig: string }) =>
      (await slack.startLinkRequest(org, vars.requestId, { sig: vars.sig })).data,
    meta: { silentError: true },
  });

export const confirmLinkRequestMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: SlackOidcCallbackRequest) =>
      (await slack.confirmLinkRequest(org, body)).data,
    meta: { invalidates: [slackKeys.linksMe(org)], silentError: true },
  });

export const resendLinkRequestMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: { requestId: string; sig: string }) => {
      await slack.resendLinkRequest(org, vars.requestId, { sig: vars.sig });
    },
    meta: { silentError: true },
  });

export const deleteLinkMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (linkId: string) => {
      await slack.deleteLink(org, linkId);
    },
    meta: { invalidates: [slackKeys.all(org)] },
  });

export const remindOncallUnlinkedMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: async () => (await slack.remindOncallUnlinked(org, id)).data,
    meta: { invalidates: [slackKeys.oncallUnlinked(org, id)], silentError: true },
  });
