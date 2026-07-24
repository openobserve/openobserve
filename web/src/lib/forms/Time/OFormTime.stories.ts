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
import OFormTime from '@/lib/forms/Time/OFormTime.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import { z } from 'zod';

const meta: Meta<typeof OFormTime> = {
  title: 'Forms/Time/OFormTime',
  component: OFormTime,
  tags: ['autodocs'],
  argTypes: {
    name: { control: 'text', description: 'Field name — must match a key in the parent OForm\'s defaultValues' },
    withSeconds: { control: 'boolean', description: 'Enable seconds precision (HH:MM:SS)' },
    min: { control: 'text', description: 'Minimum selectable time — HH:MM' },
    max: { control: 'text', description: 'Maximum selectable time — HH:MM' },
    step: { control: 'number', description: 'Step in seconds — default 60 (one minute)' },
    label: { control: 'text', description: 'Label rendered above the field' },
    placeholder: { control: 'text', description: 'Placeholder shown when empty' },
    helpText: { control: 'text', description: 'Helper text below the field' },
    errorMessage: { control: 'text', description: 'Error message — when provided the field shows error styling' },
    error: { control: 'boolean', description: 'Marks the field as being in error state without a message' },
    clearable: { control: 'boolean', description: 'Whether the user can clear the value' },
    readonly: { control: 'boolean', description: 'Prevents editing' },
    disabled: { control: 'boolean', description: 'Prevents interaction' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    size: { control: { type: 'select' }, options: ["sm","md"], description: 'Control size' },
    id: { control: 'text', description: 'HTML id' },
  },
};

export default meta;
type Story = StoryObj<typeof OFormTime>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFormTime, OForm },
    setup() {
      const demoSchema = z.object({ demo: z.any() });
      return { args, demoSchema };
    },
    template: `<OForm :schema="demoSchema" class="w-full max-w-md"><OFormTime name="demo" v-bind="args"></OFormTime></OForm>`,
  }),
};
