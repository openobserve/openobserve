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
import OFormOptionGroup from '@/lib/forms/OptionGroup/OFormOptionGroup.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import { z } from 'zod';

const meta: Meta<typeof OFormOptionGroup> = {
  title: 'Forms/OFormOptionGroup',
  component: OFormOptionGroup,
  tags: ['autodocs'],
  argTypes: {
    name: { control: 'text', description: 'Field name — must match a key in the parent OForm\'s defaultValues' },
    options: { control: false, description: 'Available options' },
    type: { control: { type: 'select' }, options: ["radio","checkbox"], description: 'Group input type' },
    orientation: { control: { type: 'select' }, options: ["horizontal","vertical"], description: 'Layout direction' },
    label: { control: 'text', description: 'Label rendered above the group' },
    helpText: { control: 'text', description: 'Helper text below the group' },
    errorMessage: { control: 'text', description: 'Error message — when provided the group shows error styling' },
    error: { control: 'boolean', description: 'Marks the field as being in error state without a message' },
    disabled: { control: 'boolean', description: 'Disables the entire group' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    size: { control: { type: 'select' }, options: ["xs","sm","md"], description: 'Size for inner radio/checkbox controls' },
  },
};

export default meta;
type Story = StoryObj<typeof OFormOptionGroup>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFormOptionGroup, OForm },
    setup() {
      const demoSchema = z.object({ demo: z.any() });
      const sampleOptions = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }];
      return { args, sampleOptions, demoSchema };
    },
    template: `<OForm :schema="demoSchema" class="w-full max-w-md"><OFormOptionGroup name="demo" :options="sampleOptions" v-bind="args"></OFormOptionGroup></OForm>`,
  }),
};
