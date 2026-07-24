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
import OFormToggleGroup from '@/lib/core/ToggleGroup/OFormToggleGroup.vue';
import OToggleGroupItem from '@/lib/core/ToggleGroup/OToggleGroupItem.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import { z } from 'zod';

const meta: Meta<typeof OFormToggleGroup> = {
  title: 'Core/ToggleGroup/OFormToggleGroup',
  component: OFormToggleGroup,
  tags: ['autodocs'],
  argTypes: {
    name: { control: 'text', description: 'Field name — must match a key in the parent OForm\'s defaultValues' },
    type: { control: { type: 'select' }, options: ["single","multiple"], description: 'Whether one or multiple items can be active at a time' },
    disabled: { control: 'boolean', description: 'Disables all items in the group' },
    orientation: { control: { type: 'select' }, options: ["horizontal","vertical"], description: 'Layout axis for keyboard navigation' },
    variant: { control: { type: 'select' }, options: ["default","primary"], description: 'Visual variant — use \'primary\' when the toggle sits on a primary-colored bar' },
    label: { control: 'text', description: 'Label text rendered next to the toggle bar. For richer content use the label slot.' },
    labelPosition: { control: { type: 'select' }, options: ["left","right","top"], description: 'Position of the label relative to the toggle bar' },
  },
};

export default meta;
type Story = StoryObj<typeof OFormToggleGroup>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFormToggleGroup, OToggleGroupItem, OForm },
    setup() {
      const demoSchema = z.object({ demo: z.any() });
      return { args, demoSchema };
    },
    template: `<OForm :schema="demoSchema" class="w-full max-w-md"><OFormToggleGroup name="demo" v-bind="args"><OToggleGroupItem value="list">List</OToggleGroupItem><OToggleGroupItem value="grid">Grid</OToggleGroupItem></OFormToggleGroup></OForm>`,
  }),
};
