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
import ODropdownItem from '@/lib/overlay/Dropdown/ODropdownItem.vue';
import ODropdown from '@/lib/overlay/Dropdown/ODropdown.vue';
import OButton from '@/lib/core/Button/OButton.vue';

const meta: Meta<typeof ODropdownItem> = {
  title: 'Overlay/ODropdownItem',
  component: ODropdownItem,
  tags: ['autodocs'],
  args: {
    variant: "default",
    disabled: false,
    default: 'Menu item',
  },
  argTypes: {
    variant: { control: { type: 'select' }, options: ["default","destructive"], description: 'Visual intent — use destructive for Delete/Remove actions' },
    disabled: { control: 'boolean', description: 'Prevents the user from interacting with this item' },
    textValue: { control: 'text', description: 'Text used for typeahead matching (overrides text content)' },
    iconLeft: { control: 'text', description: 'Icon placed before the label — renders an OIcon internally' },
    shortcut: { control: false, description: 'Renders a keyboard-shortcut hint (OShortcut keycaps) at the trailing edge of the item. Accepts a pre-symbolised string ("⌘I") or an array of keycaps (["⌘", "I"]). Omit to show no hint.' },
    shortcutId: { control: 'text', description: 'Registry shortcut id — resolves the hint keys from shortcutRegistry.ts (the single source of truth) so a key change there updates this item too. Prefer this over shortcut; shortcut wins if both are set.' },
  },
};

export default meta;
type Story = StoryObj<typeof ODropdownItem>;

export const Playground: Story = {
  render: (args) => ({
    components: { ODropdownItem, ODropdown, OButton },
    setup() {
      const open = ref(false);
      return { args, open };
    },
    template: `<ODropdown ><template #trigger><OButton variant="outline" size="sm">Open menu</OButton></template><ODropdownItem v-bind="args">{{ args.default }}</ODropdownItem></ODropdown>`,
  }),
};
