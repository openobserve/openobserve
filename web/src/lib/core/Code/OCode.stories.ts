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
import OCode from '@/lib/core/Code/OCode.vue';

const meta: Meta<typeof OCode> = {
  title: 'Core/Code/OCode',
  component: OCode,
  tags: ['autodocs'],
  args: {
    block: false,
    copyable: false,
    truncate: false,
  },
  argTypes: {
    block: { control: 'boolean', description: 'Block-level display: full-width pre/code with scroll for long lines. When false (default): inline code chip with subtle background border.' },
    copyable: { control: 'boolean', description: 'Show a copy-to-clipboard button. The button copies the rendered text content of the code element.' },
    truncate: { control: 'boolean', description: 'Truncate with ellipsis. Only applies to inline (block=false) mode. In block mode, content scrolls horizontally instead.' },
  },
};

export default meta;
type Story = StoryObj<typeof OCode>;

export const Playground: Story = {
  render: (args) => ({
    components: { OCode },
    setup() {
      return { args };
    },
    template: `<OCode v-bind="args">const x = 42;</OCode>`,
  }),
};
