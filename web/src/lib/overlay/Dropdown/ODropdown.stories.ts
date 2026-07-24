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

import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import ODropdown from '@/lib/overlay/Dropdown/ODropdown.vue';
import ODropdownItem from '@/lib/overlay/Dropdown/ODropdownItem.vue';
import ODropdownSeparator from '@/lib/overlay/Dropdown/ODropdownSeparator.vue';
import OButton from '@/lib/core/Button/OButton.vue';

const meta: Meta<typeof ODropdown> = {
  title: 'Overlay/Dropdown/ODropdown',
  component: ODropdown,
  tags: ['autodocs'],
  args: {
    side: "bottom",
    align: "start",
    persistent: false,
  },
  argTypes: {
    open: { control: 'boolean', description: 'Controlled open state — use with v-model:open' },
    modal: { control: false, description: 'Whether the dropdown blocks interaction with the rest of the page (default: false)' },
    side: { control: { type: 'select' }, options: ["top","right","bottom","left"], description: 'Preferred side to open relative to the trigger' },
    align: { control: { type: 'select' }, options: ["start","center","end"], description: 'Preferred alignment against the trigger' },
    sideOffset: { control: false, description: 'Pixel offset from the trigger' },
    contentClass: { control: 'text', description: 'Extra class(es) for the content (menu) element — e.g. to match trigger width.' },
    persistent: { control: 'boolean', description: 'Outside-click persistence. Controls how many outside-click events must happen before this dropdown actually dismisses: false (default) — close immediately on the first outside click true — never close on outside click (only via trigger / Esc / programmatic) number N >= 1 — require N outside clicks t' },
  },
};

export default meta;
type Story = StoryObj<typeof ODropdown>;

export const Playground: Story = {
  render: (args) => ({
    components: { ODropdown, ODropdownItem, ODropdownSeparator, OButton },
    setup() {
      const open = ref(false);
      return { args, open };
    },
    template: `<OButton variant="outline" @click="open = true">Open</OButton><ODropdown v-bind="args" :open="open" @update:open="(v) => (open = v)"><ODropdownItem>Edit</ODropdownItem><ODropdownSeparator /><ODropdownItem variant="destructive">Delete</ODropdownItem></ODropdown>`,
  }),
};
