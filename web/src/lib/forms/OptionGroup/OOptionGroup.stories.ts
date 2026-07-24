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
import OOptionGroup from '@/lib/forms/OptionGroup/OOptionGroup.vue';

const meta: Meta<typeof OOptionGroup> = {
  title: 'Forms/OOptionGroup',
  component: OOptionGroup,
  tags: ['autodocs'],
  args: {
    type: "radio",
    orientation: "vertical",
    disabled: false,
    size: "md",
  },
  argTypes: {
    options: { control: false, description: 'Available options' },
    type: { control: { type: 'select' }, options: ["radio","checkbox"], description: 'Group input type' },
    orientation: { control: { type: 'select' }, options: ["horizontal","vertical"], description: 'Layout direction' },
    label: { control: 'text', description: 'Label rendered above the group' },
    helpText: { control: 'text', description: 'Helper text below the group' },
    errorMessage: { control: 'text', description: 'Error message — when provided the group shows error styling' },
    error: { control: 'boolean', description: 'Marks the field as being in error state without a message' },
    disabled: { control: 'boolean', description: 'Disables the entire group' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    size: { control: { type: 'select' }, options: ["xs","sm","md"], description: 'Size for inner radio/checkbox controls' },
    name: { control: 'text', description: 'HTML name applied to inner inputs' },
  },
};

export default meta;
type Story = StoryObj<typeof OOptionGroup>;

export const Playground: Story = {
  render: (args) => ({
    components: { OOptionGroup },
    setup() {
      const sampleOptions = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }, { label: 'C', value: 'c' }];
      const model = ref('a');
      return { args, sampleOptions, model };
    },
    template: `<OOptionGroup v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)" :options="sampleOptions" />`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    components: { OOptionGroup },
    setup() {
      const sampleOptions = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }, { label: 'C', value: 'c' }];
      const model = ref('a');
      return { options: ["xs","sm","md"], sampleOptions, model };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OOptionGroup :size="opt" :model-value="model" @update:model-value="(v) => (model = v)" :options="sampleOptions"></OOptionGroup>
        </div>
      </div>
    `,
  }),
};
