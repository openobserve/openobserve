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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, nextTick, ref, watch } from "vue";
import { gt } from "@/types/i18n";
import {
  LIVE_COMMIT_DEBOUNCE_MS,
  useVariablesManager,
  type VariableConfig,
} from "./useVariablesManager";
import { usePanelVariableSubstitution } from "./usePanelVariableSubstitution";

// Real manager and change detection, wired like usePanelDataLoader's variables watcher.

const config = (): VariableConfig[] => [
  {
    name: "env",
    type: "custom",
    scope: "global",
    value: "prod",
    options: [
      { label: "prod", value: "prod" },
      { label: "dev", value: "dev" },
    ],
  },
  {
    name: "service",
    type: "query_values",
    scope: "global",
    value: null,
    query_data: { field: "service", filter: [{ filter: "env=$env" }] },
  },
  {
    name: "pod",
    type: "query_values",
    scope: "global",
    value: null,
    query_data: { field: "pod", filter: [{ filter: "service=$service" }] },
  },
  {
    name: "region",
    type: "custom",
    scope: "global",
    value: "eu",
    options: [
      { label: "eu", value: "eu" },
      { label: "us", value: "us" },
    ],
  },
];

const finishLoading = (v: any, value?: any) => {
  if (value !== undefined) v.value = value;
  v.isLoading = false;
  v.isVariableLoadingPending = false;
  v.isVariablePartialLoaded = true;
};

const mountPanel = (manager: any, panelId: string, query: string) => {
  const panelSchema = ref({ id: panelId, queries: [{ query }] });
  const variablesData = computed(() => ({
    isVariablesLoading: false,
    values: manager.getCommittedVariablesForPanel(panelId, ""),
  }));
  const { variablesDataUpdated } = usePanelVariableSubstitution({
    panelSchema,
    variablesData,
    chartPanelRef: ref(null),
    store: { state: { zoConfig: {} } },
    log: () => {},
  });
  const runs = ref(0);
  watch(
    () => variablesData.value.values,
    () => {
      if (variablesDataUpdated()) runs.value++;
    },
    { deep: true },
  );
  return runs;
};

const getVar = (manager: any, name: string) =>
  manager.variablesData.global.find((v: any) => v.name === name);

const setupLoadedDashboard = async () => {
  const manager = useVariablesManager(gt);
  await manager.initialize(config(), {});
  manager.commitAll();
  const panels = {
    env: mountPanel(manager, "p-env", "SELECT * FROM t WHERE env = '$env'"),
    service: mountPanel(manager, "p-service", "SELECT * FROM t WHERE service = '$service'"),
    pod: mountPanel(manager, "p-pod", "SELECT * FROM t WHERE pod = '$pod'"),
    region: mountPanel(manager, "p-region", "SELECT * FROM t WHERE region = '$region'"),
  };

  finishLoading(getVar(manager, "env"));
  finishLoading(getVar(manager, "region"));
  finishLoading(getVar(manager, "service"), "api");
  getVar(manager, "pod").isVariableLoadingPending = true;
  manager.commitWhenSettled();
  await nextTick();
  finishLoading(getVar(manager, "pod"), "api-1");
  await nextTick();
  await nextTick();
  return { manager, panels };
};

const resetRuns = (panels: Record<string, any>) =>
  Object.values(panels).forEach((r: any) => (r.value = 0));

