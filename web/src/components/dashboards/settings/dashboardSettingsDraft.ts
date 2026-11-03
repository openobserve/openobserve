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

import { inject, provide, reactive, watch, type InjectionKey } from "vue";
import { getLoadedDashboardVersion } from "@/utils/commons";
import type { AddSettingVariableForm } from "./AddSettingVariable.schema";
import type { GeneralSettingsForm } from "./GeneralSettings.schema";

export type DashboardSettingsTab =
  "generalSettings" | "variableSettings" | "tabSettings" | "annotationSettings";

export interface DashboardDateTimeDraft {
  startTime?: number;
  endTime?: number;
  relativeTimePeriod?: string;
  valueType?: string;
}

export interface GeneralSettingsDraft {
  values: GeneralSettingsForm;
  dateTime: DashboardDateTimeDraft | null;
}

export interface VariableEditDraft {
  /** The variable being edited, or null for a new one. */
  variableName: string | null;
  values: AddSettingVariableForm;
}

export interface TabRenameDraft {
  tabId: string;
  name: string;
}

export interface DashboardSettingsSections {
  general: GeneralSettingsDraft | null;
  variable: VariableEditDraft | null;
  tabRename: TabRenameDraft | null;
}

export type DashboardSettingsSectionKey = keyof DashboardSettingsSections;

export interface DashboardSettingsDraft extends DashboardSettingsSections {
  tab: DashboardSettingsTab;
}

export type DashboardSettingsSectionSave = () => Promise<boolean>;

interface StoredDashboardSettings {
  title?: string;
  description?: string;
  defaultDatetimeDuration?: {
    startTime?: number;
    endTime?: number;
    relativeTimePeriod?: string;
    type?: string;
  };
  defaultRefreshInterval?: number | string;
  variables?: { list?: unknown[]; showDynamicFilters?: boolean };
  tabs?: { tabId: string; name: string }[];
}

export interface DashboardSettingsDraftContext {
  /** Each section's unsaved state, null when it matches the server; kept while its tab is not shown. */
  readonly pending: DashboardSettingsSections;
  /** Bumped when a draft is continued, so mounted sections load the restored state. */
  readonly restoreRevision: number;
  /** A loaded section offers its save; returns the unregister. */
  register: (key: DashboardSettingsSectionKey, save: DashboardSettingsSectionSave) => () => void;
  snapshot: (tab: DashboardSettingsTab) => DashboardSettingsDraft;
  restore: (draft: DashboardSettingsDraft) => void;
  hasPending: () => boolean;
  /** Saves every section with unsaved state, opening its tab first; false at the first failure. */
  saveAll: () => Promise<boolean>;
  reset: () => void;
}

const SECTION_ORDER: DashboardSettingsSectionKey[] = ["general", "variable", "tabRename"];

const SECTION_TAB: Record<DashboardSettingsSectionKey, DashboardSettingsTab> = {
  general: "generalSettings",
  variable: "variableSettings",
  tabRename: "tabSettings",
};

// A section that never finishes loading (fetch error) must not hold the leave dialog's Save forever.
const SECTION_READY_TIMEOUT_MS = 10000;

const CONTEXT_KEY: InjectionKey<DashboardSettingsDraftContext> = Symbol("dashboardSettingsDraft");

const plainCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

/** A relative range resolves its start and end to now on every load, so only its period identifies it. */
export const comparableDateTime = (
  value: DashboardDateTimeDraft | null | undefined,
): DashboardDateTimeDraft | null => {
  if (!value) return null;
  if (value.valueType === "absolute") {
    return { valueType: "absolute", startTime: value.startTime, endTime: value.endTime };
  }
  return { valueType: value.valueType, relativeTimePeriod: value.relativeTimePeriod };
};

