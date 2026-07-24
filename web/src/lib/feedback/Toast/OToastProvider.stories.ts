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
import OToastProvider from '@/lib/feedback/Toast/OToastProvider.vue';

const meta: Meta<typeof OToastProvider> = {
  title: 'Feedback/Toast/OToastProvider',
  component: OToastProvider,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof OToastProvider>;

export const Playground: Story = {
  render: () => ({
    components: { OToastProvider },
    template: `<div class="text-sm text-text-secondary">See the Docs tab / Controls for the full API of &lt;OToastProvider&gt;. This component needs application context to render standalone.</div>`,
  }),
};
