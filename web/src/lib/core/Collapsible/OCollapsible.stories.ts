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
import OCollapsible from '@/lib/core/Collapsible/OCollapsible.vue';

const meta: Meta<typeof OCollapsible> = {
  title: 'Core/OCollapsible',
  component: OCollapsible,
  tags: ['autodocs'],
  args: {
    defaultOpen: false,
    variant: "default",
  },
  argTypes: {
    label: { control: 'text', description: 'Trigger label text (used when no #trigger slot is provided)' },
    icon: { control: 'text', description: 'Material icon name shown before the label. Pass the icon name string e.g. "settings" or "expand_more".' },
    caption: { control: 'text', description: 'Secondary caption text below the label' },
    defaultOpen: { control: 'boolean', description: 'Initial open state (uncontrolled). When modelValue is also provided, modelValue takes precedence.' },
    modelValue: { control: 'boolean', description: 'Controlled open state. Use with v-model. When provided, the parent owns the open/close state.' },
    group: { control: 'text', description: 'Accordion group name. All OCollapsible items with the same group string will behave as an accordion — only one can be open at a time.' },
    variant: { control: { type: 'select' }, options: ["default","sidebar"], description: 'Visual layout variant. - \'default\' — chevron on the right, rounded trigger (general content sections) - \'sidebar\' — chevron on the left, flush trigger (sidebar/config panel sections)' },
    triggerClass: { control: 'text', description: 'Extra classes applied directly to the trigger button element.' },
  },
};

export default meta;
type Story = StoryObj<typeof OCollapsible>;

export const Playground: Story = {
  render: (args) => ({
    components: { OCollapsible },
    setup() {
      return { args };
    },
    template: `<OCollapsible v-bind="args" :label="'Advanced settings'"><div class="p-3 text-sm text-text-secondary">Panel body content.</div></OCollapsible>`,
  }),
};

export const Variants: Story = {
  render: () => ({
    components: { OCollapsible },
    setup() {
      return { options: ["default","sidebar"] };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OCollapsible :variant="opt" :label="'Advanced settings'"><div class="p-3 text-sm text-text-secondary">Panel body content.</div></OCollapsible>
        </div>
      </div>
    `,
  }),
};
