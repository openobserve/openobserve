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
import OFile from '@/lib/forms/File/OFile.vue';

const meta: Meta<typeof OFile> = {
  title: 'Forms/File/OFile',
  component: OFile,
  tags: ['autodocs'],
  args: {
    multiple: false,
    dropZone: false,
    disabled: false,
    size: "md",
  },
  argTypes: {
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
    name: { control: 'text', description: 'HTML name' },
  },
};

export default meta;
type Story = StoryObj<typeof OFile>;

export const Playground: Story = {
  render: (args) => ({
    components: { OFile },
    setup() {
      const model = ref(null);
      return { args, model };
    },
    template: `<div class="w-96"><OFile v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)" /></div>`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    components: { OFile },
    setup() {
      const model = ref(null);
      return { options: ["sm","md"], model };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OFile :size="opt" :model-value="model" @update:model-value="(v) => (model = v)"></OFile>
        </div>
      </div>
    `,
  }),
};
