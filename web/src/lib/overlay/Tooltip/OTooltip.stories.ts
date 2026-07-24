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
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue';
import OButton from '@/lib/core/Button/OButton.vue';

const meta: Meta<typeof OTooltip> = {
  title: 'Overlay/OTooltip',
  component: OTooltip,
  tags: ['autodocs'],
  args: {
    side: "top",
    align: "center",
    delay: 700,
    maxWidth: "320px",
    disabled: false,
    hoverable: false,
  },
  argTypes: {
    content: { control: 'text', description: 'Tooltip text ΓÇö shorthand for #content slot when content is plain text' },
    side: { control: { type: 'select' }, options: ["top","right","bottom","left"], description: 'Which side of the trigger to render the tooltip on' },
    align: { control: { type: 'select' }, options: ["start","center","end"], description: 'Alignment along the chosen side' },
    sideOffset: { control: false, description: 'Gap in pixels between trigger edge and tooltip bubble' },
    alignOffset: { control: false, description: 'Shift along the alignment axis' },
    delay: { control: 'number', description: 'Milliseconds before tooltip shows on hover (maps to delayDuration)' },
    maxWidth: { control: 'text', description: 'CSS max-width of the tooltip content bubble' },
    disabled: { control: 'boolean', description: 'When true, the tooltip never opens' },
    hoverable: { control: 'boolean', description: 'When true, the tooltip stays open while the pointer moves onto the bubble, so its content can be hovered/selected/copied (useful for long error text closes as soon as the pointer leaves the trigger.' },
    open: { control: 'boolean', description: 'Controlled open state ΓÇö omit for uncontrolled' },
    contentClass: { control: 'text', description: 'Extra CSS class applied to the tooltip bubble element' },
    shortcut: { control: false, description: 'Renders a keyboard-shortcut hint (OShortcut keycaps) after the content. Accepts a pre-symbolised string ("⌘⇧A") or an array of keycaps (["⌘", "⇧", "A"]). Omit to show no hint.' },
    shortcutId: { control: 'text', description: 'Registry shortcut id — resolves the hint keys from shortcutRegistry.ts (the single source of truth) so a key change there updates this tooltip too. Prefer this over shortcut; shortcut wins if both are set.' },
  },
};

export default meta;
type Story = StoryObj<typeof OTooltip>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTooltip, OButton },
    setup() {
      return { args };
    },
    template: `<OButton variant="outline" class="relative">Hover me<OTooltip v-bind="args" :content="'Tooltip text'" /></OButton>`,
  }),
};
