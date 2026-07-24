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
import OVirtualScroll from '@/lib/core/VirtualScroll/OVirtualScroll.vue';

const meta: Meta<typeof OVirtualScroll> = {
  title: 'Core/OVirtualScroll',
  component: OVirtualScroll,
  tags: ['autodocs'],
  args: {
    overscan: 5,
    dynamicRowHeight: false,
  },
  argTypes: {
    items: { control: false, description: 'The full array of items to virtualize.' },
    estimateSize: { control: 'number', description: 'Estimated height of each item in pixels. Used for initial layout. More accurate values improve scroll thumb behaviour. 40' },
    overscan: { control: 'number', description: 'Number of extra items rendered above and below the visible viewport. Higher values reduce blank flashes during fast scrolling at the cost of more DOM nodes. 5' },
    scrollTarget: { control: false, description: 'External scroll container. When provided, that element\'s scroll position drives virtualization instead of the component\'s own container. Pass null (or omit) to use the component\'s internal scroll container.' },
    height: { control: 'text', description: 'CSS height of the internal scroll container. Only used when scrollTarget is not set. Accepts any valid CSS value: "400px", "100%", "50vh". When omitted the container grows to fill its parent (height: 100%).' },
    dynamicRowHeight: { control: 'boolean', description: 'When true, enables per-element DOM measurement via ResizeObserver so items with variable heights (wrapped text, expandable rows) are tracked correctly. When false (default), all items use estimateSize.' },
  },
};

export default meta;
type Story = StoryObj<typeof OVirtualScroll>;

export const Playground: Story = {
  render: (args) => ({
    components: { OVirtualScroll },
    setup() {
      const sampleItems = Array.from({ length: 200 }, (_, i) => ({ id: i, label: 'row ' + (i + 1) }));
      return { args, sampleItems };
    },
    template: `<div class="relative h-64 w-full overflow-hidden rounded-surface border border-border-default"><OVirtualScroll v-bind="args" :items="sampleItems" :height="'20rem'" :estimate-size="32"><template #default="{ item }"><div class="px-3 py-1 text-sm">{{ item.label }}</div></template></OVirtualScroll></div>`,
  }),
};
