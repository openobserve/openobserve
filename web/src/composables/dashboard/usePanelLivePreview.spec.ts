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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { effectScope, nextTick, reactive, ref } from "vue";
import {
  hasTypedChanges,
  isPopupOpen,
  LIVE_PREVIEW_DEBOUNCE_MS,
  LIVE_PREVIEW_HOLD_MAX_MS,
  LIVE_PREVIEW_HOLD_POLL_MS,
  panelPayloadSignature,
  usePanelLivePreview,
  variablesSignature,
} from "./usePanelLivePreview";

const makeQuery = (overrides: Record<string, any> = {}) => ({
  query: 'SELECT histogram(_timestamp) AS "x_axis_1" FROM "default"',
  customQuery: false,
  vrlFunctionQuery: "",
  fields: { stream: "default", stream_type: "logs", y: [{ alias: "y_axis_1", label: "Count" }] },
  config: { promql_legend: "", step_value: null },
  ...overrides,
});

const makePanel = () => ({
  type: "bar",
  queryType: "sql",
  config: { unit: "" },
  queries: [makeQuery()],
});

const clone = (value: any) => JSON.parse(JSON.stringify(value));

const setup = (opts: { valid?: boolean; overlay?: () => boolean; domOverlay?: boolean } = {}) => {
  const panel = reactive(makePanel());
  const applied = ref<any>(clone(panel));
  const liveVariables = ref<any[]>([]);
  const committedVariables = ref<any[]>([]);
  const isLoading = ref(false);
  const valid = ref(opts.valid ?? true);
  const run = vi.fn(() => {
    applied.value = clone(panel);
    committedVariables.value = clone(liveVariables.value);
  });
  const scope = effectScope();
  const live = scope.run(() =>
    usePanelLivePreview({
      panel: () => panel,
      applied: () => applied.value,
      liveVariables: () => liveVariables.value,
      committedVariables: () => committedVariables.value,
      isBuilderValid: () => valid.value,
      isLoading,
      run,
      isOverlayOpen: opts.domOverlay ? undefined : (opts.overlay ?? (() => false)),
    }),
  )!;
  return { panel, applied, liveVariables, committedVariables, isLoading, valid, run, scope, live };
};

