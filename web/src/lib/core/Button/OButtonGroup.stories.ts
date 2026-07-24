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
import OButtonGroup from '@/lib/core/Button/OButtonGroup.vue';
import OButton from '@/lib/core/Button/OButton.vue';

const meta: Meta<typeof OButtonGroup> = {
  title: 'Core/Button/OButtonGroup',
  component: OButtonGroup,
  tags: ['autodocs'],
  args: {
    orientation: "horizontal",
    align: "stretch",
    radius: "md",
  },
  argTypes: {
    orientation: { control: { type: 'select' }, options: ["horizontal","vertical"], description: 'Stack buttons horizontally (default) or vertically' },
    align: { control: { type: 'select' }, options: ["stretch","center","start","end"], description: 'Cross-axis alignment of child buttons. Defaults to \'stretch\'' },
    radius: { control: { type: 'select' }, options: ["sm","md","lg"], description: 'Corner radius applied to the group container clip. Must match the radius of the inner buttons to avoid corner artifacts. Use "sm" when children use size="chip" or size="icon-chip". Defaults to "md".' },
  },
};

export default meta;
type Story = StoryObj<typeof OButtonGroup>;

export const Playground: Story = {
  render: (args) => ({
    components: { OButtonGroup, OButton },
    setup() {
      return { args };
    },
    template: `<OButtonGroup v-bind="args"><OButton variant="outline">One</OButton><OButton variant="outline">Two</OButton><OButton variant="outline">Three</OButton></OButtonGroup>`,
  }),
};
