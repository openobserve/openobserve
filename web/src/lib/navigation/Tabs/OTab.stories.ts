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
import OTab from '@/lib/navigation/Tabs/OTab.vue';
import OTabs from '@/lib/navigation/Tabs/OTabs.vue';

const meta: Meta<typeof OTab> = {
  title: 'Navigation/Tabs/OTab',
  component: OTab,
  tags: ['autodocs'],
  args: {
    disable: false,
  },
  argTypes: {
    name: { control: 'text', description: 'Unique identifier — must match the corresponding OTabPanel name' },
    label: { control: 'text', description: 'Display text label' },
    icon: { control: 'text', description: 'Material icon name shown before the label' },
    disable: { control: 'boolean', description: 'Prevents interaction with this tab' },
    tooltip: { control: 'text', description: 'Tooltip shown on hover — especially useful when disable is true to explain why' },
  },
};

export default meta;
type Story = StoryObj<typeof OTab>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTab, OTabs },
    setup() {
      const p_model = ref('logs');
      return { args, p_model };
    },
    template: `<OTabs :model-value="p_model" @update:model-value="(v) => (p_model = v)"><OTab v-bind="args" :name="'logs'" :label="'Logs'">{{ args.default }}</OTab></OTabs>`,
  }),
};
