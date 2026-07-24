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
import OFormDateTimeRange from '@/lib/forms/DateTime/OFormDateTimeRange.vue';

const meta: Meta<typeof OFormDateTimeRange> = {
  title: 'Forms/OFormDateTimeRange',
  component: OFormDateTimeRange,
  tags: ['autodocs'],
  argTypes: {
    name: { control: 'text', description: 'Field name — must match a key in the parent OForm\'s defaultValues' },
    label: { control: 'text', description: 'Optional header label rendered above the picker (DateTime has none of its own).' },
    required: { control: 'boolean', description: 'Render the required   after the label (never hardcode the asterisk).' },
    description: { control: 'text', description: 'Optional helper line rendered under the label.' },
  },
};

export default meta;
type Story = StoryObj<typeof OFormDateTimeRange>;

export const Playground: Story = {
  render: () => ({
    components: { OFormDateTimeRange },
    template: `<div class="text-sm text-text-secondary">See the Docs tab / Controls for the full API of &lt;OFormDateTimeRange&gt;. This component needs application context to render standalone.</div>`,
  }),
};
