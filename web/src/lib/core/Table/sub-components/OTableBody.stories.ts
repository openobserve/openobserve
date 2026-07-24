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
import OTableBody from '@/lib/core/Table/sub-components/OTableBody.vue';

const meta: Meta<typeof OTableBody> = {
  title: 'Core/Table/Internals/OTableBody',
  component: OTableBody,
  tags: ['autodocs'],
  argTypes: {
    rows: { control: false },
    table: { control: false },
    clickable: { control: 'boolean' },
    selectionEnabled: { control: 'boolean' },
    selectionMultiple: { control: 'boolean' },
    isRowSelectedFn: { control: false },
    isRowSelectable: { control: false },
    expansionEnabled: { control: 'boolean' },
    isExpandedFn: { control: false },
    getRowExpansionEnabled: { control: false },
    highlightText: { control: 'text' },
    shouldHighlightColumn: { control: false },
    getHighlightedHtml: { control: false },
    wrap: { control: 'boolean' },
    dense: { control: 'boolean' },
    bordered: { control: 'boolean' },
    striped: { control: 'boolean' },
    rowClass: { control: false },
    rowStyleFn: { control: false },
    loading: { control: 'boolean' },
    enableRowReorder: { control: 'boolean' },
    disableRowReorder: { control: false },
    globalFilterActive: { control: 'boolean' },
    rowKey: { control: 'text' },
    virtualRows: { control: false },
    totalSize: { control: 'number' },
    baseOffset: { control: 'number' },
    measureElement: { control: false },
    getStatusBarColor: { control: false },
    enableCellCopy: { control: 'boolean' },
    getCellStyle: { control: false },
  },
};

export default meta;
type Story = StoryObj<typeof OTableBody>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTableBody },
    setup() {
      return { args };
    },
    template: `<OTableBody v-bind="args" />`,
  }),
};
