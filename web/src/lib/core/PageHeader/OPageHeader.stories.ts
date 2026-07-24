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
import OPageHeader from '@/lib/core/PageHeader/OPageHeader.vue';

const meta: Meta<typeof OPageHeader> = {
  title: 'Core/OPageHeader',
  component: OPageHeader,
  tags: ['autodocs'],
  argTypes: {
    title: { control: 'text' },
    titleDataTest: { control: 'text' },
    subtitle: { control: 'text' },
    icon: { control: 'text' },
    back: { control: false },
    tabsBelow: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof OPageHeader>;

export const Playground: Story = {
  render: (args) => ({
    components: { OPageHeader },
    setup() {
      return { args };
    },
    template: `<OPageHeader v-bind="args" />`,
  }),
};
