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
import ODropdownGroup from '@/lib/overlay/Dropdown/ODropdownGroup.vue';
import ODropdownItem from '@/lib/overlay/Dropdown/ODropdownItem.vue';
import ODropdown from '@/lib/overlay/Dropdown/ODropdown.vue';
import OButton from '@/lib/core/Button/OButton.vue';

const meta: Meta<typeof ODropdownGroup> = {
  title: 'Overlay/ODropdownGroup',
  component: ODropdownGroup,
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text', description: 'Optional visible group label' },
  },
};

export default meta;
type Story = StoryObj<typeof ODropdownGroup>;

export const Playground: Story = {
  render: (args) => ({
    components: { ODropdownGroup, ODropdownItem, ODropdown, OButton },
    setup() {
      const open = ref(false);
      return { args, open };
    },
    template: `<ODropdown ><template #trigger><OButton variant="outline" size="sm">Open menu</OButton></template><ODropdownGroup v-bind="args" :label="'Actions'"><ODropdownItem>Edit</ODropdownItem></ODropdownGroup></ODropdown>`,
  }),
};
