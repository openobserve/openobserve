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
import OFieldList from '@/lib/lists/FieldList/OFieldList.vue';

const meta: Meta<typeof OFieldList> = {
  title: 'Lists/FieldList/OFieldList',
  component: OFieldList,
  tags: ['autodocs'],
  argTypes: {
    fields: { control: false },
    search: { control: 'text' },
    searchPlaceholder: { control: 'text' },
    searchClass: { control: 'text' },
    loading: { control: 'boolean' },
    currentPage: { control: 'number' },
    pageSize: { control: 'number' },
    pageSizeOptions: { control: false },
    rowKey: { control: 'text' },
    showSearch: { control: 'boolean' },
    showPagination: { control: 'boolean' },
    expandedIds: { control: false },
    draggable: { control: 'boolean' },
    dragEnabledFn: { control: false },
    sortFn: { control: false },
  },
};

export default meta;
type Story = StoryObj<typeof OFieldList>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFieldList },
    setup() {
      return { args };
    },
    template: `<OFieldList v-bind="args" />`,
  }),
};
