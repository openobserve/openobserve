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
import OTextarea from '@/lib/forms/Input/OTextarea.vue';

const meta: Meta<typeof OTextarea> = {
  title: 'Forms/Input/OTextarea',
  component: OTextarea,
  tags: ['autodocs'],
  args: {
    rows: 3,
    autogrow: false,
    readonly: false,
    disabled: false,
    autofocus: false,
    size: "md",
    fill: false,
  },
  argTypes: {
    label: { control: 'text', description: 'Floating / static label' },
    placeholder: { control: 'text', description: 'Placeholder text' },
    helpText: { control: 'text', description: 'Helper text displayed below the field' },
    errorMessage: { control: 'text', description: 'Error message — when provided the field shows error styling' },
    error: { control: 'boolean', description: 'Marks the field as being in an error state without a message' },
    rows: { control: 'number', description: 'Number of visible rows' },
    autogrow: { control: 'boolean', description: 'Auto-resize to fit content' },
    readonly: { control: 'boolean', description: 'Prevents value editing' },
    disabled: { control: 'boolean', description: 'Prevents interaction' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    autofocus: { control: 'boolean', description: 'Focuses the textarea on mount' },
    maxlength: { control: 'number', description: 'Maximum character length — shows a counter when set' },
    id: { control: 'text', description: 'HTML id' },
    name: { control: 'text', description: 'HTML name' },
    autocomplete: { control: 'text', description: 'HTML autocomplete' },
    size: { control: { type: 'select' }, options: ["sm","md"], description: 'Control size' },
    width: { control: { type: 'select' }, options: ["xs","sm","md","lg","full"], description: 'Semantic field width — controls how wide the component renders. Defaults to "full" (fills the container). FieldWidth' },
    fill: { control: 'boolean', description: 'When true, the textarea stretches to fill its parent\'s height (instead of being sized by rows). Useful when the textarea lives inside a flex container that has a bounded height.' },
  },
};

export default meta;
type Story = StoryObj<typeof OTextarea>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTextarea },
    setup() {
      const model = ref('');
      return { args, model };
    },
    template: `<div class="w-72"><OTextarea v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)" :label="'Notes'" /></div>`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    components: { OTextarea },
    setup() {
      const model = ref('');
      return { options: ["sm","md"], model };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OTextarea :size="opt" :model-value="model" @update:model-value="(v) => (model = v)" :label="'Notes'"></OTextarea>
        </div>
      </div>
    `,
  }),
};
