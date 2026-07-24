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
import OInnerLoading from '@/lib/feedback/InnerLoading/OInnerLoading.vue';

const meta: Meta<typeof OInnerLoading> = {
  title: 'Feedback/OInnerLoading',
  component: OInnerLoading,
  tags: ['autodocs'],
  args: {
    size: "xs",
    scrim: true,
  },
  argTypes: {
    showing: { control: 'boolean', description: 'Controls overlay visibility' },
    label: { control: 'text', description: 'Optional label shown beneath the spinner' },
    size: { control: { type: 'select' }, options: ["xs","sm","md","lg","xl"], description: 'Spinner size. Default: "xs"' },
    scrim: { control: 'boolean', description: 'Paint the dimming scrim behind the spinner. Default: true. The scrim is --color-inner-loading-overlay — 70% of --color-surface-base — so it only reads correctly over base-surface content it is actually covering. Set false when this is a placeholder in empty space rather than an overlay: with nothing' },
  },
};

export default meta;
type Story = StoryObj<typeof OInnerLoading>;

export const Playground: Story = {
  render: (args) => ({
    components: { OInnerLoading },
    setup() {
      return { args };
    },
    template: `<div class="relative h-64 w-full overflow-hidden rounded-surface border border-border-default"><OInnerLoading v-bind="args" :showing="true" /></div>`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    components: { OInnerLoading },
    setup() {
      return { options: ["xs","sm","md","lg","xl"] };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OInnerLoading :size="opt" :showing="true"></OInnerLoading>
        </div>
      </div>
    `,
  }),
};
