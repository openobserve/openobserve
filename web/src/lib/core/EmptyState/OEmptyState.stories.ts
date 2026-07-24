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
import OEmptyState from '@/lib/core/EmptyState/OEmptyState.vue';

const meta: Meta<typeof OEmptyState> = {
  title: 'Core/OEmptyState',
  component: OEmptyState,
  tags: ['autodocs'],
  argTypes: {
    preset: { control: { type: 'select' }, options: ["no-search-results","no-logs","no-patterns","no-stream-selected","no-query-applied","no-dashboards","no-pipelines","no-functions","no-workflows","no-streams","no-synthetic-monitors","no-alerts","load-error","no-data","no-traces","no-service-graph","no-services-catalog","no-search-history","no-search-jobs","no-users","no-reports","no-queries","no-incidents","no-service-accounts","no-invitations","no-dashboards-in-folder","no-groups","no-roles","no-anomaly-configs","no-api-limits","no-role-limits","no-ingestion-tokens","no-organizations","no-alert-destinations","no-pipeline-destinations","no-alert-templates","no-eval-templates","no-enrichment-tables","no-cipher-keys","no-ai-toolsets","no-llm-providers","no-discovered-services","no-nodes","no-source-maps","no-backfill-jobs","no-regex-patterns","no-storage-config","no-model-pricing","no-llm-insights","no-llm-sessions","no-scorers","no-eval-jobs","no-score-configs","no-pipeline-history"] },
    size: { control: { type: 'select' }, options: ["hero","block","inline"] },
    variant: { control: { type: 'select' }, options: ["create","no-results","error","neutral"] },
    illustration: { control: { type: 'select' }, options: ["no-results","box","board","hourglass","connect","broken-panel","check","logs","trace","service-graph","services-catalog","stream-select","pipeline","function","history","schedule","users","report","query","alert","browser-check","explorer","constellation","observatory","data-scene","radar","orbit","pulse","floating-docs","wave-bars"] },
    icon: { control: 'text' },
    title: { control: 'text' },
    description: { control: 'text' },
    actions: { control: false },
    actionLabel: { control: 'text' },
    actionIcon: { control: 'text' },
    secondaryActionLabel: { control: 'text' },
    hideAction: { control: 'boolean' },
    columns: { control: 'boolean' },
    filtered: { control: 'boolean' },
    backdrop: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof OEmptyState>;

export const Playground: Story = {
  render: (args) => ({
    components: { OEmptyState },
    setup() {
      return { args };
    },
    template: `<OEmptyState v-bind="args" />`,
  }),
};

export const Variants: Story = {
  render: () => ({
    components: { OEmptyState },
    setup() {
      return { options: ["create","no-results","error","neutral"] };
    },
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="opt in options" :key="opt" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ opt }}</span>
          <OEmptyState :variant="opt" ></OEmptyState>
        </div>
      </div>
    `,
  }),
};
