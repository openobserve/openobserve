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
import OBanner from '@/lib/feedback/Banner/OBanner.vue';

const meta: Meta<typeof OBanner> = {
  title: 'Feedback/Banner/OBanner',
  component: OBanner,
  tags: ['autodocs'],
  args: {
    variant: "default",
    dense: false,
    inlineActions: false,
  },
  argTypes: {
    variant: { control: { type: 'select' }, options: ["default","info","success","warning","error","error-soft"] },
    content: { control: 'text' },
    icon: { control: 'text' },
    dense: { control: 'boolean' },
    inlineActions: { control: 'boolean' },
    dataTest: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof OBanner>;

export const Playground: Story = {
  render: (args) => ({
    components: { OBanner },
    setup() {
      return { args };
    },
    template: `<div class="w-96"><OBanner v-bind="args" :content="'This is a banner message.'">{{ args.default }}</OBanner></div>`,
  }),
};

export const Variants: Story = {
  render: () => ({
    components: { OBanner },
    setup() {
      return { options: ["default","info","success","warning","error","error-soft"] };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OBanner :variant="opt" :content="'This is a banner message.'">Demo</OBanner>
        </div>
      </div>
    `,
  }),
};
