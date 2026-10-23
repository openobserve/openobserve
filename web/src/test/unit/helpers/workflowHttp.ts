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

import type {
  HttpCredential,
  HttpTriggerAbsent,
  HttpTriggerConfig,
  HttpTriggerPermissions,
} from "@/services/workflows";

export const HTTP_TOKEN = "o2wh_FRESHLYMINTEDTOKENVALUE0000001";
export const HTTP_SECRET = "whsec_FRESHLYMINTEDSECRETVALUE00001";
export const HTTP_ROW_VALUE = "o2wh_ROWVALUEREVEALEDFROMTHETABLE01";
export const HOUR_US = 3_600_000_000;

export const fullPermissions = (): HttpTriggerPermissions => ({
  edit: true,
  test: true,
  reveal: true,
});

export const httpCredential = (over: Partial<HttpCredential> = {}): HttpCredential => ({
  id: "c1",
  kind: "token",
  display_prefix: "o2wh_4fK9…oI4k",
  state: "active",
  expires_at: null,
  created_by: "a@example.com",
  creator_in_org: true,
  created_at: 1_792_575_542_000_000,
  last_used_at: null,
  ...over,
});

export const httpConfig = (over: Partial<HttpTriggerConfig> = {}): HttpTriggerConfig => ({
  configured: true,
  id: "t1",
  url: "https://o2.example.com/api/v2/default/workflows/hooks/t1",
  region_host: null,
  enabled: true,
  auth_mode: "token",
  max_body_bytes: 1_048_576,
  rate_limit_per_minute: 60,
  org_rate_limit_per_minute: 1200,
  created_by: "a@example.com",
  created_at: 1,
  updated_at: 1,
  last_invoked_at: null,
  last_call: null,
  secrets_encrypted_at_rest: true,
  rejections: {},
  credentials: [httpCredential()],
  permissions: fullPermissions(),
  ...over,
});

export const httpAbsent = (over: Partial<HttpTriggerAbsent> = {}): HttpTriggerAbsent => ({
  configured: false,
  org_rate_limit_per_minute: 1200,
  secrets_encrypted_at_rest: true,
  permissions: fullPermissions(),
  ...over,
});

/** Renders the trigger and, while open, the content in place; a trigger click asks to toggle. */
export const OPopoverStub = {
  name: "OPopover",
  props: ["open", "side", "align", "ariaLabel", "contentClass"],
  emits: ["update:open"],
  template: `<div class="o-popover-stub">
    <span class="o-popover-trigger" @click="$emit('update:open', !open)"><slot name="trigger" /></span>
    <div v-if="open" class="o-popover-content"><slot /></div>
  </div>`,
};

export const OSwitchStub = {
  name: "OSwitch",
  props: ["modelValue", "label", "disabled", "size"],
  emits: ["update:modelValue"],
  template: `<button class="o-switch" v-bind="$attrs" :disabled="disabled" :data-value="String(!!modelValue)"
    @click="$emit('update:modelValue', !modelValue)" />`,
};

export const ODrawerStub = {
  name: "ODrawer",
  props: ["open", "size", "title", "subTitle", "side", "persistent"],
  emits: ["update:open"],
  template: `<div class="o-drawer" v-bind="$attrs" :data-open="String(open)">
    <button class="o-drawer-close" @click="$emit('update:open', false)" />
    <slot v-if="open" />
  </div>`,
};

export const RouterLinkStub = {
  name: "RouterLink",
  props: ["to"],
  template: `<a class="router-link" :data-to="JSON.stringify(to)"><slot /></a>`,
};

/** The real tooltip mounts its bubble only on hover; the stub keeps it in the DOM with its text. */
export const OTooltipStub = {
  name: "OTooltip",
  props: ["content", "side", "align", "maxWidth"],
  inheritAttrs: false,
  template: `<span class="o-tooltip-stub" v-bind="$attrs" :data-content="content"><slot /></span>`,
};
