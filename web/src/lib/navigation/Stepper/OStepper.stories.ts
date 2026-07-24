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
import OStepper from '@/lib/navigation/Stepper/OStepper.vue';
import OStep from '@/lib/navigation/Stepper/OStep.vue';

const meta: Meta<typeof OStepper> = {
  title: 'Navigation/OStepper',
  component: OStepper,
  tags: ['autodocs'],
  args: {
    orientation: "horizontal",
    animated: true,
    navigable: false,
    expanded: false,
  },
  argTypes: {
    orientation: { control: { type: 'select' }, options: ["horizontal","vertical"], description: 'Layout direction. Default: \'horizontal\'' },
    animated: { control: 'boolean', description: 'Animate step panel transitions. Default: true' },
    navigable: { control: 'boolean', description: 'Allow clicking completed step headers to navigate back. Default: false' },
    expanded: { control: 'boolean', description: 'Render ALL step panels at once (a progress checklist / timeline) instead of only the active step\'s panel (the default wizard behavior). modelValue still drives which step is highlighted as active. Works in both orientations. Default: false.' },
  },
};

export default meta;
type Story = StoryObj<typeof OStepper>;

export const Playground: Story = {
  render: (args) => ({
    components: { OStepper, OStep },
    setup() {
      const model = ref('one');
      return { args, model };
    },
    template: `<div class="w-96"><OStepper v-bind="args" :model-value="model" @update:model-value="(v) => (model = v)"><OStep name="one" title="One" /><OStep name="two" title="Two" /></OStepper></div>`,
  }),
};
