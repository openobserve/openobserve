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
import ONavGroup from '@/lib/core/Navbar/ONavGroup.vue';

const meta: Meta<typeof ONavGroup> = {
  title: 'Core/Navbar/ONavGroup',
  component: ONavGroup,
  tags: ['autodocs'],
  argTypes: {
    groupKey: { control: 'text' },
    title: { control: 'text' },
    icon: { control: 'text' },
    children: { control: false },
    parentItem: { control: false },
  },
};

export default meta;
type Story = StoryObj<typeof ONavGroup>;

export const Playground: Story = {
  render: () => ({
    components: { ONavGroup },
    template: `<div class="text-sm text-text-secondary">See the Docs tab / Controls for the full API of &lt;ONavGroup&gt;. This component needs application context to render standalone.</div>`,
  }),
};
