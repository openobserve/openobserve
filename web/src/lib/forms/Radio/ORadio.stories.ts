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
import ORadio from '@/lib/forms/Radio/ORadio.vue';
import ORadioGroup from '@/lib/forms/Radio/ORadioGroup.vue';

const meta: Meta<typeof ORadio> = {
  title: 'Forms/ORadio',
  component: ORadio,
  tags: ['autodocs'],
  args: {
    size: "md",
    disabled: false,
  },
  argTypes: {
    value: { control: false, description: 'The value this radio represents. Compared against ORadioGroup\'s modelValue to determine checked state.' },
    val: { control: false, description: 'Compatibility alias for value' },
    label: { control: 'text', description: 'Accessible label' },
    size: { control: { type: 'select' }, options: ["xs","sm","md"], description: 'Control size' },
    disabled: { control: 'boolean', description: 'Prevents interaction' },
    id: { control: 'text', description: 'HTML id — forwarded for label association' },
  },
};

export default meta;
type Story = StoryObj<typeof ORadio>;

export const Playground: Story = {
  render: (args) => ({
    components: { ORadio, ORadioGroup },
    setup() {
      const p_model = ref('a');
      return { args, p_model };
    },
    template: `<ORadioGroup :model-value="p_model" @update:model-value="(v) => (p_model = v)"><ORadio v-bind="args" :value="'a'" :label="'Choice A'" /></ORadioGroup>`,
  }),
};
