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
import OCheckbox from '@/lib/forms/Checkbox/OCheckbox.vue';

const meta: Meta<typeof OCheckbox> = {
  title: 'Forms/OCheckbox',
  component: OCheckbox,
  tags: ['autodocs'],
  args: {
    size: "md",
    color: "primary",
    disabled: false,
  },
  argTypes: {
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
    name: { control: 'text', description: 'HTML name attribute' },
  },
};

export default meta;
type Story = StoryObj<typeof OCheckbox>;

export const Playground: Story = {
  render: (args) => ({
    components: { OCheckbox },
    setup() {
      const model = ref(false);
      return { args, model };
    },
    template: `<OCheckbox v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)" :label="'Accept terms'" />`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    components: { OCheckbox },
    setup() {
      const model = ref(false);
      return { options: ["xs","sm","md"], model };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OCheckbox :size="opt" :model-value="model" @update:model-value="(v) => (model = v)" :label="'Accept terms'"></OCheckbox>
        </div>
      </div>
    `,
  }),
};
