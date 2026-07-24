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
import EmptyStateIngestionCard from './EmptyStateIngestionCard.vue';

const meta: Meta<typeof EmptyStateIngestionCard> = {
  title: 'Core/EmptyState/Building Blocks/EmptyStateIngestionCard',
  component: EmptyStateIngestionCard,
  tags: ['autodocs'],
  args: { icon: 'terminal', label: 'Ingest via OTLP', sublabel: 'Send logs, metrics and traces over OTLP' },
};
export default meta;
type Story = StoryObj<typeof EmptyStateIngestionCard>;

export const Playground: Story = {
  render: (args) => ({
    components: { EmptyStateIngestionCard },
    setup: () => ({ args }),
    template: `<div class="w-96"><EmptyStateIngestionCard v-bind="args" /></div>`,
  }),
};
