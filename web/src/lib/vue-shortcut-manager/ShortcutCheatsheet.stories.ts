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
import ShortcutCheatsheet from './ShortcutCheatsheet.vue';

const meta: Meta<typeof ShortcutCheatsheet> = {
  title: 'Utilities/ShortcutCheatsheet',
  component: ShortcutCheatsheet,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ShortcutCheatsheet>;

/** Reference only — this component needs its parent's runtime context. */
export const Reference: Story = {
  render: () => ({
    template: `<div class="max-w-lg text-sm text-text-secondary">&lt;ShortcutCheatsheet&gt; is an internal piece of the shortcut-manager and only renders inside that live context. See the the shortcut-manager story for it in action.</div>`,
  }),
};
