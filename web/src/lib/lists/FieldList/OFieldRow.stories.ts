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
import OFieldRow from '@/lib/lists/FieldList/OFieldRow.vue';

const meta: Meta<typeof OFieldRow> = {
  title: 'Lists/OFieldRow',
  component: OFieldRow,
  tags: ['autodocs'],
  argTypes: {
    highlight: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof OFieldRow>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFieldRow },
    setup() {
      return { args };
    },
    template: `<OFieldRow v-bind="args">{{ args.default }}</OFieldRow>`,
  }),
};
