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
import OSeparator from '@/lib/core/Separator/OSeparator.vue';

const meta: Meta<typeof OSeparator> = {
  title: 'Core/Separator/OSeparator',
  component: OSeparator,
  tags: ['autodocs'],
  args: {
    vertical: false,
  },
  argTypes: {
    vertical: { control: 'boolean', description: 'Renders as a vertical line instead of horizontal' },
  },
};

export default meta;
type Story = StoryObj<typeof OSeparator>;

export const Playground: Story = {
  render: (args) => ({
    components: { OSeparator },
    setup() {
      return { args };
    },
    template: `<div class="flex text-sm text-text-secondary" :class="args.vertical ? 'h-24 flex-row items-stretch gap-4' : 'w-64 flex-col gap-2'"><span :class="args.vertical ? 'flex items-center' : ''">{{ args.vertical ? 'Left' : 'Content above' }}</span><OSeparator v-bind="args" /><span :class="args.vertical ? 'flex items-center' : ''">{{ args.vertical ? 'Right' : 'Content below' }}</span></div>`,
  }),
};
