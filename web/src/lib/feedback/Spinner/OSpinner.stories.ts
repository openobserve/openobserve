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
import OSpinner from '@/lib/feedback/Spinner/OSpinner.vue';

const meta: Meta<typeof OSpinner> = {
  title: 'Feedback/Spinner/OSpinner',
  component: OSpinner,
  tags: ['autodocs'],
  args: {
    variant: "ring",
    size: "md",
  },
  argTypes: {
    variant: { control: { type: 'select' }, options: ["ring","dots"], description: 'Animation style. Default: "ring"' },
    size: { control: { type: 'select' }, options: ["xs","sm","md","lg","xl"], description: 'Component size. Default: "md"' },
  },
};

export default meta;
type Story = StoryObj<typeof OSpinner>;

export const Playground: Story = {
  render: (args) => ({
    components: { OSpinner },
    setup() {
      return { args };
    },
    template: `<OSpinner v-bind="args" />`,
  }),
};

export const Variants: Story = {
  render: () => ({
    components: { OSpinner },
    setup() {
      return { options: ["ring","dots"] };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OSpinner :variant="opt" ></OSpinner>
        </div>
      </div>
    `,
  }),
};
