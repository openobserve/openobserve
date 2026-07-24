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
import ODialog from '@/lib/overlay/Dialog/ODialog.vue';
import OButton from '@/lib/core/Button/OButton.vue';

const meta: Meta<typeof ODialog> = {
  title: 'Overlay/Dialog/ODialog',
  component: ODialog,
  tags: ['autodocs'],
  args: {
    persistent: false,
    size: "md",
    showClose: true,
    primaryButtonVariant: "primary",
    secondaryButtonVariant: "outline",
    neutralButtonVariant: "ghost",
    primaryButtonDisabled: false,
    secondaryButtonDisabled: false,
    neutralButtonDisabled: false,
    primaryButtonLoading: false,
    secondaryButtonLoading: false,
    neutralButtonLoading: false,
  },
  argTypes: {
    open: { control: 'boolean', description: 'Controlled open state — use with v-model:open' },
    persistent: { control: 'boolean', description: 'Prevents the dialog from closing when the user clicks the overlay or presses Escape. Equivalent to a persistent dialog. false' },
    size: { control: { type: 'select' }, options: ["xs","sm","md","lg","xl","full"], description: 'Controls dialog panel width. xs=320px  sm=480px  md=640px (default)  lg=800px  xl=1024px  full=screen "md"' },
    title: { control: 'text', description: 'Convenience prop: plain-text title rendered inside the header section. Ignored when the header slot is provided.' },
    showClose: { control: 'boolean', description: 'Whether to render a built-in × close button in the top-right corner. Only applies when persistent is false. true' },
    width: { control: 'number', description: 'Dialog panel width as a percentage of the viewport width (1–100). Translates directly to a vw unit, e.g. width={60} → 60vw. When provided, overrides the size preset width entirely.' },
    maxHeight: { control: 'number', description: 'Dialog panel max-height as a percentage of the viewport height (1–100). Translates directly to a vh unit, e.g. maxHeight={60} → 60vh. When omitted, defaults to 90vh.' },
    subTitle: { control: 'text', description: 'Optional subtitle rendered below the title in the header, left-aligned. Ignored when the header slot is provided.' },
    formId: { control: 'text', description: 'When provided, the built-in primary button becomes type="submit" associated with this form id. Enables Enter-key submission for forms in the dialog body.' },
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
  },
};

export default meta;
type Story = StoryObj<typeof ODialog>;

export const Playground: Story = {
  render: (args) => ({
    components: { ODialog, OButton },
    setup() {
      const open = ref(false);
      return { args, open };
    },
    template: `<OButton variant="outline" @click="open = true">Open dialog</OButton><ODialog v-bind="args" :title="'Dialog title'" :primaryButtonLabel="'Save'" :secondaryButtonLabel="'Cancel'" :open="open" @update:open="(v) => (open = v)"><p class="text-sm text-text-secondary">Dialog body content.</p></ODialog>`,
  }),
};
