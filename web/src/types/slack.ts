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

import type { SlackOAuthConnection } from "@/services/alert_destination";

// Wire values of the snake_case enums in src/config/src/meta/slack.rs.

export type SlackMode = "http" | "socket";

export type SlackLinkMethod = "oidc" | "email" | "admin_bulk";

export type SlackAnswerMode = "thread" | "private";

export type SlackSetFrom = "settings" | "install" | "destination";

export type SlackDisabledReason = "edition" | "flag" | "master_key" | "super_cluster";

export type SlackInstallationStatus = "pending" | "revoked" | "degraded" | "healthy";

export type SlackAppTokenState = "not_applicable" | "missing" | "ok" | "revoked";

export type SlackLinkingSource = "mapping" | "manual";

export type SlackInstallScope = "org" | "instance";

/** `""` on org workspaces; an instance workspace is `all` or `listed`. */
export type SlackOrgAccessMode = "" | "all" | "listed";

export type SlackConnectionSource = "org" | "instance";

/** `reinstall` refreshes the bot token and scopes only: no destination and no channel default. */
export type SlackInstallSource = "destination_form" | "settings" | "upgrade_banner" | "reinstall";

export type SlackConnectionPurpose = "connect" | "test";

export type SlackCheckStatus = "pass" | "fail" | "warn";

/** The Slack fields of the org-scoped `GET /api/{org}/config` response (`zoConfig`). */
export interface SlackOrgConfig {
  slack_enabled?: boolean;
  slack_disabled_reason?: SlackDisabledReason | null;
}

/** O2's error body for every `/api/{org}/slack/*` refusal. */
export interface SlackApiError {
  code: number;
  message: string;
  error_detail?: string;
  hint?: string;
}

export interface SlackThisOrgConnection {
  connected_by: string;
  created_at: number;
  destination_count: number;
}

export interface SlackInstallationHealth {
  sockets_up: number;
  sockets_want: number;
  nodes: number;
  last_event_at: number | null;
  as_of: number | null;
  /** Alert messages waiting on the outbound queue; absent before the server sends it. */
  outbound_depth?: number;
  outbound_oldest_age_secs?: number | null;
}

export interface InstallationView {
  id: string;
  app_id: string;
  team_id: string;
  team_name: string;
  enterprise_id: string;
  is_enterprise_install: boolean;
  mode: SlackMode;
  home_region: string;
  status: SlackInstallationStatus;
  credentials_readable: boolean;
  has_config_refresh_token: boolean;
  app_token_state: SlackAppTokenState;
  this_org: SlackThisOrgConnection;
  other_connected_orgs: number;
  health: SlackInstallationHealth;
  created_at: number;
  scope: SlackInstallScope;
  managed: boolean;
  org_access?: SlackOrgAccessMode;
  instance_help_contact?: string;
}

export interface SlackLinkingSummary {
  enabled: boolean;
  source: SlackLinkingSource;
  domains: string[];
}

/** Form-path install result: only what the "Link people automatically" banner needs. */
export interface InstallationSummary {
  id: string;
  team_name: string;
  status: SlackInstallationStatus;
  linking: SlackLinkingSummary;
}

/** Counts cover only members of the calling org. */
export interface LinkCounts {
  email: number;
  oidc: number;
  admin_bulk: number;
  matches_not_linked: number;
  skipped_domain: number;
}

export interface LinkingView {
  enabled: boolean;
  source: SlackLinkingSource;
  domains: string[];
  counts: LinkCounts;
  /** Under a mapping, the installation's manual list; it governs only orgs without a mapping. */
  manual_domains?: string[];
}

export interface SlackDestinationRef {
  id: string;
  name: string;
  /** An instance-workspace uninstall from `_meta` lists every served org's destinations. */
  org_id: string;
}

export interface SlackCreatedDestination {
  id: string;
  name: string;
  channel: string;
  channel_id: string;
}

export interface SlackInstallStartRequest {
  source: SlackInstallSource;
  /** The Slack app form only: the exchange creates the destination; the webhook tile saves its own. */
  create_destination?: boolean;
}

export interface SlackInstallStartResponse {
  authorization_url: string;
}

export interface SlackInstallExchangeRequest {
  code: string;
  state: string;
}

export interface SlackLinkAllResult {
  linked: number;
  complete: boolean;
}

/** The workspace is connected but the channel needs a confirm (MK-7, MK-20) the form asks for. */
export interface SlackDestinationRefusal {
  code: string;
  message: string;
  team?: string;
  destination?: string;
  channel: string;
  channel_id: string;
}

/** `source: destination_form`: today's camelCase webhook fields, so `applyConnection` keeps working. */
export interface SlackFormExchangeResponse extends SlackOAuthConnection {
  installation: InstallationSummary;
  destination: SlackCreatedDestination | null;
  channel_default_set: boolean;
  destination_refusal?: SlackDestinationRefusal;
}

