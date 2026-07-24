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
import OTableExpandButton from '@/lib/core/Table/sub-components/OTableExpandButton.vue';

const meta: Meta<typeof OTableExpandButton> = {
  title: 'Core/Table/OTableExpandButton',
  component: OTableExpandButton,
  tags: ['autodocs'],
  argTypes: {
    expanded: { control: 'boolean' },
    rowId: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof OTableExpandButton>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTableExpandButton },
    setup() {
      return { args };
    },
    template: `<OTableExpandButton v-bind="args" />`,
  }),
};
