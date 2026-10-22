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

import { defineComponent } from "vue";
import { createStore } from "vuex";
import { vi } from "vitest";
import type {
  InstallationView,
  LinkingView,
  SlackOrgAccessRow,
  SlackOrgAccessView,
  SlackSettingsExchangeResponse,
} from "@/types/slack";

// Shapes follow the ENT <-> OSS contract in docs/slack-app/PROGRESS-phase1.md (rows 9 and 11).
export const installationView = (over: Partial<InstallationView> = {}): InstallationView => ({
  id: "inst-1",
  app_id: "A0SAMPLE01",
  team_id: "T0SAMPLE01",
  team_name: "Acme Corp",
  enterprise_id: "",
  is_enterprise_install: false,
  mode: "socket",
  home_region: "",
  status: "healthy",
  credentials_readable: true,
  has_config_refresh_token: true,
  app_token_state: "ok",
  this_org: {
    connected_by: "ana@acme.example",
    created_at: 1_760_000_000_000_000,
    destination_count: 4,
  },
  other_connected_orgs: 1,
  health: {
    sockets_up: 2,
    sockets_want: 2,
    nodes: 2,
    last_event_at: 1_760_000_100_000_000,
    as_of: 1_760_000_120_000_000,
  },
  created_at: 1_760_000_000_000_000,
  scope: "org",
  managed: false,
  ...over,
});

/** The instance workspace as `_meta` sees it. */
export const instanceView = (over: Partial<InstallationView> = {}): InstallationView =>
  installationView({ scope: "instance", managed: false, org_access: "listed", ...over });

/** The instance workspace as an org it serves sees it. */
export const managedView = (over: Partial<InstallationView> = {}): InstallationView =>
  installationView({
    scope: "instance",
    managed: true,
    instance_help_contact: "#o2-platform",
    ...over,
  });

const orgAccessRow = (over: Partial<SlackOrgAccessRow> = {}): SlackOrgAccessRow => ({
  org_id: "prod",
  org_name: "prod",
  source: "instance",
  added_by: "ashish@acme.example",
  added_at: 1_760_600_000_000_000,
  channel_defaults: 3,
  links: 31,
  members: 42,
  ...over,
});

/** Row 24 in mockup M1: a listed instance workspace serving `_meta`, prod, staging and payments. */
export const orgAccessView = (over: Partial<SlackOrgAccessView> = {}): SlackOrgAccessView => ({
  all: false,
  orgs: [
    orgAccessRow({
      org_id: "_meta",
      org_name: "_meta",
      source: "org",
      added_at: 1_760_000_000_000_000,
      channel_defaults: 0,
      links: 2,
      members: 4,
    }),
    orgAccessRow(),
    orgAccessRow({
      org_id: "staging",
      org_name: "staging",
      channel_defaults: 1,
      links: 12,
      members: 15,
    }),
    orgAccessRow({
      org_id: "payments",
      org_name: "payments",
      source: "org",
      added_by: "lee@acme.example",
      channel_defaults: 2,
      links: 7,
      members: 9,
    }),
  ],
  other_apps_in_team: [{ installation_id: "inst-labs", org_ids: ["labs"] }],
  organizations: [
    { org_id: "_meta", org_name: "_meta", members: 4 },
    { org_id: "dev", org_name: "dev", members: 18 },
    { org_id: "dev-sandbox", org_name: "dev-sandbox", members: 3 },
    { org_id: "devops", org_name: "devops", members: 9 },
    { org_id: "labs", org_name: "labs", members: 6 },
    { org_id: "payments", org_name: "payments", members: 9 },
    { org_id: "prod", org_name: "prod", members: 42 },
    { org_id: "staging", org_name: "staging", members: 15 },
  ],
  ...over,
});

export const linkingView = (over: Partial<LinkingView> = {}): LinkingView => ({
  enabled: true,
  source: "manual",
  domains: ["acme.example"],
  counts: { email: 31, oidc: 7, admin_bulk: 0, matches_not_linked: 4, skipped_domain: 0 },
  ...over,
});