/** `source: settings` or `upgrade_banner`; `destination` is null on self-hosted, whose app has no incoming webhook. */
export interface SlackSettingsExchangeResponse {
  installation: InstallationView;
  destination: SlackCreatedDestination | null;
  destination_refusal?: SlackDestinationRefusal;
  channel_default_set: boolean;
  linking: LinkingView;
  link_all: SlackLinkAllResult | null;
}

export interface SlackAlreadyInstalled {
  installation_id: string;
  team_name: string;
  this_org_connected: false;
}

/** The team is installed and this org is not connected; the form path also carries the webhook fields. */
export interface SlackAlreadyInstalledResponse extends Partial<SlackOAuthConnection> {
  already_installed: SlackAlreadyInstalled;
  connect_ticket: string;
}

export type SlackInstallExchangeResponse =
  SlackFormExchangeResponse | SlackSettingsExchangeResponse | SlackAlreadyInstalledResponse;

/** What the page confirms right after an install or connect, before it shows the workspace. */
export interface SlackInstallConfirmation {
  team: string;
  destination: SlackCreatedDestination | null;
  linking: LinkingView | null;
  linkAll: SlackLinkAllResult | null;
}

export type SlackPrerequisiteId = "master_key" | "delegation_key" | "web_url" | "agent";

export interface SlackPrerequisiteCheck {
  id: SlackPrerequisiteId;
  status: SlackCheckStatus;
  detail: string;
  variable: string | null;
  fix: string | null;
}

export interface SlackPrerequisitesResponse {
  checks: SlackPrerequisiteCheck[];
}

export interface SlackConnectivityRequest {
  installation_id?: string;
}

export interface SlackConnectivityCheck {
  host: string;
  status: SlackCheckStatus;
  detail: string;
}

export interface SlackConnectivityResponse {
  checks: SlackConnectivityCheck[];
  proxy: string | null;
  ca_bundle: string | null;
  socket_url_host: string | null;
}

export interface SlackManifestParams {
  mode: SlackMode;
  name?: string;
  channel_history?: boolean;
}

