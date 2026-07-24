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
import ODateTimeRange from '@/lib/forms/DateTimeRange/ODateTimeRange.vue';

const meta: Meta<typeof ODateTimeRange> = {
  title: 'Forms/DateTimeRange/ODateTimeRange',
  component: ODateTimeRange,
  tags: ['autodocs'],
  args: {
    startTime: "",
    endTime: "",
    mode: "relative",
    relativeUnit: "minutes",
    relativeAmount: 0,
    withSeconds: false,
    autoApply: false,
    disableRelative: false,
    hideTime: false,
    showTimezone: false,
    disabled: false,
    placeholder: "Select date range",
  },
  argTypes: {
    startTime: { control: 'text', description: 'Time string HH:MM or HH:MM:SS for start' },
    endTime: { control: 'text', description: 'Time string HH:MM or HH:MM:SS for end' },
    mode: { control: { type: 'select' }, options: ["relative","absolute"], description: 'Active mode; drives the trigger label' },
    relativeUnit: { control: { type: 'select' }, options: ["seconds","minutes","hours","days","weeks","months"], description: 'Relative period unit' },
    relativeAmount: { control: 'number', description: 'Relative period amount (0 = no selection)' },
    withSeconds: { control: 'boolean', description: 'Show seconds segments in time fields' },
    autoApply: { control: 'boolean', description: 'Emit immediately on every change (no Apply button needed)' },
    disableRelative: { control: 'boolean', description: 'Hide the Relative tab; force absolute-only mode' },
    hideTime: { control: 'boolean', description: 'Hide Start/End time inputs in the Absolute tab' },
    showTimezone: { control: 'boolean', description: 'Show the timezone selector (hidden by default)' },
    minDate: { control: 'text', description: 'Minimum selectable date YYYY-MM-DD' },
    maxDate: { control: 'text', description: 'Maximum selectable date YYYY-MM-DD' },
    maxHours: { control: 'number', description: 'Disable relative options that exceed this many hours' },
    timezone: { control: 'text', description: 'IANA timezone string; empty string = browser local time' },
    label: { control: 'text' },
    helpText: { control: 'text' },
    errorMessage: { control: 'text' },
    disabled: { control: 'boolean' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    placeholder: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof ODateTimeRange>;

export const Playground: Story = {
  render: (args) => ({
    components: { ODateTimeRange },
    setup() {
      const startDate = ref('');
      const endDate = ref('');
      return { args, startDate, endDate };
    },
    template: `<ODateTimeRange v-bind="args" :start-date="startDate" @update:start-date="(v) => (startDate = v)" :end-date="endDate" @update:end-date="(v) => (endDate = v)" />`,
  }),
};
