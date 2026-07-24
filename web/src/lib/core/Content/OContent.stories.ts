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
import OContent from '@/lib/core/Content/OContent.vue';

const meta: Meta<typeof OContent> = {
  title: 'Core/Content/OContent',
  component: OContent,
  tags: ['autodocs'],
  argTypes: {
    bleed: { control: 'boolean' },
    bleedX: { control: 'boolean' },
    bleedY: { control: 'boolean' },
    y: { control: 'boolean' },
    as: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof OContent>;

export const Playground: Story = {
  render: (args) => ({
    components: { OContent },
    setup() {
      return { args };
    },
    template: `<OContent v-bind="args"><p class="text-sm text-text-secondary">Padded reading content.</p></OContent>`,
  }),
};
