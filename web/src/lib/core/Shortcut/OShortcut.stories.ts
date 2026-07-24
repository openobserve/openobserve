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
import OShortcut from '@/lib/core/Shortcut/OShortcut.vue';

const meta: Meta<typeof OShortcut> = {
  title: 'Core/Shortcut/OShortcut',
  component: OShortcut,
  tags: ['autodocs'],
  args: {
    size: "sm",
  },
  argTypes: {
    keys: { control: false, description: 'The shortcut to render as keycaps. Modifier tokens are symbolised and made platform-aware automatically (ctrl → ⌘ on Mac, Ctrl on Windows; - a string combo ("ctrl+enter", "ctrl+shift+a", "?") — rendered as a single keycap (⌘↵, ⌘⇧A, ?). - an array — one keycap per element (["g", "l"] → G L); each ele' },
    id: { control: 'text', description: 'Registry shortcut id — resolves the keys from shortcutRegistry.ts (the Ignored when keys is provided.' },
    size: { control: { type: 'select' }, options: ["sm","md"], description: 'Keycap size. Default: "sm"' },
  },
};

export default meta;
type Story = StoryObj<typeof OShortcut>;

export const Playground: Story = {
  render: (args) => ({
    components: { OShortcut },
    setup() {
      return { args };
    },
    template: `<OShortcut v-bind="args" :keys="['\u2318', 'K']" />`,
  }),
};

export const Sizes: Story = {
  render: () => ({
    components: { OShortcut },
    setup() {
      return { options: ["sm","md"] };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OShortcut :size="opt" :keys="['\u2318', 'K']"></OShortcut>
        </div>
      </div>
    `,
  }),
};
