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
import OSelectItem from '@/lib/forms/Select/OSelectItem.vue';
import OSelect from '@/lib/forms/Select/OSelect.vue';

const meta: Meta<typeof OSelectItem> = {
  title: 'Forms/Select/OSelectItem',
  component: OSelectItem,
  tags: ['autodocs'],
  args: {
    disabled: false,
  },
  argTypes: {
    value: { control: false, description: 'The value emitted when this item is selected' },
    label: { control: 'text', description: 'Display label' },
    disabled: { control: 'boolean', description: 'Prevents selection' },
  },
};

export default meta;
type Story = StoryObj<typeof OSelectItem>;

export const Playground: Story = {
  render: (args) => ({
    components: { OSelectItem, OSelect },
    setup() {
      const p_model = ref(null);
      return { args, p_model };
    },
    template: `<OSelect :model-value="p_model" @update:model-value="(v) => (p_model = v)"><OSelectItem v-bind="args" :value="'a'" :label="'Option A'">{{ args.default }}</OSelectItem></OSelect>`,
  }),
};
