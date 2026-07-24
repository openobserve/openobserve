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
import ODateRangeCalendar from '@/lib/forms/DateTimeRange/ODateRangeCalendar.vue';

const meta: Meta<typeof ODateRangeCalendar> = {
  title: 'Forms/DateTimeRange/ODateRangeCalendar',
  component: ODateRangeCalendar,
  tags: ['autodocs'],
  argTypes: {
    minDate: { control: 'text', description: 'Earliest selectable date — YYYY/MM/DD' },
    maxDate: { control: 'text', description: 'Latest selectable date — YYYY/MM/DD' },
    disabled: { control: 'boolean', description: 'When true, all cell interactions are disabled' },
  },
};

export default meta;
type Story = StoryObj<typeof ODateRangeCalendar>;

export const Playground: Story = {
  render: (args) => ({
    components: { ODateRangeCalendar },
    setup() {
      const startDate = ref(null);
      const endDate = ref(null);
      return { args, startDate, endDate };
    },
    template: `<ODateRangeCalendar v-bind="args" :start-date="startDate" @update:start-date="(v) => (startDate = v)" :end-date="endDate" @update:end-date="(v) => (endDate = v)" />`,
  }),
};
