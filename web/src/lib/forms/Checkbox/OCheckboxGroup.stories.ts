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
import OCheckboxGroup from '@/lib/forms/Checkbox/OCheckboxGroup.vue';
import OCheckbox from '@/lib/forms/Checkbox/OCheckbox.vue';

const meta: Meta<typeof OCheckboxGroup> = {
  title: 'Forms/OCheckboxGroup',
  component: OCheckboxGroup,
  tags: ['autodocs'],
  args: {
    disabled: false,
  },
  argTypes: {
    disabled: { control: 'boolean', description: 'Disables all checkboxes in the group' },
  },
};

export default meta;
type Story = StoryObj<typeof OCheckboxGroup>;

export const Playground: Story = {
  render: (args) => ({
    components: { OCheckboxGroup, OCheckbox },
    setup() {
      const model = ref([]);
      return { args, model };
    },
    template: `<OCheckboxGroup v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)"><OCheckbox value="a" label="Option A" /><OCheckbox value="b" label="Option B" /></OCheckboxGroup>`,
  }),
};
