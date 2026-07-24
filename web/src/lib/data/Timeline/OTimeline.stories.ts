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
import OTimeline from '@/lib/data/Timeline/OTimeline.vue';
import OTimelineItem from '@/lib/data/Timeline/OTimelineItem.vue';

const meta: Meta<typeof OTimeline> = {
  title: 'Data/OTimeline',
  component: OTimeline,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof OTimeline>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTimeline, OTimelineItem },
    setup() {
      return { args };
    },
    template: `<OTimeline v-bind="args"><OTimelineItem title="Created" subtitle="09:00" /><OTimelineItem title="Updated" subtitle="10:30" /></OTimeline>`,
  }),
};
