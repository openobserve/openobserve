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
import OTablePagination from '@/lib/core/Table/sub-components/OTablePagination.vue';

const meta: Meta<typeof OTablePagination> = {
  title: 'Core/Table/Internals/OTablePagination',
  component: OTablePagination,
  tags: ['autodocs'],
  argTypes: {
    currentPage: { control: 'number' },
    totalPages: { control: 'number' },
    totalCount: { control: 'number' },
    pageSize: { control: 'number' },
    pageSizeOptions: { control: false },
    showingFrom: { control: 'number' },
    showingTo: { control: 'number' },
    isFirstPage: { control: 'boolean' },
    isLastPage: { control: 'boolean' },
    position: { control: { type: 'select' }, options: ["top","bottom"] },
    title: { control: 'text' },
    loading: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof OTablePagination>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTablePagination },
    setup() {
      return { args };
    },
    template: `<OTablePagination v-bind="args" />`,
  }),
};
