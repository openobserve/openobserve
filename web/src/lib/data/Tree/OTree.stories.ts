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
import OTree from '@/lib/data/Tree/OTree.vue';

const meta: Meta<typeof OTree> = {
  title: 'Data/Tree/OTree',
  component: OTree,
  tags: ['autodocs'],
  args: {
    tickStrategy: "leaf",
    filter: "",
    defaultExpandAll: false,
  },
  argTypes: {
    nodes: { control: false, description: 'Array of root nodes' },
    nodeKey: { control: 'text', description: 'Field on each node used as the unique key. Default: "label"' },
    tickStrategy: { control: { type: 'select' }, options: ["leaf"], description: 'Which nodes get tick checkboxes. Currently only "leaf" is supported: only leaf nodes are tickable; parent nodes show an indeterminate checkbox when partially selected.' },
    ticked: { control: false, description: 'Array of currently ticked node-key values' },
    expanded: { control: false, description: 'Array of currently expanded node-key values' },
    filter: { control: 'text', description: 'Filter string — nodes not matching are hidden' },
    filterMethod: { control: false, description: 'Custom filter predicate. (node: TreeNode, filter: string) => boolean When omitted, a case-insensitive label substring match is used.' },
    defaultExpandAll: { control: 'boolean', description: 'Expand all nodes on first render' },
  },
};

export default meta;
type Story = StoryObj<typeof OTree>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTree },
    setup() {
      const sampleNodes = [{ id: 'logs', label: 'Logs', children: [{ id: 'app', label: 'app' }, { id: 'sys', label: 'system' }] }, { id: 'metrics', label: 'Metrics' }];
      return { args, sampleNodes };
    },
    template: `<div class="w-72"><OTree v-bind="args" :nodes="sampleNodes" :node-key="'id'" /></div>`,
  }),
};
