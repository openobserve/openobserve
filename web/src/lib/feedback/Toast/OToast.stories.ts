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
import OToast from '@/lib/feedback/Toast/OToast.vue';

const meta: Meta<typeof OToast> = {
  title: 'Feedback/OToast',
  component: OToast,
  tags: ['autodocs'],
  args: {
    open: true,
    count: 1,
    variant: "default",
    position: "bottom-right",
  },
  argTypes: {
    id: { control: 'text' },
    open: { control: 'boolean' },
    count: { control: 'number', description: 'Number of identical toasts collapsed into this one; badge shown when > 1' },
    timerKey: { control: 'number', description: 'Increments each time a duplicate resets the timer; used to restart the progress bar animation' },
    details: { control: false },
    titleCount: { control: 'number' },
    variant: { control: { type: 'select' }, options: ["success","error","warning","info","loading","default"], description: 'Visual style + icon set' },
    message: { control: 'text', description: 'Primary message text — plain string only (no HTML)' },
    title: { control: 'text', description: 'Optional bold title above message' },
    timeout: { control: 'number', description: 'Auto-dismiss delay in ms. 0 = persistent. Defaults per variant.' },
    position: { control: { type: 'select' }, options: ["top-center","top-right","top-left","bottom-center","bottom-right","bottom-left"], description: 'Where the toast appears on screen' },
    action: { control: false, description: 'Optional action button rendered inside the toast' },
    onDismiss: { control: false, description: 'Called once when this toast is dismissed (either by user or auto-timeout)' },
  },
};

export default meta;
type Story = StoryObj<typeof OToast>;

export const Playground: Story = {
  render: () => ({
    components: { OToast },
    template: `<div class="text-sm text-text-secondary">See the Docs tab / Controls for the full API of &lt;OToast&gt;. This component needs application context to render standalone.</div>`,
  }),
};
