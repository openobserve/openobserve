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

import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { mount, VueWrapper, flushPromises, config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { BrowserStep } from "@/types/synthetics";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
// The setup file installs these as the real messages, so a tooltip arrives resolved.
// Asserting against the file rather than a copy-pasted sentence keeps a wording change
// from failing a test about behaviour.
import enUS from "@/locales/languages/en-US.json";

// Set up i18n so OTable sub-components can use useI18n()
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      search: { noData: "No data available" },
      common: { loading: "Loading..." },
    },
  },
});

beforeAll(() => {
  config.global.plugins.unshift([i18n as any]);
});

// ── Stubs ───────────────────────────────────────────────────────────
// OButton stub: renders a native <button> with all attrs passed through.
// No declared props — everything goes into $attrs so data-test survives.
// Only uses v-bind="$attrs" for click handling — adding $emit('click') on
// top of that duplicates the parent's @click handler.
const OButtonStub = {
  template: '<button v-bind="$attrs"><slot /></button>',
};

// OIcon stub: minimal placeholder
const OIconStub = {
  props: ["name", "size", "ariaHidden"],
  template: '<i :data-icon-name="name" />',
};

// OBadge stub
const OBadgeStub = {
  props: ["variant", "size"],
  template: '<span class="badge-stub"><slot /></span>',
};

// OSpinner stub
const OSpinnerStub = {
  props: ["variant", "size"],
  template: '<div class="spinner-stub" />',
};

// OProgressBar stub
const OProgressBarStub = {
  props: ["value", "start", "variant", "size"],
  template: '<div class="progress-bar-stub" />',
};

const STUBS = {
  OButton: OButtonStub,
  OIcon: OIconStub,
  OBadge: OBadgeStub,
  OSpinner: OSpinnerStub,
  OProgressBar: OProgressBarStub,
};

// ── Test Data ───────────────────────────────────────────────────────
function makeStep(overrides: Partial<BrowserStep> = {}): BrowserStep {
  return {
    id: "step-1",
    action: "click",
    name: "Click Login Button",
    selector: "#login-btn",
    value: "",
    timeout: 30000,
    ...overrides,
  };
}

function makeSteps(count: number): BrowserStep[] {
  return Array.from({ length: count }, (_, i) =>
    makeStep({
      id: `step-${i + 1}`,
      name: `Step ${i + 1}`,
      selector: i % 2 === 0 ? `#selector-${i + 1}` : "",
      action: i === 0 ? "navigate" : i === 1 ? "click" : "assert",
    }),
  );
}

import JourneySteps from "./JourneySteps.vue";

