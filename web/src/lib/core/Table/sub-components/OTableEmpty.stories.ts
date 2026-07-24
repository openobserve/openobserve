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
import OTableEmpty from '@/lib/core/Table/sub-components/OTableEmpty.vue';

const meta: Meta<typeof OTableEmpty> = {
  title: 'Core/Table/OTableEmpty',
  component: OTableEmpty,
  tags: ['autodocs'],
  argTypes: {
    message: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof OTableEmpty>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTableEmpty },
    setup() {
      return { args };
    },
    template: `<OTableEmpty v-bind="args">{{ args.default }}</OTableEmpty>`,
  }),
};
