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
import OCodeCell from '@/lib/core/Table/cells/OCodeCell.vue';

const meta: Meta<typeof OCodeCell> = {
  title: 'Core/Table/Cells/OCodeCell',
  component: OCodeCell,
  tags: ['autodocs'],
  argTypes: {
    value: { control: false },
    copy: { control: 'boolean' },
    emptyLabel: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof OCodeCell>;

export const Playground: Story = {
  render: (args) => ({
    components: { OCodeCell },
    setup() {
      return { args };
    },
    template: `<OCodeCell v-bind="args" :value="'req_8f2ac91b3d'" />`,
  }),
};
