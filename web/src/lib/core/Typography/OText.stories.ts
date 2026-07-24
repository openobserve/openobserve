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
import OText from '@/lib/core/Typography/OText.vue';

const meta: Meta<typeof OText> = {
  title: 'Core/OText',
  component: OText,
  tags: ['autodocs'],
  args: {
    variant: "body",
    truncate: false,
    nowrap: false,
    default: 'The quick brown fox jumps over the lazy dog.',
  },
  argTypes: {
    variant: { control: { type: 'select' }, options: ["page-title","section","panel-title","body","body-strong","label","meta","mono"], description: 'Visual and semantic variant. "body"' },
    as: { control: 'text', description: 'Override the rendered HTML element. Each variant has a sensible default — see the mapping in OText.vue. Common overrides: - as="h1" on variant="page-title" for the page\'s single heading - as="span" on variant="body" when an inline context is needed - as="div" on variant="section" for non-heading gro' },
    truncate: { control: 'boolean', description: 'Truncate text with ellipsis on overflow. Adds overflow: hidden; text-overflow: ellipsis; white-space: nowrap.' },
    nowrap: { control: 'boolean', description: 'Prevent line wrapping (white-space: nowrap). Useful for table cells and labels that must stay on one line.' },
  },
};

export default meta;
type Story = StoryObj<typeof OText>;

export const Playground: Story = {
  render: (args) => ({
    components: { OText },
    setup() {
      return { args };
    },
    template: `<OText v-bind="args">{{ args.default }}</OText>`,
  }),
};

export const Variants: Story = {
  render: () => ({
    components: { OText },
    setup() {
      return { options: ["page-title","section","panel-title","body","body-strong","label","meta","mono"] };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OText :variant="opt" >The quick brown fox jumps over the lazy dog.</OText>
        </div>
      </div>
    `,
  }),
};
