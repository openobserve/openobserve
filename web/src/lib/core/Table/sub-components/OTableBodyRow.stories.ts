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
import OTableBodyRow from '@/lib/core/Table/sub-components/OTableBodyRow.vue';

const meta: Meta<typeof OTableBodyRow> = {
  title: 'Core/Table/OTableBodyRow',
  component: OTableBodyRow,
  tags: ['autodocs'],
  argTypes: {
    row: { control: false },
    table: { control: false },
    clickable: { control: 'boolean' },
    selectionEnabled: { control: 'boolean' },
    selectionMultiple: { control: 'boolean' },
    isRowSelected: { control: 'boolean' },
    isRowSelectable: { control: false },
    expansionEnabled: { control: 'boolean' },
    canExpand: { control: 'boolean' },
    isExpanded: { control: 'boolean' },
    highlightText: { control: 'text' },
    shouldHighlightColumn: { control: false },
    getHighlightedHtml: { control: false },
    wrap: { control: 'boolean' },
    dense: { control: 'boolean' },
    bordered: { control: 'boolean' },
    striped: { control: 'boolean' },
    rowClassFn: { control: false },
    rowStyleFn: { control: false },
    measureEl: { control: false },
    statusBarColor: { control: 'text' },
    enableCellCopy: { control: 'boolean' },
    getCellStyle: { control: false },
    enableRowReorder: { control: 'boolean' },
    rowDraggable: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof OTableBodyRow>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTableBodyRow },
    setup() {
      return { args };
    },
    template: `<OTableBodyRow v-bind="args" />`,
  }),
};
