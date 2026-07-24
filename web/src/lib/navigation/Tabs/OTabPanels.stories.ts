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
import OTabPanels from '@/lib/navigation/Tabs/OTabPanels.vue';
import OTabPanel from '@/lib/navigation/Tabs/OTabPanel.vue';

const meta: Meta<typeof OTabPanels> = {
  title: 'Navigation/Tabs/OTabPanels',
  component: OTabPanels,
  tags: ['autodocs'],
  args: {
    animated: false,
    keepAlive: false,
    grow: false,
    scroll: "none",
  },
  argTypes: {
    animated: { control: 'boolean', description: 'Enables a CSS slide transition between panels' },
    keepAlive: { control: 'boolean', description: 'Keeps all panel DOM alive when switching (avoids remounting)' },
    grow: { control: 'boolean', description: 'Adds flex-1 so panels fill remaining space in a flex parent. Default: false' },
    scroll: { control: { type: 'select' }, options: ["none","auto","y"], description: 'Overflow/scroll behavior of the panels container. Default: \'none\'' },
  },
};

export default meta;
type Story = StoryObj<typeof OTabPanels>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTabPanels, OTabPanel },
    setup() {
      const model = ref('logs');
      return { args, model };
    },
    template: `<OTabPanels v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)"><OTabPanel name="logs"><div class="p-3 text-sm">Logs panel</div></OTabPanel></OTabPanels>`,
  }),
};
