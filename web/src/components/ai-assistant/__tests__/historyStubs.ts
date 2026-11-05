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

import type { HistoryRow } from "@/composables/assistant";
import { raw } from "@/types/i18n";

/** Menus and overlays render inline so specs read items without driving reka's pointer events. */
export const historyStubs = {
  ODropdown: { template: '<div><slot name="trigger" /><div role="menu"><slot /></div></div>' },
  ODropdownItem: {
    props: ["iconLeft", "variant", "shortcutId"],
    emits: ["select"],
    template:
      '<div role="menuitem" v-bind="$attrs" :data-variant="variant" @click="$emit(\'select\', $event)"><slot /></div>',
  },
  ODropdownSub: {
    props: ["textValue"],
    template: '<div role="group"><slot name="trigger" /><slot /></div>',
  },
  ODropdownSeparator: { template: "<hr />" },
  OContextMenu: {
    props: ["disabled"],
    template: '<div class="contents"><slot name="trigger" /></div>',
  },
  OContextMenuItem: { template: "<span />" },
  OContextMenuSeparator: { template: "<span />" },
  OPopover: {
    props: ["open"],
    emits: ["update:open"],
    template:
      '<div><span @click="$emit(\'update:open\', !open)"><slot name="trigger" /></span><div v-if="open" data-stub="popover"><slot /></div></div>',
  },
  ODrawer: {
    props: ["open"],
    template: '<div v-if="open" data-stub="drawer"><slot /></div>',
  },
  ODialog: {
    props: ["open", "title", "primaryButtonLabel", "secondaryButtonLabel", "primaryButtonDisabled"],
    emits: ["update:open", "click:primary", "click:secondary"],
    template: `<div v-if="open" role="dialog" v-bind="$attrs">
      <h2>{{ title }}</h2><slot />
      <button data-stub="secondary" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
      <button data-stub="primary" :disabled="primaryButtonDisabled" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
    </div>`,
  },
};

export function historyRow(over: Partial<HistoryRow> = {}): HistoryRow {
  return {
    sid: "0190a1b2-c3d4-7e5f-8a9b-00000000000a",
    chatId: 10,
    title: raw("Checkout 5xx spike"),
    titleSource: "generated",
    createdAt: Date.UTC(2026, 9, 21, 9, 0),
    updatedAt: Date.UTC(2026, 9, 21, 9, 30),
    origin: "none",
    originContainer: "sidebar",
    pinned: false,
    activeTurn: false,
    pendingApproval: false,
    share: null,
    local: false,
    ephemeral: false,
    agentType: null,
    ...over,
  };
}
