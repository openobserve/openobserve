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
import { ref } from 'vue';
import ODrawer from '@/lib/overlay/Drawer/ODrawer.vue';
import OButton from '@/lib/core/Button/OButton.vue';

const meta: Meta<typeof ODrawer> = {
  title: 'Overlay/Drawer/ODrawer',
  component: ODrawer,
  tags: ['autodocs'],
  args: {
    side: "right",
    persistent: false,
    size: "md",
    bleed: false,
    showClose: true,
    seamless: false,
    primaryButtonVariant: "primary",
    secondaryButtonVariant: "outline",
    neutralButtonVariant: "ghost",
    primaryButtonDisabled: false,
    secondaryButtonDisabled: false,
    neutralButtonDisabled: false,
    primaryButtonLoading: false,
    secondaryButtonLoading: false,
    neutralButtonLoading: false,
    lazy: true,
  },
  argTypes: {
    open: { control: 'boolean', description: 'Controlled open state — use with v-model:open' },
    side: { control: { type: 'select' }, options: ["right","left"], description: 'Edge the drawer slides in from. "right"' },
    persistent: { control: 'boolean', description: 'Prevents the drawer from closing when the user clicks the overlay or presses Escape. false' },
    size: { control: { type: 'select' }, options: ["sm","md","lg","xl","full"], description: 'Panel width preset. sm=360px  md=480px (default)  lg=640px  xl=800px  full=100vw "md"' },
    width: { control: 'number', description: 'Explicit panel width as a percentage of the viewport width (1–100). When provided, overrides the size preset entirely.' },
    bleed: { control: 'boolean', description: 'Full-bleed body (SPACING_AUDIT.md §7/§8). By default the drawer body owns a single, fixed inset — the same --spacing-dialog-content-  token ODialog uses — so every drawer\'s content lines up identically and consumers never hand-roll their own body padding. Set bleed for the exceptions that must reach' },
    title: { control: 'text', description: 'Convenience prop: plain-text title rendered in the header. Ignored when the header slot is provided.' },
    titleDataTest: { control: 'text', description: 'Optional data-test attribute rendered on the structured title element, so consumers using the title/subTitle props keep a stable test hook.' },
    showClose: { control: 'boolean', description: 'Whether to render a built-in × close button in the header. Only applies when persistent is false. true' },
    seamless: { control: 'boolean', description: 'When true, the backdrop overlay is hidden so the rest of the page remains interactive and visually unobscured (a seamless dialog). false' },
    subTitle: { control: 'text', description: 'Optional subtitle rendered below the title in the header, left-aligned. Ignored when the header slot is provided.' },
    formId: { control: 'text', description: 'When provided, the built-in primary button becomes type="submit" associated with this form id. Enables Enter-key submission for forms in the drawer body.' },
    primaryButtonLabel: { control: 'text', description: 'Label for the primary action button (right side). Omit to hide.' },
    secondaryButtonLabel: { control: 'text', description: 'Label for the secondary action button (right of neutral, left of primary). Omit to hide.' },
    neutralButtonLabel: { control: 'text', description: 'Label for the neutral action button (left side). Omit to hide.' },
    primaryButtonVariant: { control: { type: 'select' }, options: ["primary","secondary","outline","ghost","ghost-primary","ghost-muted","ghost-subtle","ghost-destructive","ghost-success","ghost-warning","ghost-neutral","outline-destructive","sidebar-toggle","panel-collapse","sidebar-button","destructive","ai-gradient","on-dark-primary","on-dark-ghost","warning","preview-slack","preview-teams","preview-email","preview-action","webinar-dismiss","pricing-chip","outline-primary"], description: 'OButton variant for the primary button. "primary"' },
    secondaryButtonVariant: { control: { type: 'select' }, options: ["primary","secondary","outline","ghost","ghost-primary","ghost-muted","ghost-subtle","ghost-destructive","ghost-success","ghost-warning","ghost-neutral","outline-destructive","sidebar-toggle","panel-collapse","sidebar-button","destructive","ai-gradient","on-dark-primary","on-dark-ghost","warning","preview-slack","preview-teams","preview-email","preview-action","webinar-dismiss","pricing-chip","outline-primary"], description: 'OButton variant for the secondary button. "secondary"' },
    neutralButtonVariant: { control: { type: 'select' }, options: ["primary","secondary","outline","ghost","ghost-primary","ghost-muted","ghost-subtle","ghost-destructive","ghost-success","ghost-warning","ghost-neutral","outline-destructive","sidebar-toggle","panel-collapse","sidebar-button","destructive","ai-gradient","on-dark-primary","on-dark-ghost","warning","preview-slack","preview-teams","preview-email","preview-action","webinar-dismiss","pricing-chip","outline-primary"], description: 'OButton variant for the neutral button. "ghost"' },
    primaryButtonDisabled: { control: 'boolean', description: 'Explicitly disables the primary button. Auto-disabled when any button is loading.' },
    secondaryButtonDisabled: { control: 'boolean', description: 'Explicitly disables the secondary button. Auto-disabled when any button is loading.' },
    neutralButtonDisabled: { control: 'boolean', description: 'Explicitly disables the neutral button. Auto-disabled when any button is loading.' },
    primaryButtonLoading: { control: 'boolean', description: 'Shows loading spinner on primary button (also disables all buttons).' },
    secondaryButtonLoading: { control: 'boolean', description: 'Shows loading spinner on secondary button (also disables all buttons).' },
    neutralButtonLoading: { control: 'boolean', description: 'Shows loading spinner on neutral button (also disables all buttons).' },
    lazy: { control: 'boolean', description: 'When true (default), the default slot content is only rendered while the drawer is open and destroyed when it closes. Set to false for drawers that must preserve component state between open/close cycles. true' },
    portalTarget: { control: 'text', description: 'When provided, portals the drawer into this element and uses position: absolute so the panel is scoped to the element\'s bounds rather than the full viewport. The target element must have position: relative and overflow: hidden. Accepts an HTMLElement reference or a CSS selector string. undefined (po' },
  },
};

export default meta;
type Story = StoryObj<typeof ODrawer>;

export const Playground: Story = {
  render: (args) => ({
    components: { ODrawer, OButton },
    setup() {
      const open = ref(false);
      return { args, open };
    },
    template: `<OButton variant="outline" @click="open = true">Open drawer</OButton><ODrawer v-bind="args" :title="'Drawer title'" :primaryButtonLabel="'Save'" :secondaryButtonLabel="'Cancel'" :open="open" @update:open="(v) => (open = v)"><p class="text-sm text-text-secondary">Drawer body content.</p></ODrawer>`,
  }),
};
