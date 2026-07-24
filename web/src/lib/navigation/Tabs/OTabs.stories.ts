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
import OTabs from '@/lib/navigation/Tabs/OTabs.vue';
import OTab from '@/lib/navigation/Tabs/OTab.vue';

const meta: Meta<typeof OTabs> = {
  title: 'Navigation/OTabs',
  component: OTabs,
  tags: ['autodocs'],
  args: {
    orientation: "horizontal",
    align: "left",
    dense: false,
    bordered: false,
    reorderable: false,
  },
  argTypes: {
    orientation: { control: { type: 'select' }, options: ["horizontal","vertical"], description: 'Layout direction of the tab bar. Default: \'horizontal\'' },
    align: { control: { type: 'select' }, options: ["left","center","right","justify"], description: 'Alignment of tabs within the tab bar. Default: \'left\'' },
    dense: { control: 'boolean', description: 'Compact height mode (~32px instead of ~40px)' },
    bordered: { control: 'boolean', description: 'Adds a bottom border matching the design-system border color token. Default: false' },
    reorderable: { control: 'boolean', description: 'Enables drag-to-reorder. OTabs only reports the intended move via the reorder event (by tab name); the parent owns the tab list/order and is responsible for applying it. Default: false' },
  },
};

export default meta;
type Story = StoryObj<typeof OTabs>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTabs, OTab },
    setup() {
      const model = ref('logs');
      return { args, model };
    },
    template: `<OTabs v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)"><OTab name="logs" label="Logs" /><OTab name="metrics" label="Metrics" /></OTabs>`,
  }),
};
