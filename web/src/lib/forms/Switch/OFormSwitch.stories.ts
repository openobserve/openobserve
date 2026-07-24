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
import OFormSwitch from '@/lib/forms/Switch/OFormSwitch.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import { z } from 'zod';

const meta: Meta<typeof OFormSwitch> = {
  title: 'Forms/OFormSwitch',
  component: OFormSwitch,
  tags: ['autodocs'],
  argTypes: {
    name: { control: 'text', description: 'Field name — must match a key in the parent OForm\'s defaultValues' },
    label: { control: 'text', description: 'Accessible label rendered beside the switch' },
    labelPosition: { control: { type: 'select' }, options: ["left","right"], description: 'Whether the label appears before (left) or after (right) the switch' },
    size: { control: { type: 'select' }, options: ["sm","md","lg","xl"], description: 'Control size' },
    checkedValue: { control: false, description: 'Value to emit when checked — replaces the legacy toggle\'s true-value' },
    uncheckedValue: { control: false, description: 'Value to emit when unchecked — replaces the legacy toggle\'s false-value' },
    disabled: { control: 'boolean', description: 'Prevents interaction' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    id: { control: 'text', description: 'HTML id' },
  },
};

export default meta;
type Story = StoryObj<typeof OFormSwitch>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFormSwitch, OForm },
    setup() {
      const demoSchema = z.object({ demo: z.any() });
      return { args, demoSchema };
    },
    template: `<OForm :schema="demoSchema" class="w-full max-w-md"><OFormSwitch name="demo" :label="'Enabled'" v-bind="args"></OFormSwitch></OForm>`,
  }),
};