/** Row 2's settings shape as self-hosted returns it: its app has no incoming webhook, so no destination. */
export const selfHostedSettingsExchange = (
  over: Partial<InstallationView> = {},
): SlackSettingsExchangeResponse => ({
  installation: installationView(over),
  destination: null,
  channel_default_set: false,
  linking: linkingView(),
  link_all: null,
});

export const makeSlackStore = (
  zoConfig: Record<string, unknown> = { slack_enabled: true },
  email = "ana@acme.example",
) =>
  createStore({
    state: {
      selectedOrganization: { identifier: "acme", name: "acme" },
      userInfo: { email },
      currentuser: { email },
      theme: "light",
      zoConfig,
    },
  });

export const axiosError = (status: number, message = "refused") =>
  Object.assign(new Error(message), { response: { status, data: { code: status, message } } });

export const ok = <T>(data: T) => Promise.resolve({ data });

/** Slack's real layouts (xapp-1-<app id>-<digits>-<hex>, xoxe-1-…, xoxe.xoxp-1-…), joined at runtime so secret scanners skip them. */
export const FAKE_APP_ID = "A0FAKEAPP01";
export const FAKE_APP_TOKEN = ["xapp", "1", FAKE_APP_ID, "1000000000000", "f".repeat(64)].join("-");
export const FAKE_CONFIG_REFRESH_TOKEN = ["xoxe", "1", "ZmFrZS1yZWZyZXNoLXRva2Vu"].join("-");
export const FAKE_CONFIG_ACCESS_TOKEN =
  "xoxe." + ["xoxp", "1", "ZmFrZS1hY2Nlc3MtdG9rZW4"].join("-");

/** OTable's cell slots and its state ladder (loading, then forbidden, error or empty), without its layout. */
export const OTableStub = defineComponent({
  name: "OTable",
  props: {
    data: { type: Array, default: () => [] },
    columns: { type: Array, default: () => [] },
    selectedIds: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
    error: { type: String, default: null },
    forbidden: { type: Boolean, default: false },
  },
  emits: ["update:selectedIds"],
  template: `
    <div data-test-stub="otable">
      <div v-if="loading" data-test-stub="otable-loading" />
      <template v-else>
        <div v-for="(row, i) in data" :key="i" data-test-stub="otable-row">
          <span v-for="col in columns" :key="col.id" :data-col="col.id">
            <slot :name="'cell-' + col.id" :row="row">{{ col.accessorKey ? row[col.accessorKey] : '' }}</slot>
          </span>
        </div>
        <div v-if="forbidden && !data.length" data-test-stub="otable-forbidden" />
        <div v-else-if="error" data-test-stub="otable-error"><slot name="error" :message="error" /></div>
        <div v-else-if="!data.length"><slot name="empty" /></div>
      </template>
    </div>`,
});

export const fakePopup = (): Window =>
  ({
    closed: false,
    close: vi.fn(),
    focus: vi.fn(),
    location: { href: "about:blank" },
  }) as unknown as Window;

export const SLACK_OAUTH_MESSAGE = {
  type: "openobserve:slack-oauth",
  code: "temporary-code",
  state: "signed-state",
};

/** Delivers the popup callback the way SlackOAuthCallback.vue posts it. */
export const postCallback = (source: Window, data: unknown = SLACK_OAUTH_MESSAGE) =>
  window.dispatchEvent(
    new MessageEvent("message", { origin: window.location.origin, source, data }),
  );

/** ConfirmDialog without the portal: shows its copy while open and confirms on click. */
export const ConfirmDialogStub = defineComponent({
  name: "ConfirmDialog",
  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: "" },
    message: { type: String, default: "" },
    okLabel: { type: String, default: "" },
  },
  emits: ["update:ok", "update:cancel", "update:modelValue"],
  template: `
    <div v-if="modelValue" data-test-stub="confirm-dialog">
      <span data-test-stub="confirm-title">{{ title }}</span>
      <span data-test-stub="confirm-message">{{ message }}</span>
      <button data-test-stub="confirm-ok" @click="$emit('update:modelValue', false); $emit('update:ok')">{{ okLabel }}</button>
    </div>`,
});
