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
import OTimelineItem from '@/lib/data/Timeline/OTimelineItem.vue';
import OTimeline from '@/lib/data/Timeline/OTimeline.vue';

const meta: Meta<typeof OTimelineItem> = {
  title: 'Data/Timeline/OTimelineItem',
  component: OTimelineItem,
  tags: ['autodocs'],
  args: {
    variant: "primary",
  },
  argTypes: {
    title: { control: 'text', description: 'Header text rendered in bold above the subtitle.' },
    subtitle: { control: 'text', description: 'Secondary line rendered below the title in muted text.' },
    icon: { control: 'text', description: 'Material icon name rendered inside the dot. Uses the material-icons font — pass the icon ligature string (e.g. "check_circle", "play_arrow"). When omitted the dot is rendered as a plain filled circle.' },
    variant: { control: { type: 'select' }, options: ["primary","success","destructive","info","muted"], description: 'Controls dot background colour. Defaults to "primary".' },
  },
};

export default meta;
type Story = StoryObj<typeof OTimelineItem>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTimelineItem, OTimeline },
    setup() {
      return { args };
    },
    template: `<OTimeline ><OTimelineItem v-bind="args" :title="'Event'" :subtitle="'just now'">{{ args.default }}</OTimelineItem></OTimeline>`,
  }),
};