export const createDashboardSettingsDraftContext = (
  openTab: (tab: DashboardSettingsTab) => void,
): DashboardSettingsDraftContext => {
  const savers = new Map<DashboardSettingsSectionKey, DashboardSettingsSectionSave>();
  const state = reactive({
    pending: { general: null, variable: null, tabRename: null } as DashboardSettingsSections,
    restoreRevision: 0,
    ready: { general: false, variable: false, tabRename: false } as Record<
      DashboardSettingsSectionKey,
      boolean
    >,
  });

  const register = (key: DashboardSettingsSectionKey, save: DashboardSettingsSectionSave) => {
    savers.set(key, save);
    state.ready[key] = true;
    return () => {
      if (savers.get(key) !== save) return;
      savers.delete(key);
      state.ready[key] = false;
    };
  };

  // Resolves true once the section can save, false when its state went away or it never loaded.
  const whenReady = (key: DashboardSettingsSectionKey) =>
    new Promise<boolean>((resolve) => {
      const settled = () => state.ready[key] || state.pending[key] === null;
      if (settled()) {
        resolve(state.ready[key]);
        return;
      }
      let timer: ReturnType<typeof setTimeout> | null = null;
      const stop = watch(settled, (done) => {
        if (!done) return;
        if (timer) clearTimeout(timer);
        stop();
        resolve(state.ready[key]);
      });
      timer = setTimeout(() => {
        stop();
        resolve(false);
      }, SECTION_READY_TIMEOUT_MS);
    });

  const saveSection = async (key: DashboardSettingsSectionKey): Promise<boolean> => {
    openTab(SECTION_TAB[key]);
    const ready = await whenReady(key);
    if (state.pending[key] === null) return true;
    const save = savers.get(key);
    if (!ready || !save) return false;
    return save();
  };

  const saveAll = async () => {
    for (const key of SECTION_ORDER) {
      if (state.pending[key] === null) continue;
      if (!(await saveSection(key))) return false;
    }
    return true;
  };

  const context: DashboardSettingsDraftContext = {
    get pending() {
      return state.pending;
    },
    get restoreRevision() {
      return state.restoreRevision;
    },
    register,
    snapshot: (tab) => ({ tab, ...plainCopy(state.pending) }),
    restore: (draft) => {
      state.pending.general = plainCopy(draft.general ?? null);
      state.pending.variable = plainCopy(draft.variable ?? null);
      state.pending.tabRename = plainCopy(draft.tabRename ?? null);
      state.restoreRevision++;
      openTab(draft.tab ?? "generalSettings");
    },
    hasPending: () => SECTION_ORDER.some((key) => state.pending[key] !== null),
    saveAll,
    reset: () => {
      state.pending.general = null;
      state.pending.variable = null;
      state.pending.tabRename = null;
    },
  };
  return context;
};

export const provideDashboardSettingsDraft = (context: DashboardSettingsDraftContext) =>
  provide(CONTEXT_KEY, context);

/** The settings drawer's draft, or null for a section shown elsewhere (e.g. the panel editor's variable form). */
export const useDashboardSettingsDraft = (): DashboardSettingsDraftContext | null =>
  inject(CONTEXT_KEY, null);

/** The settings the drawer edits, as the server last returned them; null when the dashboard is gone. */
export const dashboardSettingsBase = (
  allDashboardData: Record<string, unknown> | undefined,
  dashboardId: string,
): unknown => {
  const source = (getLoadedDashboardVersion(dashboardId)?.snapshot ??
    allDashboardData?.[dashboardId]) as StoredDashboardSettings | null | undefined;
  if (!source) return null;
  return {
    title: source.title ?? "",
    description: source.description ?? "",
    defaultDatetimeDuration: comparableDateTime(
      source.defaultDatetimeDuration
        ? { ...source.defaultDatetimeDuration, valueType: source.defaultDatetimeDuration.type }
        : null,
    ),
    defaultRefreshInterval: Number(source.defaultRefreshInterval) || 0,
    showDynamicFilters: source.variables?.showDynamicFilters ?? false,
    variables: source.variables?.list ?? [],
    tabs: (source.tabs ?? []).map((tab) => ({
      tabId: tab.tabId,
      name: tab.name,
    })),
  };
};
