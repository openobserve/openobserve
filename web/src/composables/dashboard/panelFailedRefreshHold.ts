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

import { hasInjectionContext, inject, watch, type InjectionKey } from "vue";

/** A page that reports a failed refresh itself and wants its panels to keep what they drew. */
export interface PanelFailedRefreshHold {
  /** Names what the given panel's request was built from, such as the page's stream and query at that run. */
  source: (panel: any) => string;
  /** A refresh failed over a result drawn from `source`: true keeps that result in place of the error. */
  hold: (panelId: string, source: string) => boolean;
}

/** The loader's points in each load; all do nothing without a host. */
export interface FailedRefreshHoldHooks {
  /** A load was asked for; the one running is superseded from here on. */
  loadScheduled: () => void;
  /** The load is about to fetch, before it writes into the drawn result. */
  loadStarted: () => void;
  /** The load drew a result from the panel cache instead of fetching. */
  loadRestored: () => void;
}

export const PANEL_FAILED_REFRESH_HOLD: InjectionKey<PanelFailedRefreshHold> =
  Symbol("panelFailedRefreshHold");

interface DrawnResult {
  data: any;
  metadata: any;
  resultMetaData: any;
  annotations: any;
}

interface DrawnSnapshot {
  result: DrawnResult;
  source: string;
}

interface PanelResultState extends DrawnResult {
  loading: boolean;
  errorDetail: { message: string; code: string | number };
}

const NO_ERROR = () => ({ message: "", code: "" as string | number });

const NO_HOOKS: FailedRefreshHoldHooks = {
  loadScheduled: () => {},
  loadStarted: () => {},
  loadRestored: () => {},
};

// The executors write into these arrays chunk by chunk, so the drawn result is copied one level down.
const copyDrawn = (state: PanelResultState): DrawnResult => ({
  data: Array.isArray(state.data) ? [...state.data] : state.data,
  metadata: state.metadata
    ? { ...state.metadata, queries: [...(state.metadata.queries ?? [])] }
    : state.metadata,
  resultMetaData: Array.isArray(state.resultMetaData)
    ? state.resultMetaData.map((entry: any) => (Array.isArray(entry) ? [...entry] : entry))
    : state.resultMetaData,
  annotations: state.annotations,
});

/** Without a provider this does nothing, so every other panel keeps showing its error on a failed refresh. */
export function useFailedRefreshHold(
  state: PanelResultState,
  panel: () => any,
): FailedRefreshHoldHooks {
  const host = hasInjectionContext() ? inject(PANEL_FAILED_REFRESH_HOLD, null) : null;
  if (!host) return NO_HOOKS;
  let scheduled = 0;
  let started = 0;
  let startedSource = "";
  let heldSource: string | null = null;
  // How the last started load ended, if it ended before another load superseded it.
  let settled: { ok: boolean; source: string } | null = null;
  let drawn: DrawnSnapshot | null = null;
  const running = () => started > 0 && started === scheduled;

  watch(
    () => state.loading,
    (loading) => {
      if (loading || !running() || settled) return;
      settled = state.errorDetail?.message
        ? { ok: false, source: "" }
        : { ok: true, source: heldSource ?? startedSource };
    },
    { flush: "sync" },
  );

  // Sync, so the error never reaches the renderer when the host keeps the drawn result.
  watch(
    () => state.errorDetail?.message,
    (message) => {
      if (!message || !drawn || !running()) return;
      const kept = drawn;
      if (!host.hold(panel()?.id, kept.source)) {
        if (settled) settled = { ok: false, source: "" };
        return;
      }
      heldSource = kept.source;
      Object.assign(state, copyDrawn({ ...state, ...kept.result }), { errorDetail: NO_ERROR() });
      if (settled) settled = { ok: true, source: kept.source };
    },
    { flush: "sync" },
  );

  return {
    loadScheduled: () => {
      scheduled++;
    },
    loadStarted: () => {
      // A load superseded before it ended leaves the older snapshot, which still names its own source.
      if (settled) {
        drawn =
          settled.ok && Array.isArray(state.data) && state.data.length
            ? { result: copyDrawn(state), source: settled.source }
            : null;
      }
      settled = null;
      heldSource = null;
      started = scheduled;
      // The request about to run names its source; the page's editor may already hold a staged query.
      startedSource = host.source(panel());
    },
    loadRestored: () => {
      // The cache matched this panel's request, so the restored chart is a settled result of its current source.
      settled = { ok: true, source: host.source(panel()) };
    },
  };
}
