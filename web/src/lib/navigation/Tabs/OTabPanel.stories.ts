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
import OTabPanel from '@/lib/navigation/Tabs/OTabPanel.vue';
import OTabPanels from '@/lib/navigation/Tabs/OTabPanels.vue';

const meta: Meta<typeof OTabPanel> = {
  title: 'Navigation/Tabs/OTabPanel',
  component: OTabPanel,
  tags: ['autodocs'],
  args: {
    padding: "none",
    layout: "block",
    stretch: false,
  },
  argTypes: {
    name: { control: 'text', description: 'Must match the corresponding OTab name. Required.' },
    padding: { control: { type: 'select' }, options: ["none","sm","md"], description: 'Inner padding of the panel content area. Default: \'none\'' },
    layout: { control: { type: 'select' }, options: ["block","flex-col","flex-row"], description: 'Display layout of the panel\'s root element. Default: \'block\'' },
    stretch: { control: 'boolean', description: 'Makes the panel root element fill 100% of parent height. Default: false' },
  },
};

export default meta;
type Story = StoryObj<typeof OTabPanel>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTabPanel, OTabPanels },
    setup() {
      const p_model = ref('logs');
      return { args, p_model };
    },
    template: `<OTabPanels :model-value="p_model" @update:model-value="(v) => (p_model = v)"><OTabPanel v-bind="args" :name="'logs'"><div class="p-3 text-sm">Panel content</div></OTabPanel></OTabPanels>`,
  }),
};
