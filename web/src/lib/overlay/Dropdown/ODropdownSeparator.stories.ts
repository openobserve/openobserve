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
import ODropdownSeparator from '@/lib/overlay/Dropdown/ODropdownSeparator.vue';
import ODropdown from '@/lib/overlay/Dropdown/ODropdown.vue';
import OButton from '@/lib/core/Button/OButton.vue';

const meta: Meta<typeof ODropdownSeparator> = {
  title: 'Overlay/Dropdown/ODropdownSeparator',
  component: ODropdownSeparator,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ODropdownSeparator>;

export const Playground: Story = {
  render: (args) => ({
    components: { ODropdownSeparator, ODropdown, OButton },
    setup() {
      const open = ref(false);
      return { args, open };
    },
    template: `<ODropdown ><template #trigger><OButton variant="outline" size="sm">Open menu</OButton></template><ODropdownSeparator v-bind="args" /></ODropdown>`,
  }),
};
