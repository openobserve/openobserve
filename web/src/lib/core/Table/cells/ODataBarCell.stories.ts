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
import ODataBarCell from '@/lib/core/Table/cells/ODataBarCell.vue';

const meta: Meta<typeof ODataBarCell> = {
  title: 'Core/Table/ODataBarCell',
  component: ODataBarCell,
  tags: ['autodocs'],
  argTypes: {
    value: { control: false },
    max: { control: 'number' },
    display: { control: 'text' },
    variant: { control: { type: 'select' }, options: ["default","warning","danger"] },
    emptyLabel: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof ODataBarCell>;

export const Playground: Story = {
  render: (args) => ({
    components: { ODataBarCell },
    setup() {
      return { args };
    },
    template: `<div class="w-40"><ODataBarCell v-bind="args" :value="72" :max="100" /></div>`,
  }),
};

export const Variants: Story = {
  render: () => ({
    components: { ODataBarCell },
    setup() {
      return { options: ["default","warning","danger"] };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <ODataBarCell :variant="opt" :value="72" :max="100"></ODataBarCell>
        </div>
      </div>
    `,
  }),
};
