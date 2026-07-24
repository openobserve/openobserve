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
import ONavbar from '@/lib/core/Navbar/ONavbar.vue';

const meta: Meta<typeof ONavbar> = {
  title: 'Core/Navbar/ONavbar',
  component: ONavbar,
  tags: ['autodocs'],
  args: {
    miniMode: false,
    visible: true,
  },
  argTypes: {
    linksList: { control: false },
    miniMode: { control: 'boolean' },
    visible: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof ONavbar>;

export const Playground: Story = {
  render: () => ({
    components: { ONavbar },
    template: `<div class="text-sm text-text-secondary">See the Docs tab / Controls for the full API of &lt;ONavbar&gt;. This component needs application context to render standalone.</div>`,
  }),
};
