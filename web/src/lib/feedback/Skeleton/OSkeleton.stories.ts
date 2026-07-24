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
import OSkeleton from '@/lib/feedback/Skeleton/OSkeleton.vue';

const meta: Meta<typeof OSkeleton> = {
  title: 'Feedback/OSkeleton',
  component: OSkeleton,
  tags: ['autodocs'],
  args: {
    type: "rect",
    animation: "wave",
  },
  argTypes: {
    type: { control: { type: 'select' }, options: ["rect","circle","text"], description: 'Shape of the placeholder. Default: "rect"' },
    animation: { control: { type: 'select' }, options: ["pulse","wave","none"], description: 'Animation style. Default: "pulse"' },
  },
};

export default meta;
type Story = StoryObj<typeof OSkeleton>;

export const Playground: Story = {
  render: (args) => ({
    components: { OSkeleton },
    setup() {
      return { args };
    },
    template: `<div class="relative h-64 w-full overflow-hidden rounded-surface border border-border-default"><OSkeleton v-bind="args" /></div>`,
  }),
};
