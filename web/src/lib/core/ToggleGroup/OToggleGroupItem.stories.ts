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
import OToggleGroupItem from '@/lib/core/ToggleGroup/OToggleGroupItem.vue';
import OToggleGroup from '@/lib/core/ToggleGroup/OToggleGroup.vue';

const meta: Meta<typeof OToggleGroupItem> = {
  title: 'Core/OToggleGroupItem',
  component: OToggleGroupItem,
  tags: ['autodocs'],
  args: {
    disabled: false,
    size: "md",
    default: 'Item',
  },
  argTypes: {
    value: { control: false, description: 'Unique value for this option — required' },
    disabled: { control: 'boolean', description: 'Disables only this item' },
    tooltip: { control: 'text', description: 'Tooltip shown on hover — especially useful when disabled is true to explain why' },
    size: { control: { type: 'select' }, options: ["md","sm","xs"], description: 'Size controls padding and font-size. md (default) = full toolbar; sm = small toolbar; xs = compact inline toggle' },
    iconLeft: { control: 'text', description: 'Icon name (from OIcon registry) placed before the label. For custom icon components, use the icon-left slot.' },
    iconRight: { control: 'text', description: 'Icon name (from OIcon registry) placed after the label. For custom icon components, use the icon-right slot.' },
  },
};

export default meta;
type Story = StoryObj<typeof OToggleGroupItem>;

export const Playground: Story = {
  render: (args) => ({
    components: { OToggleGroupItem, OToggleGroup },
    setup() {
      const p_model = ref('a');
      return { args, p_model };
    },
    template: `<OToggleGroup :model-value="p_model" @update:model-value="(v) => (p_model = v)"><OToggleGroupItem v-bind="args" :value="'a'">{{ args.default }}</OToggleGroupItem></OToggleGroup>`,
  }),
};
