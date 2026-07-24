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
import OCombobox from '@/lib/forms/Combobox/OCombobox.vue';

const meta: Meta<typeof OCombobox> = {
  title: 'Forms/OCombobox',
  component: OCombobox,
  tags: ['autodocs'],
  args: {
    disabled: false,
    size: "md",
    error: false,
    debounce: 0,
    labelPosition: "outside",
  },
  argTypes: {
    placeholder: { control: 'text', description: 'Placeholder text for the input' },
    label: { control: 'text', description: 'Label shown above the input' },
    items: { control: false, description: 'Options array: { label, value } objects' },
    searchRegex: { control: 'text', description: 'Regex applied to the current input to extract the search needle. Capture groups are tried in order; the first non-undefined group becomes the needle. Mirrors CommonAutoComplete\'s searchRegex prop. When omitted, the full input value is used as the needle.' },
    valueReplaceFn: { control: false, description: 'Transform function applied to the selected option before the value is emitted. Mirrors CommonAutoComplete\'s valueReplaceFn prop. Defaults to returning option.value.' },
    disabled: { control: 'boolean', description: 'Disables the control' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    size: { control: { type: 'select' }, options: ["sm","md"], description: 'Input size' },
    error: { control: 'boolean', description: 'Whether the input is in an error state' },
    errorMessage: { control: 'text', description: 'Error message shown below the input' },
    helpText: { control: 'text', description: 'Help text shown below the input' },
    debounce: { control: 'number', description: 'Debounce delay (ms) before emitting update:modelValue. Useful when the parent performs expensive operations on every change. Defaults to 0 (no debounce).' },
    id: { control: 'text', description: 'id forwarded to the input element' },
    name: { control: 'text', description: 'name forwarded to the input element' },
    labelPosition: { control: { type: 'select' }, options: ["inside","outside"], description: 'Controls where the label is rendered. - "outside" (default): label renders above the input as a block element. - "inside": label renders as a small floating label pinned inside the top of the input.' },
  },
};

export default meta;
type Story = StoryObj<typeof OCombobox>;

export const Playground: Story = {
  render: (args) => ({
    components: { OCombobox },
    setup() {
      const sampleItems = ['error', 'warn', 'info', 'debug'];
      const model = ref('');
      return { args, sampleItems, model };
    },
    template: `<div class="w-72"><OCombobox v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)" :items="sampleItems" /></div>`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    components: { OCombobox },
    setup() {
      const sampleItems = ['error', 'warn', 'info', 'debug'];
      const model = ref('');
      return { options: ["sm","md"], sampleItems, model };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OCombobox :size="opt" :model-value="model" @update:model-value="(v) => (model = v)" :items="sampleItems"></OCombobox>
        </div>
      </div>
    `,
  }),
};
