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
import OSwitch from '@/lib/forms/Switch/OSwitch.vue';

const meta: Meta<typeof OSwitch> = {
  title: 'Forms/OSwitch',
  component: OSwitch,
  tags: ['autodocs'],
  args: {
    labelPosition: "right",
    size: "md",
    disabled: false,
  },
  argTypes: {
    label: { control: 'text', description: 'Accessible label rendered beside the switch' },
    labelPosition: { control: { type: 'select' }, options: ["left","right"], description: 'Whether the label appears before (left) or after (right) the switch' },
    size: { control: { type: 'select' }, options: ["sm","md","lg","xl"], description: 'Control size' },
    checkedValue: { control: false, description: 'Value to emit when checked — replaces the legacy toggle\'s true-value' },
    uncheckedValue: { control: false, description: 'Value to emit when unchecked — replaces the legacy toggle\'s false-value' },
    disabled: { control: 'boolean', description: 'Prevents interaction' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    id: { control: 'text', description: 'HTML id' },
    name: { control: 'text', description: 'HTML name' },
  },
};

export default meta;
type Story = StoryObj<typeof OSwitch>;

export const Playground: Story = {
  render: (args) => ({
    components: { OSwitch },
    setup() {
      const model = ref(false);
      return { args, model };
    },
    template: `<OSwitch v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)" :label="'Enabled'" />`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    components: { OSwitch },
    setup() {
      const model = ref(false);
      return { options: ["sm","md","lg","xl"], model };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OSwitch :size="opt" :model-value="model" @update:model-value="(v) => (model = v)" :label="'Enabled'"></OSwitch>
        </div>
      </div>
    `,
  }),
};
