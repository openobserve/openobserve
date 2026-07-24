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
import OInput from '@/lib/forms/Input/OInput.vue';

const meta: Meta<typeof OInput> = {
  title: 'Forms/Input/OInput',
  component: OInput,
  tags: ['autodocs'],
  args: {
    type: "text",
    clearable: false,
    readonly: false,
    disabled: false,
    autofocus: false,
    autogrow: false,
    rows: 3,
    size: "md",
    labelPosition: "outside",
  },
  argTypes: {
    modelModifiers: { control: false, description: 'v-model modifiers passthrough for number/trim semantics' },
    type: { control: { type: 'select' }, options: ["text","password","email","number","search","url","tel","textarea"], description: 'HTML input type — use textarea for a multi-line field' },
    label: { control: 'text', description: 'Floating / static label' },
    placeholder: { control: 'text', description: 'Placeholder text' },
    helpText: { control: 'text', description: 'Helper text displayed below the field' },
    errorMessage: { control: 'text', description: 'Error message — when provided the field shows error styling' },
    error: { control: 'boolean', description: 'Marks the field as being in an error state without a message' },
    prefix: { control: 'text', description: 'Text prefix rendered inside the field (left)' },
    suffix: { control: 'text', description: 'Text suffix rendered inside the field (right)' },
    clearable: { control: 'boolean', description: 'Shows a ✕ button to clear the field' },
    readonly: { control: 'boolean', description: 'Prevents value editing' },
    disabled: { control: 'boolean', description: 'Prevents interaction' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    autofocus: { control: 'boolean', description: 'Focuses the input on mount' },
    debounce: { control: 'number', description: 'Debounce delay in milliseconds before emitting model updates' },
    autogrow: { control: 'boolean', description: 'Auto-resize textarea height to fit content' },
    mask: { control: 'text', description: 'Input mask compatibility (supports time, fulltime, DD-MM-YYYY)' },
    maxlength: { control: 'number', description: 'Maximum character length — shows a counter when set' },
    rows: { control: 'number', description: 'Rows for textarea type' },
    size: { control: { type: 'select' }, options: ["sm","md"], description: 'Control size' },
    id: { control: 'text', description: 'HTML id' },
    name: { control: 'text', description: 'HTML name' },
    autocomplete: { control: 'text', description: 'HTML autocomplete' },
    width: { control: { type: 'select' }, options: ["xs","sm","md","lg","full"], description: 'Semantic field width — controls how wide the component renders. Defaults to "full" (fills the container). FieldWidth' },
    labelPosition: { control: { type: 'select' }, options: ["inside","outside"], description: 'Position of the label: \'outside\' renders above the field (default), \'inside\' renders as a compact floating mini-label inside the field border.' },
  },
};

export default meta;
type Story = StoryObj<typeof OInput>;

export const Playground: Story = {
  render: (args) => ({
    components: { OInput },
    setup() {
      const model = ref('');
      return { args, model };
    },
    template: `<div class="w-72"><OInput v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)" :label="'Field label'" :placeholder="'Type here'" /></div>`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    components: { OInput },
    setup() {
      const model = ref('');
      return { options: ["sm","md"], model };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OInput :size="opt" :model-value="model" @update:model-value="(v) => (model = v)" :label="'Field label'" :placeholder="'Type here'"></OInput>
        </div>
      </div>
    `,
  }),
};
