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
import OPageLayout from '@/lib/core/PageLayout/OPageLayout.vue';

const meta: Meta<typeof OPageLayout> = {
  title: 'Core/OPageLayout',
  component: OPageLayout,
  tags: ['autodocs'],
  argTypes: {
    title: { control: 'text' },
    subtitle: { control: 'text' },
    icon: { control: 'text' },
    back: { control: false },
    titleDataTest: { control: 'text' },
    tabsBelow: { control: 'boolean' },
    bleed: { control: 'boolean' },
    padY: { control: 'boolean' },
    scroll: { control: 'boolean' },
    sidebarWidth: { control: 'number' },
    resizable: { control: 'boolean' },
    splitterLimits: { control: false },
    constrained: { control: 'boolean' },
    contentSize: { control: { type: 'select' }, options: ["sm","md","lg","xl"] },
    headerClass: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof OPageLayout>;

export const Playground: Story = {
  render: (args) => ({
    components: { OPageLayout },
    setup() {
      return { args };
    },
    template: `<OPageLayout v-bind="args">{{ args.default }}</OPageLayout>`,
  }),
};