describe("usePanelLivePreview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  describe("signatures", () => {
    it("ignores display-only query keys such as labels and the PromQL legend", () => {
      const panel = makePanel();
      const edited = clone(panel);
      edited.queries[0].fields.y[0].label = "Events";
      edited.queries[0].config.promql_legend = "{{service}}";
      expect(panelPayloadSignature(edited)).toBe(panelPayloadSignature(panel));
    });

    it("changes when the generated query or step changes", () => {
      const panel = makePanel();
      const edited = clone(panel);
      edited.queries[0].query = "SELECT count(*) FROM default";
      expect(panelPayloadSignature(edited)).not.toBe(panelPayloadSignature(panel));
      const stepped = clone(panel);
      stepped.queries[0].config.step_value = "30s";
      expect(panelPayloadSignature(stepped)).not.toBe(panelPayloadSignature(panel));
    });

    it("compares variables by name and value regardless of order", () => {
      expect(
        variablesSignature([
          { name: "b", value: ["2", "1"], isLoading: true },
          { name: "a", value: "x" },
        ]),
      ).toBe(
        variablesSignature([
          { name: "a", value: "x" },
          { name: "b", value: ["1", "2"], isLoading: false },
        ]),
      );
    });

    it("flags typed custom query text and VRL edits that have not run", () => {
      const applied = makePanel();
      const typed = clone(applied);
      typed.queries[0].customQuery = true;
      typed.queries[0].query = "SELECT * FROM default WHERE";
      expect(hasTypedChanges(typed, applied)).toBe(true);

      const vrl = clone(applied);
      vrl.queries[0].vrlFunctionQuery = ".a = 1";
      expect(hasTypedChanges(vrl, applied)).toBe(true);

      const builder = clone(applied);
      builder.queries[0].query = "SELECT count(*) FROM default";
      expect(hasTypedChanges(builder, applied)).toBe(false);
    });

    it("holds only for an open select list, not tooltips, menus or popovers", () => {
      document.body.innerHTML =
        '<div data-reka-popper-content-wrapper><span role="tooltip">tip</span></div>' +
        '<div data-reka-popper-content-wrapper><div role="menu"></div></div>' +
        '<div data-reka-popper-content-wrapper><div role="dialog"></div></div>';
      expect(isPopupOpen()).toBe(false);
      document.body.innerHTML +=
        '<div data-reka-popper-content-wrapper><div role="listbox"></div></div>';
      expect(isPopupOpen()).toBe(true);
    });
  });

  describe("live runs", () => {
    it("runs an aggregation change made inside the still-open axis menu", async () => {
      const { panel, run, live, scope } = setup({ domOverlay: true });
      document.body.innerHTML =
        '<div data-reka-popper-content-wrapper><div role="menu"><input /></div></div>';
      live.arm();
      panel.queries[0].fields.y[0] = { alias: "y_axis_1", label: "Count", functionName: "sum" };
      await nextTick();
      expect(live.isPending.value).toBe(true);
      panel.queries[0].query = 'SELECT sum(_timestamp) AS "y_axis_1" FROM "default"';
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
      expect(run).toHaveBeenCalledTimes(1);
      scope.stop();
    });

    it("stops holding for an open select list after the cap", async () => {
      const { panel, run, live, scope } = setup({ overlay: () => true });
      live.arm();
      panel.queries[0].query = "SELECT a FROM default";
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS + LIVE_PREVIEW_HOLD_MAX_MS / 2);
      expect(run).not.toHaveBeenCalled();
      vi.advanceTimersByTime(LIVE_PREVIEW_HOLD_MAX_MS);
      expect(run).toHaveBeenCalledTimes(1);
      scope.stop();
    });

    it("does not run or turn yellow when the tab only switches Builder to Custom", async () => {
      const { panel, run, live, scope } = setup();
      live.arm();
      panel.queries[0].customQuery = true;
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS * 2);
      expect(run).not.toHaveBeenCalled();
      expect(live.isPending.value).toBe(false);
      scope.stop();
    });

    it("runs a tab 1 aggregation change while an untouched tab 2 exists", async () => {
      const { panel, run, live, scope } = setup();
      live.arm();
      panel.queries.push(makeQuery());
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
      expect(run).not.toHaveBeenCalled();

      panel.queries[0].query = 'SELECT max(_timestamp) AS "y_axis_1" FROM "default"';
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
      expect(run).toHaveBeenCalledTimes(1);
      scope.stop();
    });

    it("runs a tab 1 aggregation change once both tabs have run", async () => {
      const { panel, applied, run, live, scope } = setup();
      panel.queries.push(makeQuery({ query: "SELECT b FROM default" }));
      applied.value = clone(panel);
      live.arm();

      panel.queries[0].query = 'SELECT max(_timestamp) AS "y_axis_1" FROM "default"';
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
      expect(run).toHaveBeenCalledTimes(1);
      scope.stop();
    });

    it("does not run for a new query tab until the user changes it", async () => {
      const { panel, run, live, scope } = setup();
      live.arm();
      panel.queries.push(makeQuery({ query: "" }));
      await nextTick();
      panel.queries[1].query = makeQuery().query;
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS * 2);
      expect(run).not.toHaveBeenCalled();
      expect(live.isPending.value).toBe(true);

      panel.queries[1].query = "SELECT errors FROM default";
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
      expect(run).toHaveBeenCalledTimes(1);
      scope.stop();
    });

    it("runs once, debounced, after a burst of builder edits", async () => {
      const { panel, run, live, scope } = setup();
      live.arm();
      panel.queries[0].query = "SELECT a FROM default";
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS / 2);
      panel.queries[0].query = "SELECT a, b FROM default";
      await nextTick();
      expect(live.isPending.value).toBe(true);
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
      expect(run).toHaveBeenCalledTimes(1);
      await nextTick();
      expect(live.isPending.value).toBe(false);
      scope.stop();
    });

    it("does nothing before it is armed (saved panel still loading)", async () => {
      const { panel, run, live, scope } = setup();
      panel.queries[0].query = "SELECT normalised FROM default";
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS * 2);
      expect(run).not.toHaveBeenCalled();
      expect(live.isPending.value).toBe(false);
      scope.stop();
    });

    it("re-renders nothing for config-only edits", async () => {
      const { panel, run, live, scope } = setup();
      live.arm();
      panel.config.unit = "bytes";
      panel.queries[0].fields.y[0].label = "Events";
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS * 2);
      expect(run).not.toHaveBeenCalled();
      scope.stop();
    });

    it("skips an incomplete builder without turning Apply yellow", async () => {
      const { panel, run, live, valid, scope } = setup({ valid: false });
      live.arm();
      panel.queries[0].query = "SELECT a FROM default";
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS * 2);
      expect(run).not.toHaveBeenCalled();
      expect(live.isPending.value).toBe(false);
      expect(live.applyState.value).toBe("incomplete");
      valid.value = true;
      expect(live.isPending.value).toBe(true);
      scope.stop();
    });

    it("pauses the whole panel while a tab has typed query text", async () => {
      const { panel, run, live, scope } = setup();
      live.arm();
      panel.queries.push(makeQuery({ customQuery: true, query: "" }));
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
      run.mockClear();

      panel.queries[1].query = "SELECT * FROM default WHERE";
      panel.queries[0].query = "SELECT b FROM default";
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS * 2);
      expect(run).not.toHaveBeenCalled();
      expect(live.isTypedPending.value).toBe(true);
      expect(live.applyState.value).toBe("typed");
      scope.stop();
    });

    it("re-runs live when a variable value changes", async () => {
      const { liveVariables, run, live, scope } = setup();
      live.arm();
      liveVariables.value = [{ name: "env", value: "prod" }];
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
      expect(run).toHaveBeenCalledTimes(1);
      scope.stop();
    });

    it("holds while a popup is open and fires once it closes", async () => {
      let open = true;
      const { panel, run, live, scope } = setup({ overlay: () => open });
      live.arm();
      panel.queries[0].query = "SELECT a FROM default WHERE level = 'er'";
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS + LIVE_PREVIEW_HOLD_POLL_MS * 3);
      expect(run).not.toHaveBeenCalled();
      open = false;
      vi.advanceTimersByTime(LIVE_PREVIEW_HOLD_POLL_MS);
      expect(run).toHaveBeenCalledTimes(1);
      scope.stop();
    });

    it("pauses auto-runs after a run slower than 10 s and resumes after a fast one", async () => {
      const { panel, run, live, isLoading, scope } = setup();
      live.arm();
      isLoading.value = true;
      await nextTick();
      vi.advanceTimersByTime(11_000);
      isLoading.value = false;
      await nextTick();
      expect(live.isSlowPaused.value).toBe(true);

      panel.queries[0].query = "SELECT slow FROM default";
      await nextTick();
      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS * 2);
      expect(run).not.toHaveBeenCalled();
      expect(live.applyState.value).toBe("slow");

      isLoading.value = true;
      await nextTick();
      vi.advanceTimersByTime(500);
      isLoading.value = false;
      await nextTick();
      expect(live.isSlowPaused.value).toBe(false);
      scope.stop();
    });
  });
});
