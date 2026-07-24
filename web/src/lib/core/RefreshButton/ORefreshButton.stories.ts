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
import ORefreshButton from '@/lib/core/RefreshButton/ORefreshButton.vue';

const meta: Meta<typeof ORefreshButton> = {
  title: 'Core/RefreshButton/ORefreshButton',
  component: ORefreshButton,
  tags: ['autodocs'],
  args: {
    loading: false,
    disabled: false,
  },
  argTypes: {
    lastRunAt: { control: 'text', description: 'Unix millisecond timestamp of the last completed query' },
    loading: { control: 'boolean', description: 'Mirrors the page\'s loading state to spin the icon and disable the button' },
    disabled: { control: 'boolean', description: 'Disables the button independently of loading' },
  },
};

export default meta;
type Story = StoryObj<typeof ORefreshButton>;

export const Playground: Story = {
  render: (args) => ({
    components: { ORefreshButton },
    setup() {
      return { args };
    },
    template: `<ORefreshButton v-bind="args" />`,
  }),
};