describe("panel run-once across a variable chain", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("first load re-runs only panels whose values arrive later, once each", async () => {
    const { panels } = await setupLoadedDashboard();

    // env and region were known at mount, so their panels run from the mount load alone.
    expect(panels.env.value).toBe(0);
    expect(panels.region.value).toBe(0);
    expect(panels.service.value).toBe(1);
    expect(panels.pod.value).toBe(1);
  });

  it("a live change re-runs only the affected panels, each exactly once", async () => {
    const { manager, panels } = await setupLoadedDashboard();
    resetRuns(panels);
    manager.setLiveMode(true);

    manager.updateVariableValue("env", "global", undefined, undefined, "dev");
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS);
    await nextTick();
    finishLoading(getVar(manager, "service"), "web");
    manager.onVariablePartiallyLoaded("service@global");
    await nextTick();
    expect(panels.env.value).toBe(0);

    finishLoading(getVar(manager, "pod"), "web-1");
    await nextTick();
    await nextTick();

    expect(panels.env.value).toBe(1);
    expect(panels.service.value).toBe(1);
    expect(panels.pod.value).toBe(1);
    expect(panels.region.value).toBe(0);
  });

  it("Refresh pressed while a child is still loading runs each affected panel once", async () => {
    const { manager, panels } = await setupLoadedDashboard();
    resetRuns(panels);

    manager.updateVariableValue("env", "global", undefined, undefined, "dev");
    manager.cancelPendingCommit();
    manager.commitAll();
    await nextTick();

    finishLoading(getVar(manager, "service"), "web");
    manager.onVariablePartiallyLoaded("service@global");
    manager.commitWhenSettled();
    await nextTick();
    finishLoading(getVar(manager, "pod"), "web-1");
    manager.commitWhenSettled();
    await nextTick();
    await nextTick();

    expect(panels.env.value).toBe(1);
    expect(panels.service.value).toBe(1);
    expect(panels.pod.value).toBe(1);
    expect(panels.region.value).toBe(0);
  });

  it("a multi-select child that defaults to ALL runs its panel once on first load", async () => {
    const manager = useVariablesManager(gt);
    await manager.initialize(
      [
        {
          name: "ns",
          type: "query_values",
          scope: "global",
          value: null,
          query_data: { field: "ns", filter: [] },
        },
        {
          name: "ctr",
          type: "query_values",
          scope: "global",
          multiSelect: true,
          selectAllValueForMultiSelect: "all",
          value: [],
          query_data: { field: "ctr", filter: [{ filter: "ns=$ns" }] },
        },
      ] as VariableConfig[],
      {},
    );
    manager.commitAll();
    const p3 = mountPanel(manager, "p3", "SELECT * FROM t WHERE c IN ($ctr)");
    const ns = getVar(manager, "ns");
    const ctr = getVar(manager, "ctr");

    // ns finds no data, so the manager empties ctr and marks it loaded.
    finishLoading(ns, null);
    manager.onVariablePartiallyLoaded("ns@global");
    manager.commitWhenSettled(["ns@global"]);
    await nextTick();
    await nextTick();
    // The mount run was waiting on ctr and goes now; the watcher must not add a second one.
    expect(p3.value).toBe(0);

    // The selector then applies ctr's ALL default; the query it builds is unchanged.
    finishLoading(ctr, ["_o2_all_"]);
    manager.commitWhenSettled(["ctr@global"]);
    await nextTick();
    await nextTick();

    expect(p3.value).toBe(0);
  });

  it("a panel on a variable whose values request failed runs once the failure is committed", async () => {
    const manager = useVariablesManager(gt);
    await manager.initialize(
      [
        {
          name: "bad",
          type: "query_values",
          scope: "global",
          value: null,
          query_data: { field: "missing_field", filter: [] },
        },
      ] as VariableConfig[],
      {},
    );
    manager.commitAll();
    const variablesData = computed(() => ({
      isVariablesLoading: false,
      values: manager.getCommittedVariablesForPanel("p3", ""),
    }));
    const { ifPanelVariablesCompletedLoading } = usePanelVariableSubstitution({
      panelSchema: ref({ id: "p3", queries: [{ query: "SELECT * FROM t WHERE f = '$bad'" }] }),
      variablesData,
      chartPanelRef: ref(null),
      store: { state: { zoConfig: {} } },
      log: () => {},
    });
    const bad = getVar(manager, "bad");
    bad.isLoading = true;
    expect(ifPanelVariablesCompletedLoading()).toBe(false);

    // The selector's error path: no value, not loading, marked as done.
    finishLoading(bad, null);
    manager.commitWhenSettled(["bad@global"]);
    await nextTick();

    expect(ifPanelVariablesCompletedLoading()).toBe(true);
  });
});
