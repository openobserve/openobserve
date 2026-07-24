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
import OCodeBlock from '@/lib/core/Code/OCodeBlock.vue';

const meta: Meta<typeof OCodeBlock> = {
  title: 'Core/OCodeBlock',
  component: OCodeBlock,
  tags: ['autodocs'],
  args: {
    copyable: true,
    copyMessage: "Copied to clipboard!",
    revealTooltip: "Reveal",
    hideTooltip: "Hide",
    dataTest: "code-block",
  },
  argTypes: {
    code: { control: 'text', description: 'Raw code to display and copy. Copy always uses this, never the masked or highlighted variant.' },
    lang: { control: 'text', description: 'Fence language (e.g. "bash", "python"). Auto-detected when omitted.' },
    codeMasked: { control: 'text', description: 'Masked variant of code (e.g. a command with a secret hidden). When set, the block shows it by default and exposes a Reveal/Hide toggle; copy still copies the real code.' },
    chrome: { control: { type: 'select' }, options: ["terminal","editor"], description: 'Window chrome. "terminal" → macOS traffic-light dots + a "Terminal" label. "editor" → a filename tab. Omitted → a plain language label.' },
    filename: { control: 'text', description: 'Filename shown in the "editor" chrome tab (falls back to the language).' },
    copyable: { control: 'boolean', description: 'Show the copy button. Default: true.' },
    copyMessage: { control: 'text', description: 'Toast shown on a successful copy.' },
    revealTooltip: { control: 'text', description: 'Tooltips for the reveal/hide toggle (when codeMasked is set).' },
    hideTooltip: { control: 'text' },
    dataTest: { control: 'text', description: 'data-test prefix for the toolbar buttons, e.g. "ai-code" yields "ai-code-copy-btn" / "ai-code-reveal-btn". Default: "code-block".' },
  },
};

export default meta;
type Story = StoryObj<typeof OCodeBlock>;

export const Playground: Story = {
  render: (args) => ({
    components: { OCodeBlock },
    setup() {
      const sampleCode = 'curl -sSL https://openobserve.ai/install.sh | sh';
      return { args, sampleCode };
    },
    template: `<OCodeBlock v-bind="args" :code="sampleCode" :lang="'bash'" />`,
  }),
};