describe("JourneySteps", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── Rendering ─────────────────────────────────────────────────────

  describe("initial render", () => {
    it("should render a step list with step names", async () => {
      const steps = makeSteps(2);
      wrapper = mount(JourneySteps, {
        props: { data: steps, mode: "editor" },
        global: { stubs: STUBS },
      });

      await flushPromises();

      // Table root should exist
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);

      // Two rows should be rendered
      expect(wrapper.find('[data-test="o2-table-row-0"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-row-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-row-2"]').exists()).toBe(false);

      // Step names should appear in the DOM
      const text = wrapper.text();
      expect(text).toContain("Step 1");
      expect(text).toContain("Step 2");

      // Action labels should appear
      expect(text).toContain("Navigate"); // step-1 action
      expect(text).toContain("Click"); // step-2 action
    });

    it("should render action icons for each step", async () => {
      const steps = makeSteps(2);
      wrapper = mount(JourneySteps, {
        props: { data: steps, mode: "editor" },
        global: { stubs: STUBS },
      });

      await flushPromises();

      // Verify action icons are rendered with correct names
      const icons = wrapper.findAll("[data-icon-name]");
      const iconNames = icons.map((i) => i.attributes("data-icon-name"));
      expect(iconNames).toContain("open-in-browser"); // navigate
      expect(iconNames).toContain("ads-click"); // click
    });

    it("should render the selector preview when using detailKey to map to selector", async () => {
      const steps = makeSteps(2);
      wrapper = mount(JourneySteps, {
        props: { data: steps, mode: "editor", detailKey: "selector" },
        global: { stubs: STUBS },
      });

      await flushPromises();

      const text = wrapper.text();
      // step-1 has selector "#selector-1"
      expect(text).toContain("#selector-1");
    });

    it("should not render selector preview when detail field is empty", async () => {
      // The default detailKey is "detail" — BrowserStep objects don't have that field
      const steps = makeSteps(2);
      wrapper = mount(JourneySteps, {
        props: { data: steps, mode: "editor" },
        global: { stubs: STUBS },
      });

      await flushPromises();

      const text = wrapper.text();
      // Selectors should NOT appear since detailKey defaults to "detail" which is undefined
      expect(text).not.toContain("#selector-");
    });
  });

  // ── Readonly mode ──────────────────────────────────────────────────

  describe("readonly mode", () => {
    it("should hide action buttons when readonly is true", async () => {
      const steps = makeSteps(2);
      wrapper = mount(JourneySteps, {
        props: { data: steps, mode: "editor", readonly: true },
        global: { stubs: STUBS },
      });

      await flushPromises();

      // Action buttons should not be rendered
      expect(wrapper.find('[data-test="synthetics-journey-step-insert-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="synthetics-journey-step-delete-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="synthetics-journey-step-duplicate-btn"]').exists()).toBe(
        false,
      );
    });

    it("should show action buttons when readonly is false", async () => {
      const steps = makeSteps(2);
      wrapper = mount(JourneySteps, {
        props: { data: steps, mode: "editor", readonly: false },
        global: { stubs: STUBS },
      });

      await flushPromises();

      // Action buttons should be rendered for each row
      expect(wrapper.find('[data-test="synthetics-journey-step-insert-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-journey-step-delete-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-journey-step-duplicate-btn"]').exists()).toBe(
        true,
      );
    });

    it("should default to showing action buttons when readonly is not specified", async () => {
      const steps = makeSteps(1);
      wrapper = mount(JourneySteps, {
        props: { data: steps, mode: "editor" },
        global: { stubs: STUBS },
      });

      await flushPromises();

      // readonly defaults to false, so buttons should appear
      expect(wrapper.find('[data-test="synthetics-journey-step-insert-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-journey-step-delete-btn"]').exists()).toBe(true);
    });
  });

  // ── Locked (a replay or a restore is running) ──────────────────────
  //
  // Locked is not readonly. Readonly means the journey cannot be edited at all and
  // the actions do not exist; locked means they exist and are unavailable *right
  // now*. Hiding them said the wrong thing — the row appeared to lose capabilities
  // it still has, and the cluster's width vanished with it.

  describe("locked", () => {
    function mountLocked(locked: boolean) {
      return mount(JourneySteps, {
        props: { data: makeSteps(2), mode: "editor", locked },
        global: { stubs: STUBS },
      }) as VueWrapper;
    }

    const ROW_ACTIONS = [
      "synthetics-journey-step-record-before-btn",
      "synthetics-journey-step-insert-btn",
      "synthetics-journey-step-duplicate-btn",
      "synthetics-journey-step-delete-btn",
    ];

    it("should keep the row actions on screen while locked", async () => {
      wrapper = mountLocked(true);
      await flushPromises();

      for (const action of ROW_ACTIONS) {
        expect(wrapper.find(`[data-test="${action}"]`).exists(), `${action} left the row`).toBe(
          true,
        );
      }
      // The cluster itself must not be hidden either — an invisible button is
      // unreachable while still claiming its place, which is the worst of both.
      expect(wrapper.find(".invisible").exists(), "the action cluster is still hidden").toBe(false);
    });

    it("should disable every row action while locked", async () => {
      wrapper = mountLocked(true);
      await flushPromises();

      for (const action of ROW_ACTIONS) {
        expect(
          wrapper.find(`[data-test="${action}"]`).attributes("disabled"),
          `${action} is still clickable`,
        ).toBeDefined();
      }
    });

    it("should leave the row actions alone when nothing is running", async () => {
      wrapper = mountLocked(false);
      await flushPromises();

      // record-before stays disabled on the FIRST row by its own guardrail, so the
      // second row is the one that proves the lock is not what disabled them.
      const rows = wrapper.findAll('[data-test="synthetics-journey-step-insert-btn"]');
      expect(rows[0].attributes("disabled")).toBeUndefined();
    });
  });

  // ── Extension too old to restore ───────────────────────────────────
  //
  // The action promises a restore, so an extension that cannot perform one makes it
  // unhonourable rather than merely slower: the capture would start on a browser that
  // knows nothing about the prefix, and those steps cannot be filed at the anchor.

  describe("canRecordFrom", () => {
    /** The second row — the first carries its own disable, so it proves nothing here. */
    function secondRowRecordBefore(w: VueWrapper) {
      return w.findAll('[data-test="synthetics-journey-step-record-before-btn"]')[1];
    }

    function mountWithCapability(canRecordFrom: boolean) {
      return mount(JourneySteps, {
        props: { data: makeSteps(2), mode: "editor", canRecordFrom },
        global: { stubs: STUBS },
      }) as VueWrapper;
    }

    it("should disable record-before when the extension cannot restore", async () => {
      wrapper = mountWithCapability(false);
      await flushPromises();

      expect(secondRowRecordBefore(wrapper).attributes("disabled")).toBeDefined();
    });

    it("should leave record-before available when the extension can restore", async () => {
      wrapper = mountWithCapability(true);
      await flushPromises();

      expect(secondRowRecordBefore(wrapper).attributes("disabled")).toBeUndefined();
    });

    // The results-mode caller never passes the prop, and its rows are readonly anyway —
    // defaulting to false would disable an action nobody had opted out of.
    it("should treat the capability as present when the prop is omitted", async () => {
      wrapper = mount(JourneySteps, {
        props: { data: makeSteps(2), mode: "editor" },
        global: { stubs: STUBS },
      }) as VueWrapper;
      await flushPromises();

      expect(secondRowRecordBefore(wrapper).attributes("disabled")).toBeUndefined();
    });

    /** The tooltip bodies on screen. Read as props: the bubble only renders once open. */
    function tooltipContents(w: VueWrapper) {
      return w.findAllComponents(OTooltip).map((c) => c.props("content"));
    }

    // Disabled, the button cannot say why on its own — a disabled control dispatches no
    // pointer events, so the reason has to hang off the wrapper around it.
    it("should explain the outdated extension rather than repeat the action hint", async () => {
      wrapper = mountWithCapability(false);
      await flushPromises();

      const contents = tooltipContents(wrapper);
      expect(contents).toContain(enUS.synthetics.journey.recordBeforeNeedsNewerExtension);
      expect(contents).not.toContain(enUS.synthetics.journey.recordBeforeStepHint);
    });

    it("should describe what the action does when it can be honoured", async () => {
      wrapper = mountWithCapability(true);
      await flushPromises();

      expect(tooltipContents(wrapper)).toContain(enUS.synthetics.journey.recordBeforeStepHint);
    });
  });

  // ── Step selection (row click) ─────────────────────────────────────

  describe("step selection", () => {
    it("should emit row-click when a row is clicked", async () => {
      const steps = makeSteps(2);
      wrapper = mount(JourneySteps, {
        props: { data: steps, mode: "editor" },
        global: { stubs: STUBS },
      });

      await flushPromises();

      const firstRow = wrapper.find('[data-test="o2-table-row-0"]');
      expect(firstRow.exists()).toBe(true);

      await firstRow.trigger("click");

      const rowClickEvents = wrapper.emitted("row-click");
      expect(rowClickEvents).toBeTruthy();
      expect(rowClickEvents!.length).toBe(1);
      // The first argument should be the row data
      expect(rowClickEvents![0][0]).toEqual(steps[0]);
    });

    it("should include the MouseEvent as second argument in row-click", async () => {
      const steps = makeSteps(1);
      wrapper = mount(JourneySteps, {
        props: { data: steps, mode: "editor" },
        global: { stubs: STUBS },
      });

      await flushPromises();

      const row = wrapper.find('[data-test="o2-table-row-0"]');
      await row.trigger("click");

      const rowClickEvents = wrapper.emitted("row-click");
      expect(rowClickEvents).toBeTruthy();
      // Second argument should be a MouseEvent
      expect(rowClickEvents![0][1]).toBeInstanceOf(MouseEvent);
    });
  });

  // ── Step deletion ───────────────────────────────────────────────────

  describe("step deletion", () => {
    it("should emit delete when the delete button is clicked", async () => {
      const steps = makeSteps(2);
      wrapper = mount(JourneySteps, {
        props: { data: steps, mode: "editor" },
        global: { stubs: STUBS },
      });

      await flushPromises();

      // Click the delete button on the first row
      const deleteBtns = wrapper.findAll('[data-test="synthetics-journey-step-delete-btn"]');
      expect(deleteBtns.length).toBeGreaterThanOrEqual(1);

      await deleteBtns[0].trigger("click");

      const deleteEvents = wrapper.emitted("delete");
      expect(deleteEvents).toBeTruthy();
      expect(deleteEvents!.length).toBe(1);
      // The emitted payload should be the row data
      expect(deleteEvents![0][0]).toEqual(steps[0]);
    });
  });

  // ── Empty state ─────────────────────────────────────────────────────

  describe("empty state", () => {
    it("should render empty state when data is empty", async () => {
      wrapper = mount(JourneySteps, {
        props: { data: [], mode: "editor" },
        global: { stubs: STUBS },
      });

      await flushPromises();

      // OTable renders an empty state container when data is empty
      const emptyEl = wrapper.find('[data-test="o2-table-empty"]');
      expect(emptyEl.exists()).toBe(true);
    });

    it("should render custom empty slot content when provided", async () => {
      wrapper = mount(JourneySteps, {
        props: { data: [], mode: "editor" },
        global: { stubs: STUBS },
        slots: {
          empty: '<div data-test="custom-empty">No steps configured</div>',
        },
      });

      await flushPromises();

      // Custom empty slot should render inside the table empty area
      const customEmpty = wrapper.find('[data-test="custom-empty"]');
      expect(customEmpty.exists()).toBe(true);
      expect(customEmpty.text()).toBe("No steps configured");
    });

    it("should not render rows when data is empty", async () => {
      wrapper = mount(JourneySteps, {
        props: { data: [], mode: "editor" },
        global: { stubs: STUBS },
      });

      await flushPromises();

      // No rows should exist
      expect(wrapper.find('[data-test="o2-table-row-0"]').exists()).toBe(false);
    });
  });

  // ── Duplicate and insert actions ───────────────────────────────────

  describe("duplicate step", () => {
    it("should emit duplicate when the duplicate button is clicked", async () => {
      const steps = makeSteps(1);
      wrapper = mount(JourneySteps, {
        props: { data: steps, mode: "editor" },
        global: { stubs: STUBS },
      });

      await flushPromises();

      const duplicateBtn = wrapper.find('[data-test="synthetics-journey-step-duplicate-btn"]');
      expect(duplicateBtn.exists()).toBe(true);

      await duplicateBtn.trigger("click");

      const duplicateEvents = wrapper.emitted("duplicate");
      expect(duplicateEvents).toBeTruthy();
      expect(duplicateEvents!.length).toBe(1);
      expect(duplicateEvents![0][0]).toEqual(steps[0]);
    });
  });

  describe("insert below", () => {
    it("should emit insert-below when the insert button is clicked", async () => {
      const steps = makeSteps(1);
      wrapper = mount(JourneySteps, {
        props: { data: steps, mode: "editor" },
        global: { stubs: STUBS },
      });

      await flushPromises();

      const insertBtn = wrapper.find('[data-test="synthetics-journey-step-insert-btn"]');
      expect(insertBtn.exists()).toBe(true);

      await insertBtn.trigger("click");

      const insertEvents = wrapper.emitted("insert-below");
      expect(insertEvents).toBeTruthy();
      expect(insertEvents!.length).toBe(1);
      expect(insertEvents![0][0]).toEqual(steps[0]);
    });
  });

  // ── Results mode ────────────────────────────────────────────────────

  describe("results mode", () => {
    it("should render results columns in results mode", async () => {
      const steps = makeSteps(2);
      wrapper = mount(JourneySteps, {
        props: { data: steps, mode: "results" },
        global: { stubs: STUBS },
      });

      await flushPromises();

      // Table should still exist
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);

      // Rows should be rendered
      expect(wrapper.find('[data-test="o2-table-row-0"]').exists()).toBe(true);

      // In results mode, action buttons should NOT be present
      expect(wrapper.find('[data-test="synthetics-journey-step-delete-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="synthetics-journey-step-duplicate-btn"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="synthetics-journey-step-insert-btn"]').exists()).toBe(false);
    });

    // The timeline is a shared scale, so each bar is positioned by the step's
    // offset into the run rather than anchored to the column's left edge.
    it("draws each timeline bar as a segment at the step's offset", async () => {
      wrapper = mount(JourneySteps, {
        props: {
          mode: "results",
          totalDurationMs: 10000,
          data: [
            { id: 1, name: "a", offsetMs: 0, duration: 2000, status: "pass" },
            { id: 2, name: "b", offsetMs: 2000, duration: 3000, status: "pass" },
            { id: 3, name: "c", offsetMs: 5000, duration: 5000, status: "fail" },
          ],
        },
        global: { stubs: STUBS },
      });
      await flushPromises();

      const bars = wrapper.findAllComponents(OProgressBarStub);
      expect(bars.map((b) => [b.props("start"), b.props("value")])).toEqual([
        [0, 0.2],
        [0.2, 0.5],
        [0.5, 1],
      ]);
      // The failed step keeps its own colour on the shared scale.
      expect(bars[2].props("variant")).toBe("danger");
    });

    // Dividing by a zero-length run would paint every bar full width, which
    // reads as "every step took the whole run".
    it("survives a run with no recorded duration", async () => {
      wrapper = mount(JourneySteps, {
        props: {
          mode: "results",
          totalDurationMs: 0,
          data: [{ id: 1, name: "a", offsetMs: 0, duration: 0, status: "pass" }],
        },
        global: { stubs: STUBS },
      });
      await flushPromises();

      expect(wrapper.findComponent(OProgressBarStub).props("value")).toBe(0);
    });

    // Editor mode is a form; results mode is a table an engineer reads down.
    it("shows column headers in results mode but not in editor mode", async () => {
      const data = makeSteps(1);
      wrapper = mount(JourneySteps, {
        props: { data, mode: "results", totalDurationMs: 35800 },
        global: { stubs: STUBS },
      });
      await flushPromises();
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("showHeader")).toBe(true);
      // The window is what makes a bar's position mean anything. Read from the
      // column definition, not the rendered text; setupTests installs the real
      // en-US catalogue, so `t()` interpolates the window instead of echoing the key.
      const cols = table.props("columns") as Array<{ id: string; header: string }>;
      expect(cols.map((c) => c.id)).toEqual([
        "step",
        "screenshot",
        "details",
        "progress",
        "duration",
      ]);
      expect(cols.find((c) => c.id === "progress")?.header).toContain("35.8s");

      wrapper = mount(JourneySteps, {
        props: { data, mode: "editor" },
        global: { stubs: STUBS },
      });
      await flushPromises();
      expect(wrapper.findComponent({ name: "OTable" }).props("showHeader")).toBe(false);
    });
  });

  // ── Name fallback ──────────────────────────────────────────────────

  describe("step name fallback", () => {
    it("should use action label as name when step name is empty", async () => {
      const steps = [makeStep({ id: "step-1", action: "navigate", name: "" })];
      wrapper = mount(JourneySteps, {
        props: { data: steps, mode: "editor" },
        global: { stubs: STUBS },
      });

      await flushPromises();

      // When name is empty, it should fall back to action label
      const text = wrapper.text();
      expect(text).toContain("Navigate");
    });
  });

  // A right or double click is a `click` carrying two extra fields, so keying the
  // label on the action alone showed the author a plain "Click" for all three.
  describe("click type in the row label", () => {
    const labelFor = async (over: Partial<BrowserStep>) => {
      wrapper = mount(JourneySteps, {
        props: { data: [makeStep({ name: "", ...over })], mode: "editor" },
        global: { stubs: STUBS },
      });
      await flushPromises();
      return wrapper.text();
    };

    it("names a right click and a double click as themselves", async () => {
      expect(await labelFor({ button: "right" })).toContain("Right click");
      expect(await labelFor({ clickCount: 2 })).toContain("Double click");
    });

    it("leaves a plain click reading as Click", async () => {
      const text = await labelFor({});
      expect(text).toContain("Click");
      expect(text).not.toContain("Right click");
      expect(text).not.toContain("Double click");
    });
  });

  // ── Row status spine ─────────────────────────────────────────────
  //
  // The 4px left border is the list's one way of saying "look at this row". Asserted
  // against the REAL OTable, not a stub: BrowserJourney's own tests check what
  // `getRowStatusColor` RETURNS, which says nothing about whether the table renders it.
  describe("row status color", () => {
    it("should render the status spine on a row the callback colours", async () => {
      const steps = [makeStep({ id: "a" }), makeStep({ id: "b" })];
      wrapper = mount(JourneySteps, {
        props: {
          data: steps,
          mode: "editor",
          getRowStatusColor: (row: any) =>
            row.id === "b" ? "var(--color-status-info-text)" : undefined,
        },
        global: { stubs: STUBS },
      });
      await flushPromises();

      const marked = wrapper.findAll('[data-status-bar="true"]');
      expect(marked.length, "the table rendered no status spine at all").toBe(1);
    });

    it("should render no spine when the callback returns nothing", async () => {
      wrapper = mount(JourneySteps, {
        props: {
          data: [makeStep({ id: "a" })],
          mode: "editor",
          getRowStatusColor: () => undefined,
        },
        global: { stubs: STUBS },
      });
      await flushPromises();

      expect(wrapper.findAll('[data-status-bar="true"]').length).toBe(0);
    });
  });

  // ── Recording marker ──────────────────────────────────────────────
  // Where recorded steps will land. The row action that sets it costs a full
  // prefix replay, so the destination has to be legible before the click and
  // stay legible for the session that follows.
  describe("recording marker", () => {
    it("draws a labelled rule above the anchored row and nowhere else", async () => {
      wrapper = mount(JourneySteps, {
        props: { data: makeSteps(3), mode: "editor", anchorId: "step-2" },
        global: { stubs: STUBS },
      });
      await flushPromises();

      const labels = wrapper.findAll('[data-test="synthetics-journey-recording-marker"]');
      expect(labels).toHaveLength(1);
      expect(labels[0].text()).toBe(enUS.synthetics.journey.newStepsLandHere);

      const rules = wrapper.findAll('[data-test="synthetics-journey-recording-marker-rule"]');
      expect(rules).toHaveLength(1);
      // Anchored, not hovered: the rule is solid.
      expect(rules[0].classes()).toContain("bg-accent");
      expect(rules[0].classes()).not.toContain("bg-accent/50");
    });

    it("renders no marker when nothing is anchored", async () => {
      wrapper = mount(JourneySteps, {
        props: { data: makeSteps(3), mode: "editor" },
        global: { stubs: STUBS },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="synthetics-journey-recording-marker"]').exists()).toBe(
        false,
      );
    });

    it("lets the label escape the cell it is anchored in", async () => {
      // The label straddles the row boundary, so the one cell that hosts it must
      // stop clipping. Every other cell keeps the truncation the table relies on.
      wrapper = mount(JourneySteps, {
        props: { data: makeSteps(3), mode: "editor", anchorId: "step-2" },
        global: { stubs: STUBS },
      });
      await flushPromises();

      const details = wrapper.findAll('[data-test="o2-table-cell-details"]');
      expect(details[1].attributes("style")).toContain("overflow: visible");
      expect(details[0].attributes("style") ?? "").not.toContain("overflow: visible");
      // The pinned actions cell keeps the separator shadow it renders inline.
      const actions = wrapper.findAll('[data-test="o2-table-cell-actions"]');
      expect(actions[1].attributes("style") ?? "").not.toContain("overflow: visible");
    });

    // The hover target is the span WRAPPING the button, not the button — a
    // disabled control dispatches no pointer events, so the span is the only
    // thing that can report a hover in the state that most needs explaining.
    function recordBeforeTarget(w: VueWrapper, index: number): HTMLElement {
      const btns = w.findAll('[data-test="synthetics-journey-step-record-before-btn"]');
      return btns[index].element.parentElement as HTMLElement;
    }

    it("previews the marker while the record control is hovered", async () => {
      wrapper = mount(JourneySteps, {
        props: { data: makeSteps(3), mode: "editor" },
        global: { stubs: STUBS },
      });
      await flushPromises();

      // Row 1 has no "before", so the second control belongs to step-2.
      const target = recordBeforeTarget(wrapper, 1);

      target.dispatchEvent(new MouseEvent("mouseenter"));
      await flushPromises();
      const rule = wrapper.find('[data-test="synthetics-journey-recording-marker-rule"]');
      expect(rule.exists()).toBe(true);
      // A preview reads lighter than the committed anchor.
      expect(rule.classes()).toContain("bg-accent/50");

      target.dispatchEvent(new MouseEvent("mouseleave"));
      await flushPromises();
      expect(wrapper.find('[data-test="synthetics-journey-recording-marker-rule"]').exists()).toBe(
        false,
      );
    });

    it("previews nothing where the control cannot be used", async () => {
      // A preview of an action you cannot take is worse than no preview. The
      // first row has no "before"; a locked table and an extension too old to
      // restore both disable the control everywhere.
      const cases: Array<[Record<string, unknown>, number]> = [
        [{ data: makeSteps(3), mode: "editor" }, 0],
        [{ data: makeSteps(3), mode: "editor", locked: true }, 1],
        [{ data: makeSteps(3), mode: "editor", canRecordFrom: false }, 1],
      ];

      for (const [props, index] of cases) {
        const w = mount(JourneySteps, { props: props as any, global: { stubs: STUBS } });
        await flushPromises();

        recordBeforeTarget(w, index).dispatchEvent(new MouseEvent("mouseenter"));
        await flushPromises();

        expect(
          w.find('[data-test="synthetics-journey-recording-marker-rule"]').exists(),
          `a disabled control at index ${index} still previewed`,
        ).toBe(false);
        w.unmount();
      }
    });

    it("previews on keyboard focus, so the control is not mouse-only", async () => {
      wrapper = mount(JourneySteps, {
        props: { data: makeSteps(3), mode: "editor" },
        global: { stubs: STUBS },
      });
      await flushPromises();

      const target = recordBeforeTarget(wrapper, 1);

      target.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await flushPromises();
      expect(wrapper.find('[data-test="synthetics-journey-recording-marker-rule"]').exists()).toBe(
        true,
      );

      target.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await flushPromises();
      expect(wrapper.find('[data-test="synthetics-journey-recording-marker-rule"]').exists()).toBe(
        false,
      );
    });

    it("keeps the committed anchor solid while another row is hovered", async () => {
      wrapper = mount(JourneySteps, {
        props: { data: makeSteps(4), mode: "editor", anchorId: "step-2" },
        global: { stubs: STUBS },
      });
      await flushPromises();

      recordBeforeTarget(wrapper, 2).dispatchEvent(new MouseEvent("mouseenter"));
      await flushPromises();

      const rules = wrapper.findAll('[data-test="synthetics-journey-recording-marker-rule"]');
      expect(rules).toHaveLength(2);
      expect(rules[0].classes()).toContain("bg-accent");
      expect(rules[1].classes()).toContain("bg-accent/50");
    });
  });
});
