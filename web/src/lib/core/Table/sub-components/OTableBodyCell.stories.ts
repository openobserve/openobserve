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
import OTableBodyCell from '@/lib/core/Table/sub-components/OTableBodyCell.vue';

const meta: Meta<typeof OTableBodyCell> = {
  title: 'Core/Table/Internals/OTableBodyCell',
  component: OTableBodyCell,
  tags: ['autodocs'],
  argTypes: {
    cell: { control: false },
    row: { control: false },
    rowSelected: { control: 'boolean' },
    highlightText: { control: 'text' },
    shouldHighlight: { control: 'boolean' },
    getHighlightedHtml: { control: false },
    wrap: { control: 'boolean' },
    dense: { control: 'boolean' },
    bordered: { control: 'boolean' },
    enableCellCopy: { control: 'boolean' },
    getCellStyle: { control: false },
  },
};

export default meta;
type Story = StoryObj<typeof OTableBodyCell>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTableBodyCell },
    setup() {
      return { args };
    },
    template: `<OTableBodyCell v-bind="args">{{ args.default }}</OTableBodyCell>`,
  }),
};
