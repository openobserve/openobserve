// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { mount, VueWrapper, flushPromises, config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { BrowserStep } from "@/types/synthetics";

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

const originalPlugins = [...config.global.plugins];
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
  props: ["value", "variant", "size"],
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
    selectorType: "CSS",
    value: "",
    timeout: 30000,
    code: "",
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
      const icons = wrapper.findAll('[data-icon-name]');
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
      expect(wrapper.find('[data-test="synthetics-journey-step-duplicate-btn"]').exists()).toBe(false);
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
      expect(wrapper.find('[data-test="synthetics-journey-step-duplicate-btn"]').exists()).toBe(true);
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
      expect(wrapper.find('[data-test="synthetics-journey-step-duplicate-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="synthetics-journey-step-insert-btn"]').exists()).toBe(false);
    });
  });

  // ── Name fallback ──────────────────────────────────────────────────

  describe("step name fallback", () => {
    it("should use action label as name when step name is empty", async () => {
      const steps = [
        makeStep({ id: "step-1", action: "navigate", name: "" }),
      ];
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
});
