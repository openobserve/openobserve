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
import OFormSlider from '@/lib/forms/Slider/OFormSlider.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import { z } from 'zod';

const meta: Meta<typeof OFormSlider> = {
  title: 'Forms/OFormSlider',
  component: OFormSlider,
  tags: ['autodocs'],
  argTypes: {
    name: { control: 'text', description: 'Field name — must match a key in the parent OForm\'s defaultValues' },
    min: { control: 'number', description: 'Minimum value (inclusive)' },
    max: { control: 'number', description: 'Maximum value (inclusive)' },
    step: { control: 'number', description: 'Step increment' },
    label: { control: 'text', description: 'Label rendered above the track' },
    showValue: { control: 'boolean', description: 'Show numeric value next to the label' },
    formatValue: { control: false, description: 'Format function for the displayed value' },
    helpText: { control: 'text', description: 'Helper text below the track' },
    errorMessage: { control: 'text', description: 'Error message — when provided the field shows error styling' },
    error: { control: 'boolean', description: 'Marks the field as being in error state without a message' },
    disabled: { control: 'boolean', description: 'Prevents interaction' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    size: { control: { type: 'select' }, options: ["sm","md","lg"], description: 'Control size' },
    id: { control: 'text', description: 'HTML id' },
  },
};

export default meta;
type Story = StoryObj<typeof OFormSlider>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFormSlider, OForm },
    setup() {
      const demoSchema = z.object({ demo: z.any() });
      return { args, demoSchema };
    },
    template: `<OForm :schema="demoSchema" class="w-full max-w-md"><OFormSlider name="demo" v-bind="args"></OFormSlider></OForm>`,
  }),
};
