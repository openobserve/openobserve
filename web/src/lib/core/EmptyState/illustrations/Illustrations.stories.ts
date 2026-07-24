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
import EmptyAlert from './EmptyAlert.vue';
import EmptyAllClear from './EmptyAllClear.vue';
import EmptyBoard from './EmptyBoard.vue';
import EmptyBox from './EmptyBox.vue';
import EmptyBrokenPanel from './EmptyBrokenPanel.vue';
import EmptyBrowserCheck from './EmptyBrowserCheck.vue';
import EmptyBuilder from './EmptyBuilder.vue';
import EmptyCheck from './EmptyCheck.vue';
import EmptyConnect from './EmptyConnect.vue';
import EmptyConstellation from './EmptyConstellation.vue';
import EmptyDataScene from './EmptyDataScene.vue';
import EmptyError from './EmptyError.vue';
import EmptyExplorer from './EmptyExplorer.vue';
import EmptyFloatingDocs from './EmptyFloatingDocs.vue';
import EmptyFunction from './EmptyFunction.vue';
import EmptyHistory from './EmptyHistory.vue';
import EmptyHourglass from './EmptyHourglass.vue';
import EmptyLogs from './EmptyLogs.vue';
import EmptyNoResults from './EmptyNoResults.vue';
import EmptyObservatory from './EmptyObservatory.vue';
import EmptyOrbit from './EmptyOrbit.vue';
import EmptyPipeline from './EmptyPipeline.vue';
import EmptyPulse from './EmptyPulse.vue';
import EmptyQuery from './EmptyQuery.vue';
import EmptyRadar from './EmptyRadar.vue';
import EmptyReport from './EmptyReport.vue';
import EmptySchedule from './EmptySchedule.vue';
import EmptyServiceGraph from './EmptyServiceGraph.vue';
import EmptyServicesCatalog from './EmptyServicesCatalog.vue';
import EmptyStreamSelect from './EmptyStreamSelect.vue';
import EmptyTrace from './EmptyTrace.vue';
import EmptyUsers from './EmptyUsers.vue';
import EmptyWaiting from './EmptyWaiting.vue';
import EmptyWaveBars from './EmptyWaveBars.vue';

/**
 * The empty-state illustration set — the SVG scenes OEmptyState renders for its
 * presets. Browse the full catalog in the Gallery, or open any one to see it at
 * full size.
 */
