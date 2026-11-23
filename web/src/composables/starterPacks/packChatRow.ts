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

import { useBrowserMatches } from "./useBrowserMatches";
import type { HomePackRowItem, HomePackView } from "./useHomePacks";
import type { StarterPackFlow } from "./useStarterPackFlow";

export type PackRowKind = "idle" | "settingUp" | "elsewhere" | "ready" | "failed" | "forbidden";

export interface PackRowInput {
  view: HomePackView;
  running: boolean;
  installed: boolean;
  interrupted: boolean;
  /** Another tab or user is running the setup, so this one offers nothing. */
  runningElsewhere: boolean;
  forbidden: boolean;
  installFailed: boolean;
  failedCount: number;
  canUndo: boolean;
  /** Every matched pack was refused, so no row offers a button. */
  askAdmin: boolean;
}

export interface PackRowState {
  kind: PackRowKind;
  /** Items to retry; zero on a stopped run, which finishes instead. */
  retryCount: number;
  canUndo: boolean;
  installFailed: boolean;
}

const SET_UP_VIEWS = new Set<HomePackView>(["installed", "interrupted"]);
const OFFER_VIEWS = new Set<HomePackView>(["offer", "forbidden"]);

/** Set up rows stay; an offer row shows only while the org's offer is still live. */
export const packRowShown = (view: HomePackView, running: boolean, offerLive: boolean) =>
  running || SET_UP_VIEWS.has(view) || (offerLive && OFFER_VIEWS.has(view));

export function packRowState(input: PackRowInput): PackRowState {
  const state = (kind: PackRowKind): PackRowState => ({
    kind,
    retryCount: kind === "failed" ? input.failedCount : 0,
    canUndo: kind === "ready" && input.canUndo,
    installFailed: kind === "idle" && input.installFailed,
  });
  if (input.running) return state("settingUp");
  if (input.installed) return state("ready");
  if (input.runningElsewhere) return state("elsewhere");
  if (input.forbidden || input.askAdmin || input.view === "forbidden") return state("forbidden");
  if (input.interrupted) return state("failed");
  return state("idle");
}

export const packRowInput = (item: HomePackRowItem, askAdmin: boolean): PackRowInput => {
  const { flow } = item;
  return {
    view: item.view.value,
    running: flow.running.value,
    installed: flow.installed.value,
    interrupted: flow.interrupted.value,
    runningElsewhere: flow.runningBy.value !== null,
    forbidden: flow.forbidden.value,
    installFailed: flow.installFailed.value,
    failedCount: flow.failed.value.length,
    canUndo: flow.canUndo.value,
    askAdmin,
  };
};

/** Null until the preview has counted, so a button never shows a count it has not made. */
export const packSetUpCount = (flow: StarterPackFlow): number | null => {
  const counts = [flow.dashboardCount.value, flow.alertCount.value, flow.viewCount.value];
  if (counts.some((count) => count === null)) return null;
  return counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
};

const remember = (flow: StarterPackFlow, done: boolean) => {
  if (done) useBrowserMatches(flow.org).markInstalled(flow.pack.id, flow.pack.id);
  return done;
};

/** The review dialog's set up and records, run for every item with alerts off and no destination. */
export const setUpWithDefaults = async (flow: StarterPackFlow) =>
  remember(flow, await flow.install(undefined, { exclude: [], enableAlerts: false }));

export const retrySetUp = async (flow: StarterPackFlow) => remember(flow, await flow.retry());
