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
import ODate from '@/lib/forms/Date/ODate.vue';

const meta: Meta<typeof ODate> = {
  title: 'Forms/ODate',
  component: ODate,
  tags: ['autodocs'],
  args: {
    clearable: false,
    autoApply: true,
    readonly: false,
    disabled: false,
    size: "md",
  },
  argTypes: {
    min: { control: 'text', description: 'Minimum selectable date — YYYY-MM-DD' },
    max: { control: 'text', description: 'Maximum selectable date — YYYY-MM-DD' },
    label: { control: 'text', description: 'Label rendered above the field' },
    placeholder: { control: 'text', description: 'Placeholder shown when the field is empty (browser support varies)' },
    helpText: { control: 'text', description: 'Helper text rendered below the field' },
    errorMessage: { control: 'text', description: 'Error message — when provided the field shows error styling' },
    error: { control: 'boolean', description: 'Marks the field as being in error state without a message' },
    clearable: { control: 'boolean', description: 'Whether the user can clear the value' },
    autoApply: { control: 'boolean', description: 'Apply immediately on date click (default true). Set false to show an Apply button.' },
    readonly: { control: 'boolean', description: 'Prevents editing' },
    disabled: { control: 'boolean', description: 'Prevents interaction' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    size: { control: { type: 'select' }, options: ["sm","md"], description: 'Control size' },
    id: { control: 'text', description: 'HTML id' },
    name: { control: 'text', description: 'HTML name' },
  },
};

export default meta;
type Story = StoryObj<typeof ODate>;

export const Playground: Story = {
  render: (args) => ({
    components: { ODate },
    setup() {
      const model = ref('');
      return { args, model };
    },
    template: `<div class="w-72"><ODate v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)" /></div>`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    components: { ODate },
    setup() {
      const model = ref('');
      return { options: ["sm","md"], model };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <ODate :size="opt" :model-value="model" @update:model-value="(v) => (model = v)"></ODate>
        </div>
      </div>
    `,
  }),
};
