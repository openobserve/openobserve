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
import OTimeCell from '@/lib/core/Table/cells/OTimeCell.vue';

const meta: Meta<typeof OTimeCell> = {
  title: 'Core/Table/Cells/OTimeCell',
  component: OTimeCell,
  tags: ['autodocs'],
  argTypes: {
    value: { control: false },
    unit: { control: { type: 'select' }, options: ["auto","iso","s","ms","us","ns"] },
    mode: { control: { type: 'select' }, options: ["relative","absolute","date"] },
    timezone: { control: 'text' },
    emptyLabel: { control: 'text' },
    relativeCutoffDays: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof OTimeCell>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTimeCell },
    setup() {
      return { args };
    },
    template: `<OTimeCell v-bind="args" :value="'2026-07-20T09:30:00Z'" :unit="'iso'" />`,
  }),
};
