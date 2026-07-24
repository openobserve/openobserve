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
import OCardSection from '@/lib/core/Card/OCardSection.vue';
import OCard from '@/lib/core/Card/OCard.vue';

const meta: Meta<typeof OCardSection> = {
  title: 'Core/Card/OCardSection',
  component: OCardSection,
  tags: ['autodocs'],
  args: {
    scrollable: false,
  },
  argTypes: {
    role: { control: { type: 'select' }, options: ["header","body","footer"], description: 'Semantic zone role. - "header" ΓÇö flex row, items-center, non-growing, header padding - "body" ΓÇö grows, body padding - "footer" ΓÇö shrinks, footer padding Omit for a plain unstyled section ΓÇö apply classes directly.' },
    scrollable: { control: 'boolean', description: 'Adds overflow-y: auto and forces the section to fill remaining space. Only meaningful with role="body".' },
  },
};

export default meta;
type Story = StoryObj<typeof OCardSection>;

export const Playground: Story = {
  render: (args) => ({
    components: { OCardSection, OCard },
    setup() {
      return { args };
    },
    template: `<OCard ><OCardSection v-bind="args"><div class="text-sm text-text-secondary">Section content</div></OCardSection></OCard>`,
  }),
};
