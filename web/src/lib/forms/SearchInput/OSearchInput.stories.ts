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
import OSearchInput from '@/lib/forms/SearchInput/OSearchInput.vue';

const meta: Meta<typeof OSearchInput> = {
  title: 'Forms/SearchInput/OSearchInput',
  component: OSearchInput,
  tags: ['autodocs'],
  args: {
    placeholder: "Search...",
    size: "sm",
    clearable: true,
    debounce: 0,
    disabled: false,
  },
  argTypes: {
    placeholder: { control: 'text' },
    size: { control: { type: 'select' }, options: ["xs","sm","md"] },
    clearable: { control: 'boolean', description: 'Shows a × button to clear the field. Defaults to true — all search inputs are clearable by default.' },
    debounce: { control: 'number' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof OSearchInput>;

export const Playground: Story = {
  render: (args) => ({
    components: { OSearchInput },
    setup() {
      const model = ref('');
      return { args, model };
    },
    template: `<div class="w-72"><OSearchInput v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)" /></div>`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    components: { OSearchInput },
    setup() {
      const model = ref('');
      return { options: ["xs","sm","md"], model };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OSearchInput :size="opt" :model-value="model" @update:model-value="(v) => (model = v)"></OSearchInput>
        </div>
      </div>
    `,
  }),
};
