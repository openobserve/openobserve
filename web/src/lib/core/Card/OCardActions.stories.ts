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
import OCardActions from '@/lib/core/Card/OCardActions.vue';
import OButton from '@/lib/core/Button/OButton.vue';
import OCard from '@/lib/core/Card/OCard.vue';

const meta: Meta<typeof OCardActions> = {
  title: 'Core/OCardActions',
  component: OCardActions,
  tags: ['autodocs'],
  args: {
    align: "right",
  },
  argTypes: {
    align: { control: { type: 'select' }, options: ["left","center","right","between"], description: 'Horizontal alignment of action buttons. Defaults to "right" ΓÇö the most common case (write zero props).' },
  },
};

export default meta;
type Story = StoryObj<typeof OCardActions>;

export const Playground: Story = {
  render: (args) => ({
    components: { OCardActions, OButton, OCard },
    setup() {
      return { args };
    },
    template: `<OCard ><OCardActions v-bind="args"><OButton variant="ghost" size="sm">Cancel</OButton><OButton size="sm">Save</OButton></OCardActions></OCard>`,
  }),
};