const meta: Meta = {
  title: 'Core/EmptyState/Illustrations',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/** Every illustration at a glance. */
export const Gallery: Story = {
  render: () => ({
    components: { EmptyAlert, EmptyAllClear, EmptyBoard, EmptyBox, EmptyBrokenPanel, EmptyBrowserCheck, EmptyBuilder, EmptyCheck, EmptyConnect, EmptyConstellation, EmptyDataScene, EmptyError, EmptyExplorer, EmptyFloatingDocs, EmptyFunction, EmptyHistory, EmptyHourglass, EmptyLogs, EmptyNoResults, EmptyObservatory, EmptyOrbit, EmptyPipeline, EmptyPulse, EmptyQuery, EmptyRadar, EmptyReport, EmptySchedule, EmptyServiceGraph, EmptyServicesCatalog, EmptyStreamSelect, EmptyTrace, EmptyUsers, EmptyWaiting, EmptyWaveBars },
    template: `
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyAlert :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyAlert</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyAllClear :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyAllClear</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyBoard :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyBoard</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyBox :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyBox</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyBrokenPanel :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyBrokenPanel</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyBrowserCheck :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyBrowserCheck</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyBuilder :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyBuilder</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyCheck :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyCheck</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyConnect :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyConnect</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyConstellation :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyConstellation</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyDataScene :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyDataScene</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyError :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyError</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyExplorer :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyExplorer</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyFloatingDocs :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyFloatingDocs</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyFunction :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyFunction</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyHistory :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyHistory</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyHourglass :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyHourglass</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyLogs :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyLogs</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyNoResults :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyNoResults</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyObservatory :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyObservatory</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyOrbit :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyOrbit</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyPipeline :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyPipeline</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyPulse :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyPulse</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyQuery :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyQuery</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyRadar :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyRadar</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyReport :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyReport</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptySchedule :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptySchedule</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyServiceGraph :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyServiceGraph</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyServicesCatalog :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyServicesCatalog</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyStreamSelect :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyStreamSelect</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyTrace :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyTrace</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyUsers :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyUsers</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyWaiting :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyWaiting</span></div><div class="flex flex-col items-center gap-2 rounded-surface border border-border-default p-4"><EmptyWaveBars :width="120" :animated="false" /><span class="font-mono text-2xs text-text-muted">EmptyWaveBars</span></div>
      </div>
    `,
  }),
};

export const Alert: Story = {
  render: () => ({
    components: { EmptyAlert },
    template: `<EmptyAlert :width="240" />`,
  }),
};

export const AllClear: Story = {
  render: () => ({
    components: { EmptyAllClear },
    template: `<EmptyAllClear :width="240" />`,
  }),
};

export const Board: Story = {
  render: () => ({
    components: { EmptyBoard },
    template: `<EmptyBoard :width="240" />`,
  }),
};

export const Box: Story = {
  render: () => ({
    components: { EmptyBox },
    template: `<EmptyBox :width="240" />`,
  }),
};

export const BrokenPanel: Story = {
  render: () => ({
    components: { EmptyBrokenPanel },
    template: `<EmptyBrokenPanel :width="240" />`,
  }),
};

export const BrowserCheck: Story = {
  render: () => ({
    components: { EmptyBrowserCheck },
    template: `<EmptyBrowserCheck :width="240" />`,
  }),
};

export const Builder: Story = {
  render: () => ({
    components: { EmptyBuilder },
    template: `<EmptyBuilder :width="240" />`,
  }),
};

export const Check: Story = {
  render: () => ({
    components: { EmptyCheck },
    template: `<EmptyCheck :width="240" />`,
  }),
};

export const Connect: Story = {
  render: () => ({
    components: { EmptyConnect },
    template: `<EmptyConnect :width="240" />`,
  }),
};

export const Constellation: Story = {
  render: () => ({
    components: { EmptyConstellation },
    template: `<EmptyConstellation :width="240" />`,
  }),
};

export const DataScene: Story = {
  render: () => ({
    components: { EmptyDataScene },
    template: `<EmptyDataScene :width="240" />`,
  }),
};

export const Error: Story = {
  render: () => ({
    components: { EmptyError },
    template: `<EmptyError :width="240" />`,
  }),
};

export const Explorer: Story = {
  render: () => ({
    components: { EmptyExplorer },
    template: `<EmptyExplorer :width="240" />`,
  }),
};

export const FloatingDocs: Story = {
  render: () => ({
    components: { EmptyFloatingDocs },
    template: `<EmptyFloatingDocs :width="240" />`,
  }),
};

export const Function: Story = {
  render: () => ({
    components: { EmptyFunction },
    template: `<EmptyFunction :width="240" />`,
  }),
};

export const History: Story = {
  render: () => ({
    components: { EmptyHistory },
    template: `<EmptyHistory :width="240" />`,
  }),
};

export const Hourglass: Story = {
  render: () => ({
    components: { EmptyHourglass },
    template: `<EmptyHourglass :width="240" />`,
  }),
};

export const Logs: Story = {
  render: () => ({
    components: { EmptyLogs },
    template: `<EmptyLogs :width="240" />`,
  }),
};

export const NoResults: Story = {
  render: () => ({
    components: { EmptyNoResults },
    template: `<EmptyNoResults :width="240" />`,
  }),
};

export const Observatory: Story = {
  render: () => ({
    components: { EmptyObservatory },
    template: `<EmptyObservatory :width="240" />`,
  }),
};

export const Orbit: Story = {
  render: () => ({
    components: { EmptyOrbit },
    template: `<EmptyOrbit :width="240" />`,
  }),
};

export const Pipeline: Story = {
  render: () => ({
    components: { EmptyPipeline },
    template: `<EmptyPipeline :width="240" />`,
  }),
};

export const Pulse: Story = {
  render: () => ({
    components: { EmptyPulse },
    template: `<EmptyPulse :width="240" />`,
  }),
};

export const Query: Story = {
  render: () => ({
    components: { EmptyQuery },
    template: `<EmptyQuery :width="240" />`,
  }),
};

export const Radar: Story = {
  render: () => ({
    components: { EmptyRadar },
    template: `<EmptyRadar :width="240" />`,
  }),
};

export const Report: Story = {
  render: () => ({
    components: { EmptyReport },
    template: `<EmptyReport :width="240" />`,
  }),
};

export const Schedule: Story = {
  render: () => ({
    components: { EmptySchedule },
    template: `<EmptySchedule :width="240" />`,
  }),
};

export const ServiceGraph: Story = {
  render: () => ({
    components: { EmptyServiceGraph },
    template: `<EmptyServiceGraph :width="240" />`,
  }),
};

export const ServicesCatalog: Story = {
  render: () => ({
    components: { EmptyServicesCatalog },
    template: `<EmptyServicesCatalog :width="240" />`,
  }),
};

export const StreamSelect: Story = {
  render: () => ({
    components: { EmptyStreamSelect },
    template: `<EmptyStreamSelect :width="240" />`,
  }),
};

export const Trace: Story = {
  render: () => ({
    components: { EmptyTrace },
    template: `<EmptyTrace :width="240" />`,
  }),
};

export const Users: Story = {
  render: () => ({
    components: { EmptyUsers },
    template: `<EmptyUsers :width="240" />`,
  }),
};

export const Waiting: Story = {
  render: () => ({
    components: { EmptyWaiting },
    template: `<EmptyWaiting :width="240" />`,
  }),
};

export const WaveBars: Story = {
  render: () => ({
    components: { EmptyWaveBars },
    template: `<EmptyWaveBars :width="240" />`,
  }),
};
