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
import OSplitter from '@/lib/core/Splitter/OSplitter.vue';

const meta: Meta<typeof OSplitter> = {
  title: 'Core/Splitter/OSplitter',
  component: OSplitter,
  tags: ['autodocs'],
  args: {
    horizontal: false,
    unit: "%",
    disable: false,
    separator: true,
    separatorClass: "",
    beforeClass: "",
  },
  argTypes: {
    modelValue: { control: 'number' },
    horizontal: { control: 'boolean' },
    limits: { control: false },
    unit: { control: { type: 'select' }, options: ["px","%"] },
    disable: { control: 'boolean' },
    separator: { control: 'boolean' },
    separatorClass: { control: 'text' },
    separatorStyle: { control: false },
    beforeClass: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof OSplitter>;

export const Playground: Story = {
  render: (args) => ({
    components: { OSplitter },
    setup() {
      const split = ref(30);
      return { args, split };
    },
    template: `<div class="h-64 w-full overflow-hidden rounded-surface border border-border-default"><OSplitter v-bind="args" :model-value="split" class="h-full w-full" @update:model-value="(v) => (split = v)"><template #before><div class="flex h-full w-full items-center justify-center bg-surface-base text-sm text-text-secondary">Before pane</div></template><template #after><div class="flex h-full w-full items-center justify-center bg-surface-subtle text-sm text-text-secondary">After pane</div></template></OSplitter></div>`,
  }),
};
