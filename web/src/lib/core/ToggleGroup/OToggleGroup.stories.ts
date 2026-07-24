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
import OToggleGroup from '@/lib/core/ToggleGroup/OToggleGroup.vue';
import OToggleGroupItem from '@/lib/core/ToggleGroup/OToggleGroupItem.vue';

const meta: Meta<typeof OToggleGroup> = {
  title: 'Core/OToggleGroup',
  component: OToggleGroup,
  tags: ['autodocs'],
  args: {
    type: "single",
    disabled: false,
    orientation: "horizontal",
    variant: "default",
    labelPosition: "left",
  },
  argTypes: {
    type: { control: { type: 'select' }, options: ["single","multiple"], description: 'Whether one or multiple items can be active at a time' },
    disabled: { control: 'boolean', description: 'Disables all items in the group' },
    orientation: { control: { type: 'select' }, options: ["horizontal","vertical"], description: 'Layout axis for keyboard navigation' },
    variant: { control: { type: 'select' }, options: ["default","primary"], description: 'Visual variant — use \'primary\' when the toggle sits on a primary-colored bar' },
    label: { control: 'text', description: 'Label text rendered next to the toggle bar. For richer content use the label slot.' },
    labelPosition: { control: { type: 'select' }, options: ["left","right","top"], description: 'Position of the label relative to the toggle bar' },
  },
};

export default meta;
type Story = StoryObj<typeof OToggleGroup>;

export const Playground: Story = {
  render: (args) => ({
    components: { OToggleGroup, OToggleGroupItem },
    setup() {
      const model = ref('list');
      return { args, model };
    },
    template: `<OToggleGroup v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)"><OToggleGroupItem value="list">List</OToggleGroupItem><OToggleGroupItem value="grid">Grid</OToggleGroupItem></OToggleGroup>`,
  }),
};

export const Variants: Story = {
  render: () => ({
    components: { OToggleGroup, OToggleGroupItem },
    setup() {
      const model = ref('list');
      return { options: ["default","primary"], model };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OToggleGroup :variant="opt" :model-value="model" @update:model-value="(v) => (model = v)"><OToggleGroupItem value="list">List</OToggleGroupItem><OToggleGroupItem value="grid">Grid</OToggleGroupItem></OToggleGroup>
        </div>
      </div>
    `,
  }),
};
