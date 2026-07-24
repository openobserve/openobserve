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
import OSelect from '@/lib/forms/Select/OSelect.vue';

const meta: Meta<typeof OSelect> = {
  title: 'Forms/OSelect',
  component: OSelect,
  tags: ['autodocs'],
  args: {
    multiple: false,
    searchable: true,
    searchDebounce: 0,
    hideSelected: false,
    collapsibleGroups: false,
    creatable: false,
    searchPlaceholder: "Search...",
    error: false,
    clearable: false,
    disabled: false,
    size: "md",
    labelPosition: "outside",
    rowClickSingleSelect: false,
    optionTooltip: false,
  },
  argTypes: {
    options: { control: false, description: 'Flat list of options. When provided, OSelectItem nodes are rendered automatically. For grouped or custom-rendered options, use the default slot instead.' },
    multiple: { control: 'boolean', description: 'Allows selecting multiple options' },
    maxVisibleChips: { control: 'number', description: 'Maximum number of selection chips rendered in the trigger before the rest collapse into a "+N more" indicator. Defaults to 3. Only meaningful when multiple is true.' },
    searchable: { control: 'boolean', description: 'Enables local text filtering / combobox mode' },
    searchDebounce: { control: 'number', description: 'Debounce (ms) before emitting search events' },
    hideSelected: { control: 'boolean', description: 'Hides already selected options in multiple mode' },
    collapsibleGroups: { control: 'boolean', description: 'Makes group headers (options with header: true) clickable to collapse / expand their items — an accordion inside the dropdown. Default off, so existing selects are unaffected. Ignored while a search term is active (search always spans every group).' },
    selectAll: { control: 'boolean', description: 'Renders a "Select All" master row at the top of the dropdown (multi-select selected, a check when all are, and toggles the entire selection on click.' },
    creatable: { control: 'boolean', description: 'Allows creating new values by typing — emits event' },
    dropdownStyle: { control: 'text', description: 'Optional dropdown content style passthrough' },
    searchPlaceholder: { control: 'text', description: 'Placeholder text shown in the internal search input' },
    labelKey: { control: 'text', description: 'Key to read label from each option object' },
    valueKey: { control: 'text', description: 'Key to read value from each option object' },
    iconKey: { control: 'text', description: 'Key to read a OIcon name from each option object — when set, renders an icon before the label in the dropdown list' },
    label: { control: 'text', description: 'Floating label rendered above the trigger' },
    required: { control: 'boolean', description: 'Marks the field required — renders a   after the label (no manual  ).' },
    placeholder: { control: 'text', description: 'Placeholder text shown when no value is selected' },
    errorMessage: { control: 'text', description: 'Error message — when truthy the field shows error styling' },
    error: { control: 'boolean', description: 'Marks the field in error state without a message' },
    clearable: { control: 'boolean', description: 'Shows a ✕ button to clear the selection' },
    disabled: { control: 'boolean', description: 'Prevents value changes' },
    size: { control: { type: 'select' }, options: ["sm","md"], description: 'Control size' },
    id: { control: 'text', description: 'HTML id' },
    name: { control: 'text', description: 'HTML name' },
    helpText: { control: 'text', description: 'Helper text displayed below the field' },
    width: { control: { type: 'select' }, options: ["xs","sm","md","lg","full"], description: 'Semantic field width — controls how wide the component renders. Defaults to "full" (fills the container). FieldWidth' },
    labelPosition: { control: { type: 'select' }, options: ["inside","outside"], description: 'Controls where the label is rendered. - "outside" (default): label sits above the trigger as a separate element. - "inside": label is rendered as a compact inline prefix inside the trigger, saving vertical space when the label is short (e.g. in config panels).' },
    loading: { control: 'boolean', description: 'When true, replaces the chevron with a spinner to indicate async loading' },
    rowClickSingleSelect: { control: 'boolean', description: 'In multi-select mode, controls what a row click does vs a checkbox click. - false (default): clicking anywhere on a row toggles that item (standard multi-select). - true: clicking the row label/text single-selects that item (replaces the whole selection' },
    optionTooltip: { control: 'boolean', description: 'When true, shows the full option label as a native tooltip on hover (useful when labels are truncated).' },
  },
};

export default meta;
type Story = StoryObj<typeof OSelect>;

export const Playground: Story = {
  render: (args) => ({
    components: { OSelect },
    setup() {
      const sampleOptions = [{ label: 'Logs', value: 'logs' }, { label: 'Metrics', value: 'metrics' }, { label: 'Traces', value: 'traces' }];
      const model = ref(null);
      return { args, sampleOptions, model };
    },
    template: `<div class="w-72"><OSelect v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)" :options="sampleOptions">{{ args.default }}</OSelect></div>`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    components: { OSelect },
    setup() {
      const sampleOptions = [{ label: 'Logs', value: 'logs' }, { label: 'Metrics', value: 'metrics' }, { label: 'Traces', value: 'traces' }];
      const model = ref(null);
      return { options: ["sm","md"], sampleOptions, model };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OSelect :size="opt" :model-value="model" @update:model-value="(v) => (model = v)" :options="sampleOptions">Demo</OSelect>
        </div>
      </div>
    `,
  }),
};
