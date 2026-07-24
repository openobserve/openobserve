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
import OTableHeader from '@/lib/core/Table/sub-components/OTableHeader.vue';

const meta: Meta<typeof OTableHeader> = {
  title: 'Core/Table/OTableHeader',
  component: OTableHeader,
  tags: ['autodocs'],
  argTypes: {
    headerGroups: { control: false },
    table: { control: false },
    columnOrder: { control: false },
    selectionMultiple: { control: 'boolean' },
    isAllSelected: { control: 'boolean' },
    isIndeterminate: { control: 'boolean' },
    expansionEnabled: { control: 'boolean' },
    enableRowReorder: { control: 'boolean' },
    enableColumnReorder: { control: 'boolean' },
    enableColumnResize: { control: 'boolean' },
    isResizing: { control: 'boolean' },
    sortingEnabled: { control: 'boolean' },
    sortBy: { control: 'text' },
    sortOrder: { control: 'text' },
    sortFieldMap: { control: false },
    getSortIcon: { control: false },
    stickyHeader: { control: 'boolean' },
    bordered: { control: 'boolean' },
    pivotHeaderLevels: { control: false },
    pivotRowColumns: { control: false },
    stickyColTotals: { control: 'boolean' },
    dense: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof OTableHeader>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTableHeader },
    setup() {
      return { args };
    },
    template: `<OTableHeader v-bind="args" />`,
  }),
};
