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
import OFormTagInput from '@/lib/forms/TagInput/OFormTagInput.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import { z } from 'zod';

const meta: Meta<typeof OFormTagInput> = {
  title: 'Forms/TagInput/OFormTagInput',
  component: OFormTagInput,
  tags: ['autodocs'],
  argTypes: {
    name: { control: 'text', description: 'Field name — must match a key in the parent OForm\'s defaultValues' },
    placeholder: { control: 'text', description: 'Placeholder shown when there are no tags (forwarded to OTagInput)' },
    label: { control: 'text', description: 'Floating label (forwarded to OTagInput)' },
  },
};

export default meta;
type Story = StoryObj<typeof OFormTagInput>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFormTagInput, OForm },
    setup() {
      const demoSchema = z.object({ demo: z.any() });
      return { args, demoSchema };
    },
    template: `<OForm :schema="demoSchema" class="w-full max-w-md"><OFormTagInput name="demo" v-bind="args"></OFormTagInput></OForm>`,
  }),
};
