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
import OFormCheckboxGroup from '@/lib/forms/Checkbox/OFormCheckboxGroup.vue';
import OCheckbox from '@/lib/forms/Checkbox/OCheckbox.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import { z } from 'zod';

const meta: Meta<typeof OFormCheckboxGroup> = {
  title: 'Forms/OFormCheckboxGroup',
  component: OFormCheckboxGroup,
  tags: ['autodocs'],
  argTypes: {
    name: { control: 'text', description: 'Field name — must match a key in the parent OForm\'s defaultValues' },
    modelValue: { control: false, description: 'Array of currently checked values' },
    disabled: { control: 'boolean', description: 'Disables all checkboxes in the group' },
  },
};

export default meta;
type Story = StoryObj<typeof OFormCheckboxGroup>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFormCheckboxGroup, OCheckbox, OForm },
    setup() {
      const demoSchema = z.object({ demo: z.any() });
      return { args, demoSchema };
    },
    template: `<OForm :schema="demoSchema" class="w-full max-w-md"><OFormCheckboxGroup name="demo" v-bind="args"><OCheckbox value="a" label="Option A" /><OCheckbox value="b" label="Option B" /></OFormCheckboxGroup></OForm>`,
  }),
};
