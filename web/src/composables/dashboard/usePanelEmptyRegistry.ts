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

import { computed, reactive, type ComputedRef, type InjectionKey } from "vue";

export type PanelDataState = "pending" | "empty" | "data" | "error";

/** Panels report whether their range returned data, so the view can tell when every panel is empty. */
export interface PanelEmptyRegistry {
  report: (panelId: string, state: PanelDataState) => void;
  unregister: (panelId: string) => void;
  /** True once at least one panel settled and every reporting panel settled empty. */
  allEmpty: ComputedRef<boolean>;
}

export const PANEL_EMPTY_REGISTRY_KEY: InjectionKey<PanelEmptyRegistry> =
  Symbol("panel-empty-registry");

export const createPanelEmptyRegistry = (): PanelEmptyRegistry => {
  const states = reactive(new Map<string, PanelDataState>());
  const allEmpty = computed(() => {
    if (!states.size) return false;
    for (const state of states.values()) if (state !== "empty") return false;
    return true;
  });
  return {
    report: (panelId, state) => states.set(panelId, state),
    unregister: (panelId) => states.delete(panelId),
    allEmpty,
  };
};
