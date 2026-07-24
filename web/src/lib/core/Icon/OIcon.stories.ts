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
import OIcon from '@/lib/core/Icon/OIcon.vue';

const meta: Meta<typeof OIcon> = {
  title: 'Core/Icon/OIcon',
  component: OIcon,
  tags: ['autodocs'],
  args: {
    size: "md",
  },
  argTypes: {
    name: { control: false, description: 'Either an approved icon name from the registry, or an img:<path> reference to render an external image. To add a registry icon, update OIcon.icons.ts.' },
    size: { control: { type: 'select' }, options: ["xs","sm","md","lg","xl"], description: 'Semantic size. Defaults to "md" (24px). xs=12px sm=16px md=24px lg=32px xl=40px' },
    label: { control: 'text', description: 'Accessible label. When provided the icon has role="img". When omitted it is aria-hidden.' },
  },
};

export default meta;
type Story = StoryObj<typeof OIcon>;

export const Playground: Story = {
  render: (args) => ({
    components: { OIcon },
    setup() {
      return { args };
    },
    template: `<OIcon v-bind="args" :name="'search'">{{ args.default }}</OIcon>`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    components: { OIcon },
    setup() {
      return { options: ["xs","sm","md","lg","xl"] };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OIcon :size="opt" :name="'search'">Demo</OIcon>
        </div>
      </div>
    `,
  }),
};
