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

// Registry of animated empty-state illustrations, keyed by a stable name.
// Presets (and call sites) reference an illustration by name rather than
// importing the component, so the catalog stays the single source of truth and
// new illustrations are added in exactly one place.
//
// Every illustration shares the same contract:
//   props: { width?: number; animated?: boolean }
//   - 208×156 viewBox, no fixed height (scales by width)
//   - token colors only (correct in light/dark)
//   - all SMIL motion gated behind `animated` (prefers-reduced-motion)
import type { Component } from "vue";

import EmptyNoResults from "./EmptyNoResults.vue";
import EmptyRadar from "./EmptyRadar.vue";
import EmptyOrbit from "./EmptyOrbit.vue";
import EmptyPulse from "./EmptyPulse.vue";
import EmptyFloatingDocs from "./EmptyFloatingDocs.vue";
import EmptyWaveBars from "./EmptyWaveBars.vue";
import EmptyConstellation from "./EmptyConstellation.vue";
import EmptyObservatory from "./EmptyObservatory.vue";
import EmptyDataScene from "./EmptyDataScene.vue";
import EmptyBox from "./EmptyBox.vue";
import EmptyBoard from "./EmptyBoard.vue";
import EmptyHourglass from "./EmptyHourglass.vue";
import EmptyConnect from "./EmptyConnect.vue";
import EmptyBrokenPanel from "./EmptyBrokenPanel.vue";
import EmptyCheck from "./EmptyCheck.vue";
import EmptyLogs from "./EmptyLogs.vue";
import EmptyTrace from "./EmptyTrace.vue";
import EmptyPipeline from "./EmptyPipeline.vue";
import EmptyFunction from "./EmptyFunction.vue";
import EmptyHistory from "./EmptyHistory.vue";
import EmptySchedule from "./EmptySchedule.vue";
import EmptyUsers from "./EmptyUsers.vue";
import EmptyReport from "./EmptyReport.vue";
import EmptyQuery from "./EmptyQuery.vue";
import EmptyAlert from "./EmptyAlert.vue";
import EmptyBrowserCheck from "./EmptyBrowserCheck.vue";
import EmptyExplorer from "./EmptyExplorer.vue";
import EmptyServiceGraph from "./EmptyServiceGraph.vue";
import EmptyServicesCatalog from "./EmptyServicesCatalog.vue";
import EmptyStreamSelect from "./EmptyStreamSelect.vue";

export const illustrations = {
  // ---- object / metaphor illustrations (the DEFAULT — no character) --------
  "no-results": EmptyNoResults,
  box: EmptyBox,
  board: EmptyBoard,
  hourglass: EmptyHourglass,
  connect: EmptyConnect,
  "broken-panel": EmptyBrokenPanel,
  check: EmptyCheck,
  logs: EmptyLogs,
  trace: EmptyTrace,
  "service-graph": EmptyServiceGraph,
  "services-catalog": EmptyServicesCatalog,
  "stream-select": EmptyStreamSelect,
  pipeline: EmptyPipeline,
  function: EmptyFunction,
  history: EmptyHistory,
  schedule: EmptySchedule,
  users: EmptyUsers,
  report: EmptyReport,
  query: EmptyQuery,
  alert: EmptyAlert,
  "browser-check": EmptyBrowserCheck,
  // ---- character scenes (opt-in — use ONLY where a person adds value) ------
  explorer: EmptyExplorer,
  // ---- earlier geometric experiments (kept for reference) ------------------
  constellation: EmptyConstellation,
  observatory: EmptyObservatory,
  "data-scene": EmptyDataScene,
  radar: EmptyRadar,
  orbit: EmptyOrbit,
  pulse: EmptyPulse,
  "floating-docs": EmptyFloatingDocs,
  "wave-bars": EmptyWaveBars,
} satisfies Record<string, Component>;

export type IllustrationName = keyof typeof illustrations;
