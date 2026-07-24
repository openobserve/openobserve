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
import OSlider from '@/lib/forms/Slider/OSlider.vue';

const meta: Meta<typeof OSlider> = {
  title: 'Forms/OSlider',
  component: OSlider,
  tags: ['autodocs'],
  args: {
    min: 0,
    max: 100,
    step: 1,
    showValue: false,
    disabled: false,
    size: "md",
  },
  argTypes: {
    min: { control: 'number', description: 'Minimum value (inclusive)' },
    max: { control: 'number', description: 'Maximum value (inclusive)' },
    step: { control: 'number', description: 'Step increment' },
    label: { control: 'text', description: 'Label rendered above the track' },
    showValue: { control: 'boolean', description: 'Show numeric value next to the label' },
    formatValue: { control: false, description: 'Format function for the displayed value' },
    helpText: { control: 'text', description: 'Helper text below the track' },
    errorMessage: { control: 'text', description: 'Error message — when provided the field shows error styling' },
    error: { control: 'boolean', description: 'Marks the field as being in error state without a message' },
    disabled: { control: 'boolean', description: 'Prevents interaction' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    size: { control: { type: 'select' }, options: ["sm","md","lg"], description: 'Control size' },
    id: { control: 'text', description: 'HTML id' },
    name: { control: 'text', description: 'HTML name' },
  },
};

export default meta;
type Story = StoryObj<typeof OSlider>;

export const Playground: Story = {
  render: (args) => ({
    components: { OSlider },
    setup() {
      const model = ref(40);
      return { args, model };
    },
    template: `<div class="w-72"><OSlider v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)" /></div>`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    components: { OSlider },
    setup() {
      const model = ref(40);
      return { options: ["sm","md","lg"], model };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OSlider :size="opt" :model-value="model" @update:model-value="(v) => (model = v)"></OSlider>
        </div>
      </div>
    `,
  }),
};
