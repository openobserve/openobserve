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
import OPopover from '@/lib/overlay/Popover/OPopover.vue';
import OButton from '@/lib/core/Button/OButton.vue';

const meta: Meta<typeof OPopover> = {
  title: 'Overlay/OPopover',
  component: OPopover,
  tags: ['autodocs'],
  argTypes: {
    open: { control: 'boolean' },
    modal: { control: 'boolean' },
    side: { control: { type: 'select' }, options: ["top","right","bottom","left"] },
    align: { control: { type: 'select' }, options: ["start","center","end"] },
    sideOffset: { control: 'number' },
    hideWhenDetached: { control: 'boolean' },
    ariaLabel: { control: 'text' },
    zIndex: { control: 'number' },
    contentClass: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof OPopover>;

export const Playground: Story = {
  render: (args) => ({
    components: { OPopover, OButton },
    setup() {
      const open = ref(false);
      return { args, open };
    },
    template: `<OButton variant="outline" @click="open = true">Open</OButton><OPopover v-bind="args" :open="open" @update:open="(v) => (open = v)"><div class="p-3 text-sm text-text-secondary">Popover content</div></OPopover>`,
  }),
};
