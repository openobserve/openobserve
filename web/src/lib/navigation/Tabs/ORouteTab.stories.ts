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
import ORouteTab from '@/lib/navigation/Tabs/ORouteTab.vue';
import OTabs from '@/lib/navigation/Tabs/OTabs.vue';

const meta: Meta<typeof ORouteTab> = {
  title: 'Navigation/ORouteTab',
  component: ORouteTab,
  tags: ['autodocs'],
  args: {
    disable: false,
  },
  argTypes: {
    name: { control: 'text', description: 'Unique identifier — must match v-model value on OTabs' },
    label: { control: 'text', description: 'Display text label' },
    icon: { control: 'text', description: 'Material icon name' },
    to: { control: false, description: 'Route to navigate to when clicked' },
    disable: { control: 'boolean', description: 'Prevents interaction' },
  },
};

export default meta;
type Story = StoryObj<typeof ORouteTab>;

export const Playground: Story = {
  render: (args) => ({
    components: { ORouteTab, OTabs },
    setup() {
      const p_model = ref('logs');
      return { args, p_model };
    },
    template: `<OTabs :model-value="p_model" @update:model-value="(v) => (p_model = v)"><ORouteTab v-bind="args" :name="'logs'" :label="'Logs'" :to="'/'">{{ args.default }}</ORouteTab></OTabs>`,
  }),
};
