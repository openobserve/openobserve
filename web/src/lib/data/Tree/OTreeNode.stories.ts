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
import OTreeNode from '@/lib/data/Tree/OTreeNode.vue';
import OTree from '@/lib/data/Tree/OTree.vue';

const meta: Meta<typeof OTreeNode> = {
  title: 'Data/OTreeNode',
  component: OTreeNode,
  tags: ['autodocs'],
  argTypes: {
    node: { control: false },
    depth: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof OTreeNode>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTreeNode, OTree },
    setup() {
      const sampleNode = { id: 'app', label: 'app logs' };
      return { args, sampleNode };
    },
    template: `<OTree :nodes="[sampleNode]" :node-key="'id'"><OTreeNode v-bind="args" :node="sampleNode" :depth="0" /></OTree>`,
  }),
};
