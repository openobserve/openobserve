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
import OTableSelectCheckbox from '@/lib/core/Table/sub-components/OTableSelectCheckbox.vue';

const meta: Meta<typeof OTableSelectCheckbox> = {
  title: 'Core/Table/OTableSelectCheckbox',
  component: OTableSelectCheckbox,
  tags: ['autodocs'],
  argTypes: {
    modelValue: { control: 'boolean' },
    indeterminate: { control: 'boolean' },
    rowId: { control: 'text' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof OTableSelectCheckbox>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTableSelectCheckbox },
    setup() {
      return { args };
    },
    template: `<OTableSelectCheckbox v-bind="args" />`,
  }),
};
