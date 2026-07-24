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
import OFormCheckbox from '@/lib/forms/Checkbox/OFormCheckbox.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import { z } from 'zod';

const meta: Meta<typeof OFormCheckbox> = {
  title: 'Forms/Checkbox/OFormCheckbox',
  component: OFormCheckbox,
  tags: ['autodocs'],
  argTypes: {
    name: { control: 'text', description: 'Field name — must match a key in the parent OForm\'s defaultValues' },
    value: { control: false, description: 'Value used when this checkbox is a member of an OCheckboxGroup. When set and a group context is present, modelValue is ignored in favour of the group\'s checked-values array.' },
    val: { control: false, description: 'Compatibility alias for value' },
    label: { control: 'text', description: 'Accessible label rendered next to the checkbox' },
    size: { control: { type: 'select' }, options: ["xs","sm","md"], description: 'Control size' },
    trueValue: { control: false, description: 'Value to emit when checked in custom-value mode' },
    falseValue: { control: false, description: 'Value to emit when unchecked in custom-value mode' },
    indeterminateValue: { control: false, description: 'Value to emit in indeterminate state in custom-value mode' },
    color: { control: { type: 'select' }, options: ["primary","negative"], description: 'Colour scheme — "primary" (default blue) or "negative" (red/error)' },
    disabled: { control: 'boolean', description: 'Prevents interaction' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    id: { control: 'text', description: 'HTML id — forwarded to the native input for external label association' },
  },
};

export default meta;
type Story = StoryObj<typeof OFormCheckbox>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFormCheckbox, OForm },
    setup() {
      const demoSchema = z.object({ demo: z.any() });
      return { args, demoSchema };
    },
    template: `<OForm :schema="demoSchema" class="w-full max-w-md"><OFormCheckbox name="demo" :label="'Accept terms'" v-bind="args"></OFormCheckbox></OForm>`,
  }),
};
