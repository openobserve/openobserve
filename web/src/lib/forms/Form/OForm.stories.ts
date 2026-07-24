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
import OForm from '@/lib/forms/Form/OForm.vue';
import OFormInput from '@/lib/forms/Input/OFormInput.vue';
import OButton from '@/lib/core/Button/OButton.vue';
import { z } from 'zod';

const meta: Meta<typeof OForm> = {
  title: 'Forms/Form/OForm',
  component: OForm,
  tags: ['autodocs'],
  argTypes: {
    defaultValues: { control: false },
    greedy: { control: 'boolean' },
    onSubmit: { control: false },
    schema: { control: false },
    form: { control: false },
  },
};

export default meta;
type Story = StoryObj<typeof OForm>;

export const Playground: Story = {
  render: (args) => ({
    components: { OForm, OFormInput, OButton },
    setup() {
      return { args, demoSchema: z.object({ name: z.string().min(1), email: z.string().email() }) };
    },
    template: `
      <OForm v-bind="args" :schema="demoSchema" class="w-80">
        <OFormInput name="name" label="Name" placeholder="Jane Doe" />
        <OFormInput name="email" label="Email" placeholder="jane@openobserve.ai" />
        <OButton type="submit" class="mt-2">Submit</OButton>
      </OForm>
    `,
  }),
};
