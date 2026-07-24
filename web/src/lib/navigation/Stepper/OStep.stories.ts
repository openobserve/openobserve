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
import OStep from '@/lib/navigation/Stepper/OStep.vue';
import OStepper from '@/lib/navigation/Stepper/OStepper.vue';

const meta: Meta<typeof OStep> = {
  title: 'Navigation/Stepper/OStep',
  component: OStep,
  tags: ['autodocs'],
  args: {
    done: false,
    error: false,
  },
  argTypes: {
    name: { control: 'number', description: 'Step identifier ΓÇö unique within the stepper, matched against OStepper\'s v-model' },
    title: { control: 'text', description: 'Step header label shown in the indicator row' },
    icon: { control: false, description: 'OIcon name string or Lucide component shown in the step indicator (replaced by checkmark when done)' },
    done: { control: 'boolean', description: 'Marks this step as completed ΓÇö shows a checkmark. Typically :done="step > N". Default: false' },
    navigable: { control: 'boolean', description: 'Per-step override for header click navigation. Undefined means inherit from the parent OStepper\'s navigable prop.' },
    description: { control: 'text', description: 'Optional subtitle shown below the title in the step header.' },
    error: { control: 'boolean', description: 'Shows an error state in the step indicator. Default: false' },
  },
};

export default meta;
type Story = StoryObj<typeof OStep>;

export const Playground: Story = {
  render: (args) => ({
    components: { OStep, OStepper },
    setup() {
      const p_model = ref('one');
      return { args, p_model };
    },
    template: `<OStepper :model-value="p_model" @update:model-value="(v) => (p_model = v)"><OStep v-bind="args" :name="'one'" :title="'Step one'">{{ args.default }}</OStep></OStepper>`,
  }),
};
