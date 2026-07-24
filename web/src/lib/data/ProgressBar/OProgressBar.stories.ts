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
import OProgressBar from '@/lib/data/ProgressBar/OProgressBar.vue';

const meta: Meta<typeof OProgressBar> = {
  title: 'Data/ProgressBar/OProgressBar',
  component: OProgressBar,
  tags: ['autodocs'],
  args: {
    variant: "default",
    size: "sm",
  },
  argTypes: {
    value: { control: 'number', description: 'Progress value between 0 and 1 (inclusive)' },
    variant: { control: { type: 'select' }, options: ["default","warning","danger"], description: 'Semantic color state. Default: "default"' },
    size: { control: { type: 'select' }, options: ["xs","sm","md","lg"], description: 'Track height. Default: "sm"' },
  },
};

export default meta;
type Story = StoryObj<typeof OProgressBar>;

export const Playground: Story = {
  render: (args) => ({
    components: { OProgressBar },
    setup() {
      return { args };
    },
    template: `<div class="w-72"><OProgressBar v-bind="args" :value="60">{{ args.default }}</OProgressBar></div>`,
  }),
};

export const Variants: Story = {
  render: () => ({
    components: { OProgressBar },
    setup() {
      return { options: ["default","warning","danger"] };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OProgressBar :variant="opt" :value="60">Demo</OProgressBar>
        </div>
      </div>
    `,
  }),
};
