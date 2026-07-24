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
import OTag from '@/lib/core/Badge/OTag.vue';

const meta: Meta<typeof OTag> = {
  title: 'Core/Badge/OTag',
  component: OTag,
  tags: ['autodocs'],
  args: {
    default: 'Label',
  },
  argTypes: {
    type: { control: false },
    value: { control: false },
    size: { control: { type: 'select' }, options: ["xs","sm","md"] },
    shape: { control: { type: 'select' }, options: ["pill","rounded","square"] },
    label: { control: 'text' },
    variant: { control: { type: 'select' }, options: ["default","primary","success","warning","error","default-outline","primary-outline","success-outline","warning-outline","error-outline","info-outline","purple-outline","default-soft","primary-soft","success-soft","warning-soft","error-soft","teal","teal-outline","teal-soft","orange","orange-outline","orange-soft","lime","lime-outline","lime-soft","amber","amber-outline","amber-soft","cyan","cyan-outline","cyan-soft","blue","blue-outline","blue-soft","purple","purple-outline","purple-soft","indigo","indigo-outline","indigo-soft"] },
    icon: { control: 'text' },
    dot: { control: 'boolean' },
    count: { control: 'number' },
    hideZeroCount: { control: 'boolean' },
    clickable: { control: 'boolean' },
    disabled: { control: 'boolean' },
    emptyLabel: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof OTag>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTag },
    setup() {
      return { args };
    },
    template: `<OTag v-bind="args">{{ args.default }}</OTag>`,
  }),
};

export const Variants: Story = {
  render: () => ({
    components: { OTag },
    setup() {
      return { options: ["default","primary","success","warning","error","default-outline","primary-outline","success-outline","warning-outline","error-outline","info-outline","purple-outline","default-soft","primary-soft","success-soft","warning-soft","error-soft","teal","teal-outline","teal-soft","orange","orange-outline","orange-soft","lime","lime-outline","lime-soft","amber","amber-outline","amber-soft","cyan","cyan-outline","cyan-soft","blue","blue-outline","blue-soft","purple","purple-outline","purple-soft","indigo","indigo-outline","indigo-soft"] };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OTag :variant="opt" >Label</OTag>
        </div>
      </div>
    `,
  }),
};
