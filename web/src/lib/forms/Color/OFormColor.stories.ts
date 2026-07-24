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
import OFormColor from '@/lib/forms/Color/OFormColor.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import { z } from 'zod';

const meta: Meta<typeof OFormColor> = {
  title: 'Forms/OFormColor',
  component: OFormColor,
  tags: ['autodocs'],
  argTypes: {
    name: { control: 'text', description: 'Field name — must match a key in the parent OForm\'s defaultValues' },
    label: { control: 'text', description: 'Label rendered above the field' },
    placeholder: { control: 'text', description: 'Placeholder shown when value is empty' },
    helpText: { control: 'text', description: 'Helper text below the field' },
    errorMessage: { control: 'text', description: 'Error message — when provided the field shows error styling' },
    error: { control: 'boolean', description: 'Marks the field as being in error state without a message' },
    readonly: { control: 'boolean', description: 'If true, the hex text input is read-only — users can only change the value via the swatch picker. Defaults to false (typing is allowed). Inverted from a previous editable prop to avoid Vue\'s boolean coercion making the input read-only when the parent doesn\'t pass anything.' },
    clearable: { control: 'boolean', description: 'Whether the user can clear the value' },
    disabled: { control: 'boolean', description: 'Prevents interaction' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    size: { control: { type: 'select' }, options: ["sm","md"], description: 'Control size' },
    id: { control: 'text', description: 'HTML id' },
  },
};

export default meta;
type Story = StoryObj<typeof OFormColor>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFormColor, OForm },
    setup() {
      const demoSchema = z.object({ demo: z.any() });
      return { args, demoSchema };
    },
    template: `<OForm :schema="demoSchema" class="w-full max-w-md"><OFormColor name="demo" v-bind="args"></OFormColor></OForm>`,
  }),
};
