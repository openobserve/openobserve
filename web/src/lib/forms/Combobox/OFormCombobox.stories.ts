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
import OFormCombobox from '@/lib/forms/Combobox/OFormCombobox.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import { z } from 'zod';

const meta: Meta<typeof OFormCombobox> = {
  title: 'Forms/Combobox/OFormCombobox',
  component: OFormCombobox,
  tags: ['autodocs'],
  argTypes: {
    name: { control: 'text', description: 'Field name — must match a key in the parent OForm\'s defaultValues' },
    placeholder: { control: 'text', description: 'Placeholder text for the input' },
    label: { control: 'text', description: 'Label shown above the input' },
    items: { control: false, description: 'Options array: { label, value } objects' },
    searchRegex: { control: 'text', description: 'Regex applied to the current input to extract the search needle. Capture groups are tried in order; the first non-undefined group becomes the needle. Mirrors CommonAutoComplete\'s searchRegex prop. When omitted, the full input value is used as the needle.' },
    valueReplaceFn: { control: false, description: 'Transform function applied to the selected option before the value is emitted. Mirrors CommonAutoComplete\'s valueReplaceFn prop. Defaults to returning option.value.' },
    disabled: { control: 'boolean', description: 'Disables the control' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    size: { control: { type: 'select' }, options: ["sm","md"], description: 'Input size' },
    helpText: { control: 'text', description: 'Help text shown below the input' },
    debounce: { control: 'number', description: 'Debounce delay (ms) before emitting update:modelValue. Useful when the parent performs expensive operations on every change. Defaults to 0 (no debounce).' },
    id: { control: 'text', description: 'id forwarded to the input element' },
    labelPosition: { control: { type: 'select' }, options: ["inside","outside"], description: 'Controls where the label is rendered. - "outside" (default): label renders above the input as a block element. - "inside": label renders as a small floating label pinned inside the top of the input.' },
  },
};

export default meta;
type Story = StoryObj<typeof OFormCombobox>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFormCombobox, OForm },
    setup() {
      const demoSchema = z.object({ demo: z.any() });
      const sampleItems = ['error', 'warn', 'info', 'debug'];
      return { args, sampleItems, demoSchema };
    },
    template: `<OForm :schema="demoSchema" class="w-full max-w-md"><OFormCombobox name="demo" :items="sampleItems" v-bind="args"></OFormCombobox></OForm>`,
  }),
};
