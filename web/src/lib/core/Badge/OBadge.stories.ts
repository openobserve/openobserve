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
import OBadge from '@/lib/core/Badge/OBadge.vue';

const meta: Meta<typeof OBadge> = {
  title: 'Core/Badge/OBadge',
  component: OBadge,
  tags: ['autodocs'],
  args: {
    variant: "default",
    size: "md",
    shape: "pill",
    dot: false,
    clickable: false,
    disabled: false,
    default: 'Badge',
  },
  argTypes: {
    variant: { control: { type: 'select' }, options: ["default","primary","success","warning","error","default-outline","primary-outline","success-outline","warning-outline","error-outline","info-outline","purple-outline","default-soft","primary-soft","success-soft","warning-soft","error-soft","teal","teal-outline","teal-soft","orange","orange-outline","orange-soft","lime","lime-outline","lime-soft","amber","amber-outline","amber-soft","cyan","cyan-outline","cyan-soft","blue","blue-outline","blue-soft","purple","purple-outline","purple-soft","indigo","indigo-outline","indigo-soft"], description: 'Semantic colour variant. Default: "default"' },
    size: { control: { type: 'select' }, options: ["xs","sm","md"], description: 'Size. Default: "md"' },
    shape: { control: { type: 'select' }, options: ["pill","rounded","square"], description: 'Corner shape. Default: "pill" (rounded-full).' },
    icon: { control: 'text', description: 'Material icon name rendered on the left side of the label. Overridden by the #icon slot when provided.' },
    count: { control: 'number', description: 'Numeric count rendered in a trailing segment on the right. Overridden by the #trailing slot when provided. NOTE: count: 0 still renders the 0 chip (different from the previous badge hideZeroCount.' },
    hideZeroCount: { control: 'boolean', description: 'When true and count is 0, the trailing segment is suppressed (matches the previous badge behavior).' },
    dot: { control: 'boolean', description: 'Renders a 7px solid status dot before the label. The dot inherits the badge\'s foreground colour (currentColor), so a success badge gets a green dot, an error badge a red dot, etc. Use for live status pills like "active" / "suspended".' },
    clickable: { control: 'boolean', description: 'Makes the badge interactive — adds keyboard handling, hover feedback, and a visible focus ring. Emits click on activation.' },
    disabled: { control: 'boolean', description: 'Mutes the badge visually and suppresses interaction.' },
  },
};

export default meta;
type Story = StoryObj<typeof OBadge>;

export const Playground: Story = {
  render: (args) => ({
    components: { OBadge },
    setup() {
      return { args };
    },
    template: `<OBadge v-bind="args">{{ args.default }}</OBadge>`,
  }),
};

export const Variants: Story = {
  render: () => ({
    components: { OBadge },
    setup() {
      return { options: ["default","primary","success","warning","error","default-outline","primary-outline","success-outline","warning-outline","error-outline","info-outline","purple-outline","default-soft","primary-soft","success-soft","warning-soft","error-soft","teal","teal-outline","teal-soft","orange","orange-outline","orange-soft","lime","lime-outline","lime-soft","amber","amber-outline","amber-soft","cyan","cyan-outline","cyan-soft","blue","blue-outline","blue-soft","purple","purple-outline","purple-soft","indigo","indigo-outline","indigo-soft"] };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OBadge :variant="opt" >Badge</OBadge>
        </div>
      </div>
    `,
  }),
};
