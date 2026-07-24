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
import OUserCell from '@/lib/core/Table/cells/OUserCell.vue';

const meta: Meta<typeof OUserCell> = {
  title: 'Core/Table/OUserCell',
  component: OUserCell,
  tags: ['autodocs'],
  argTypes: {
    value: { control: false },
    name: { control: 'text' },
    emptyLabel: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof OUserCell>;

export const Playground: Story = {
  render: (args) => ({
    components: { OUserCell },
    setup() {
      return { args };
    },
    template: `<OUserCell v-bind="args" :value="'jane@openobserve.ai'" :name="'Jane Doe'" />`,
  }),
};
