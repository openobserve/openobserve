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
import { ref } from 'vue';
import OPagination from '@/lib/navigation/Pagination/OPagination.vue';

const meta: Meta<typeof OPagination> = {
  title: 'Navigation/Pagination/OPagination',
  component: OPagination,
  tags: ['autodocs'],
  args: {
    disable: false,
    maxPages: 5,
  },
  argTypes: {
    max: { control: 'number', description: 'Total number of pages.' },
    disable: { control: 'boolean', description: 'Disables all interaction when true.' },
    maxPages: { control: 'number', description: 'Maximum number of page-number buttons to display at once. The window is centred around the current page. 5' },
  },
};

export default meta;
type Story = StoryObj<typeof OPagination>;

export const Playground: Story = {
  render: (args) => ({
    components: { OPagination },
    setup() {
      const model = ref(1);
      return { args, model };
    },
    template: `<OPagination v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)" :max="10" />`,
  }),
};
