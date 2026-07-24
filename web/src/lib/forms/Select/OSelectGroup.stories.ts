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
import OSelectGroup from '@/lib/forms/Select/OSelectGroup.vue';
import OSelectItem from '@/lib/forms/Select/OSelectItem.vue';
import OSelect from '@/lib/forms/Select/OSelect.vue';

const meta: Meta<typeof OSelectGroup> = {
  title: 'Forms/Select/OSelectGroup',
  component: OSelectGroup,
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text', description: 'Visible heading above the group' },
  },
};

export default meta;
type Story = StoryObj<typeof OSelectGroup>;

export const Playground: Story = {
  render: (args) => ({
    components: { OSelectGroup, OSelectItem, OSelect },
    setup() {
      return { args };
    },
    template: `<OSelect :modelValue="null"><OSelectGroup v-bind="args" :label="'Group'"><OSelectItem value="a" label="A" /></OSelectGroup></OSelect>`,
  }),
};
