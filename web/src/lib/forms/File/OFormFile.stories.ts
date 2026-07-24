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
import OFormFile from '@/lib/forms/File/OFormFile.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import { z } from 'zod';

const meta: Meta<typeof OFormFile> = {
  title: 'Forms/File/OFormFile',
  component: OFormFile,
  tags: ['autodocs'],
  argTypes: {
    name: { control: 'text', description: 'Field name — must match a key in the parent OForm\'s defaultValues' },
    multiple: { control: 'boolean', description: 'Allow multiple file selection' },
    accept: { control: 'text', description: 'Comma-separated list of MIME types / extensions (e.g. "image/ ,.pdf")' },
    maxFileSize: { control: 'number', description: 'Maximum allowed file size in bytes — emits "size-error" when exceeded' },
    dropZone: { control: 'boolean', description: 'Show drag-and-drop drop zone' },
    label: { control: 'text', description: 'Label rendered above the control' },
    placeholder: { control: 'text', description: 'Placeholder displayed when no file is selected' },
    helpText: { control: 'text', description: 'Helper text below the control' },
    errorMessage: { control: 'text', description: 'Error message — when provided the field shows error styling' },
    error: { control: 'boolean', description: 'Marks the field as being in error state without a message' },
    disabled: { control: 'boolean', description: 'Prevents interaction' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    size: { control: { type: 'select' }, options: ["sm","md"], description: 'Control size' },
    id: { control: 'text', description: 'HTML id' },
  },
};

export default meta;
type Story = StoryObj<typeof OFormFile>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFormFile, OForm },
    setup() {
      const demoSchema = z.object({ demo: z.any() });
      return { args, demoSchema };
    },
    template: `<OForm :schema="demoSchema" class="w-full max-w-md"><OFormFile name="demo" v-bind="args"></OFormFile></OForm>`,
  }),
};
