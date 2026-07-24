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
import OFormRadioGroup from '@/lib/forms/Radio/OFormRadioGroup.vue';
import ORadio from '@/lib/forms/Radio/ORadio.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import { z } from 'zod';

const meta: Meta<typeof OFormRadioGroup> = {
  title: 'Forms/OFormRadioGroup',
  component: OFormRadioGroup,
  tags: ['autodocs'],
  argTypes: {
    name: { control: 'text', description: 'Field name — must match a key in the parent OForm\'s defaultValues' },
    modelValue: { control: false, description: 'Currently selected value' },
    label: { control: 'text', description: 'Accessible name for the group — rendered as a visually-hidden legend' },
    disabled: { control: 'boolean', description: 'Disables all radio buttons in the group' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    orientation: { control: { type: 'select' }, options: ["horizontal","vertical"], description: 'Layout direction of child radios' },
  },
};

export default meta;
type Story = StoryObj<typeof OFormRadioGroup>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFormRadioGroup, ORadio, OForm },
    setup() {
      const demoSchema = z.object({ demo: z.any() });
      return { args, demoSchema };
    },
    template: `<OForm :schema="demoSchema" class="w-full max-w-md"><OFormRadioGroup name="demo" v-bind="args"><ORadio value="a" label="A" /><ORadio value="b" label="B" /></OFormRadioGroup></OForm>`,
  }),
};