/** The server-built manifest (section 8.2); only its outer shape is relied on. */
export interface SlackServerManifest {
  display_information?: { name?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface SlackCreateFromTokenRequest {
  mode: SlackMode;
  config_refresh_token: string;
  app_name?: string;
  channel_history?: boolean;
}

/** Set up manually; `signing_secret` is required for HTTP mode. */
export interface SlackCreateManualRequest {
  mode: SlackMode;
  client_id: string;
  client_secret: string;
  signing_secret?: string;
  app_token?: string;
}

export type SlackCreateInstallationRequest = SlackCreateFromTokenRequest | SlackCreateManualRequest;

export interface SlackCreateInstallationResponse {
  installation: InstallationView;
  authorize_url: string;
  app_settings_url: string;
  manifest_page_url?: string;
}

export interface SlackInstallUrlResponse {
  authorize_url: string;
}

/** `config_refresh_token: null` is Forget: it drops O2's copy only. */
export interface SlackCredentialsRequest {
  app_token?: string;
  signing_secret?: string;
  client_id?: string;
  client_secret?: string;
  config_refresh_token?: string | null;
}

export interface SlackAvailableInstallation {
  installation_id: string;
  team_name: string;
}

export interface SlackUpgradeCandidate {
  team_id: string;
  team_name: string;
  destinations: SlackDestinationRef[];
}

/** The instance workspace that does not serve this org. */
export interface SlackInstanceNotice {
  installation_id: string;
  team_name: string;
  help_contact: string | null;
}

export interface SlackInstallationsResponse {
  installations: InstallationView[];
  available?: SlackAvailableInstallation[];
  upgrade_candidates?: SlackUpgradeCandidate[];
  instance?: SlackInstanceNotice;
}

export interface SlackOrgAccessRow {
  org_id: string;
  org_name: string;
  source: SlackConnectionSource;
  added_by: string;
  added_at: number;
  channel_defaults: number;
  links: number;
  members: number;
}

export interface SlackOrgOption {
  org_id: string;
  org_name: string;
  members: number;
}

/** What a save removes from one org; `channels` names its removed channel defaults. */
export interface SlackOrgRemoval {
  org_id: string;
  org_name: string;
  channels: string[];
  links_moving: number;
  links_unlinked: number;
}

export interface SlackOtherApp {
  installation_id: string;
  org_ids: string[];
}

/** Row 24; `organizations` is every org on the server, sorted by name. */
export interface SlackOrgAccessView {
  all: boolean;
  orgs: SlackOrgAccessRow[];
  other_apps_in_team: SlackOtherApp[];
  organizations: SlackOrgOption[];
  removed?: SlackOrgRemoval[];
}

/** Exactly one of `all: true` or `orgs`; `preview` writes nothing. */
export interface SlackOrgAccessRequest {
  all?: boolean;
  orgs?: string[];
  preview?: boolean;
}

export interface SlackTakeOverCandidate {
  installation_id: string;
  team_name: string;
  org_ids: string[];
}

export interface SlackTestRequest {
  channel_id?: string;
}

export type SlackTestCheckId = "auth_test" | "last_event" | "sockets" | "agent";

export interface SlackTestCheck {
  id: SlackTestCheckId;
  status: SlackCheckStatus;
  detail: string;
}

export interface SlackTestPost {
  status: SlackCheckStatus;
  detail: string;
}

/** `verify_url`: HTTP mode only, the app's App Manifest page while Slack waits for a Verify click. */
export interface SlackTestResponse {
  checks: SlackTestCheck[];
  test_post: SlackTestPost | null;
  verify_url?: string;
}

export interface SlackLinkingUpdateRequest {
  enabled: boolean;
  domains?: string[];
}

export interface SlackLinkMatch {
  slack_user_id: string;
  name: string;
  email: string;
  o2_user: string;
}

export interface SlackLinkMatchesResponse {
  members: SlackLinkMatch[];
  next_cursor: string | null;
}

export interface SlackConnectionStartRequest {
  purpose: SlackConnectionPurpose;
}

export interface SlackConnectionStartResponse {
  url: string;
}

export interface SlackOidcCallbackRequest {
  oidc_code: string;
  oidc_state: string;
}

export type SlackConnectionConfirmResponse = { connected: true } | { test: "pass" };

export interface SlackConnectRequest {
  connect_ticket: string;
}

export interface SlackConnectResponse {
  connected: true;
  destination: SlackCreatedDestination | null;
  destination_refusal?: SlackDestinationRefusal;
  channel_default_set: boolean;
}

export interface SlackDisconnectResponse {
  stopped_destinations: SlackDestinationRef[];
}

export interface SlackUninstallAffected {
  orgs: number;
  destinations: SlackDestinationRef[];
  links_revoked: number;
}

/** `delete_app_url` is self-hosted only; Cloud never calls `apps.uninstall`. */
export interface SlackUninstallResponse {
  revoked: true;
  affected: SlackUninstallAffected;
  delete_app_url?: string | null;
  /** Start over only: false when Slack kept the app O2 created, with Slack's reason. */
  app_deleted?: boolean | null;
  app_delete_error?: string | null;
}

export interface SlackChannelsParams {
  q?: string;
  cursor?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  is_shared: boolean;
  /** Slack Connect: people outside the workspace are in it (conversations.info). */
  is_ext_shared?: boolean;
}

export interface SlackChannelsResponse {
  channels: SlackChannel[];
  next_cursor: string | null;
}

export interface SlackChannelDefaultRow {
  channel_id: string;
  channel_name: string;
  answer_mode: SlackAnswerMode;
  set_from: SlackSetFrom;
  set_by_this_org: boolean;
  /** Only a `_meta` viewer of an instance workspace learns the owning org. */
  org_id?: string;
  org_name?: string;
}

/** An on-call schedule member with no Slack link, and the pre-shift DM sent to them. */
export interface SlackOncallUnlinkedMember {
  email: string;
  team_id: string;
  team_name: string;
  next_shift_at: number | null;
  reminded_at: number | null;
}

export interface SlackOncallUnlinkedResponse {
  members: SlackOncallUnlinkedMember[];
}

export interface SlackOncallRemindResponse {
  sent: number;
}

export interface SlackChannelDefaultsResponse {
  defaults: SlackChannelDefaultRow[];
}

export interface SlackChannelDefaultRequest {
  org_id: string;
  answer_mode: SlackAnswerMode;
}

export interface SlackHelpContact {
  help_contact: string | null;
}

export interface SlackSignedRequest {
  sig: string;
}

export interface SlackLinkRequestPreview {
  question_preview: string;
  channel_name: string;
  team_name: string;
}

export interface SlackLinkRequestStartResponse {
  url: string;
  request: SlackLinkRequestPreview;
  help_contact: string | null;
}

export interface SlackLinkRequestConfirmResponse {
  linked_as: string;
  org_id: string;
  orgs: string[];
  return_url: string;
}

export interface SlackMyLink {
  id: string;
  team_name: string;
  slack_display_name: string;
  default_org_id: string;
  link_method: SlackLinkMethod;
  created_at: number;
  last_used_at: number;
}

export interface SlackMyLinksResponse {
  links: SlackMyLink[];
}

/** One row of the admin link list (`links::AdminLinkView`): it never names another org. */
export interface SlackAdminLink {
  id: string;
  slack_user_id: string;
  user_email: string;
  link_method: SlackLinkMethod;
  created_at: number;
  last_used_at: number;
  default_org_is_this_org: boolean;
}

export interface SlackLinksParams {
  installation_id?: string;
  cursor?: string;
}

export interface SlackLinksResponse {
  links: SlackAdminLink[];
  next_cursor: string | null;
}
