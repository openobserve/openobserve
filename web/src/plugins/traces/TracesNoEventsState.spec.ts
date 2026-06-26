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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { reactive, defineComponent, h } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// ---------------------------------------------------------------------------
// Reactive mock — mutated directly in tests; vi.mock factory closes over it.
// ---------------------------------------------------------------------------
const mockSearchObj = reactive({
  data: {
    editorValue: "",
    datetime: {
      startTime: Date.now() - 3600000,
      endTime: Date.now(),
      relativeTimePeriod: "15m",
      type: "relative" as "relative" | "absolute",
    },
    stream: {
      selectedStream: [] as { label: string; value: string }[],
    },
    streamResults: {
      list: [] as {
        name: string;
        stats?: { doc_time_min: number; doc_time_max: number };
      }[],
    },
  },
});

// vi.mock() is hoisted by Vitest — the component receives the mock before
// the real useTraces module is ever imported.
vi.mock("@/composables/useTraces", () => ({
  default: () => ({ searchObj: mockSearchObj }),
}));

import TracesNoEventsState from "./TracesNoEventsState.vue";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/**
 * Renders all named slots so slot-projected content is visible to assertions.
 */
const OEmptyStateStub = defineComponent({
  name: "OEmptyState",
  setup(_, { slots }) {
    return () =>
      h("div", { "data-test": "o-empty-state" }, [
        slots.title?.(),
        slots.description?.(),
        slots.actions?.(),
        slots.extra?.(),
      ]);
  },
});

/**
 * Renders the sublabel as text content (so we can assert on it) and
 * forwards the data-test attribute from the parent binding.
 * Emits "click" on click so widen-range / remove-filter tests work.
 */
const EmptyStateActionCardStub = defineComponent({
  name: "EmptyStateActionCard",
  props: ["icon", "label", "sublabel"],
  inheritAttrs: false,
  emits: ["click"],
  setup(props, { attrs, emit: emitFn }) {
    return () =>
      h(
        "div",
        {
          "data-test": (attrs as Record<string, unknown>)["data-test"],
          onClick: () => emitFn("click"),
        },
        String(props.sublabel ?? ""),
      );
  },
});

// ---------------------------------------------------------------------------
// Mount factories
// ---------------------------------------------------------------------------
function mountComponent() {
  return mount(TracesNoEventsState, {
    global: {
      plugins: [i18n],
      stubs: {
        OEmptyState: OEmptyStateStub,
        EmptyStateActionCard: EmptyStateActionCardStub,
      },
    },
  });
}

/** Used by jump-to-stream-data and ask-ai tests: the store is required because
 *  jumpTargetSublabel reads store.state.timezone and useAiIcon reads
 *  store.state.theme via useStore(). */
function mountComponentWithStore(props: Record<string, unknown> = {}) {
  return mount(TracesNoEventsState, {
    props,
    global: {
      plugins: [i18n, store],
      stubs: {
        OEmptyState: OEmptyStateStub,
        EmptyStateActionCard: EmptyStateActionCardStub,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Convenience setters
// ---------------------------------------------------------------------------
function setRelative(period: string) {
  mockSearchObj.data.datetime.type = "relative";
  mockSearchObj.data.datetime.relativeTimePeriod = period;
}

function setAbsolute() {
  mockSearchObj.data.datetime.type = "absolute";
  mockSearchObj.data.datetime.relativeTimePeriod = "";
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("TracesNoEventsState", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    mockSearchObj.data.editorValue = "";
    mockSearchObj.data.stream.selectedStream = [];
    mockSearchObj.data.streamResults.list = [];
    setRelative("15m");
    wrapper = mountComponent();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Rendering
  // -------------------------------------------------------------------------
  describe("initial render", () => {
    it("should render without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the expand range card when no filter is applied", () => {
      expect(
        wrapper.find('[data-test="traces-no-events-expand-range-card"]').exists(),
      ).toBe(true);
    });

    it("should NOT render any remove filter card (removed from traces)", () => {
      expect(
        wrapper
          .find('[data-test="traces-no-events-remove-filter-card"]')
          .exists(),
      ).toBe(false);
    });

    it("should NOT render the expand range card when a filter is applied", async () => {
      mockSearchObj.data.editorValue = "service_name = 'frontend'";
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="traces-no-events-expand-range-card"]')
          .exists(),
      ).toBe(false);
      // and definitely no remove-filter card either
      expect(
        wrapper
          .find('[data-test="traces-no-events-remove-filter-card"]')
          .exists(),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Emit: widen-range
  // -------------------------------------------------------------------------
  describe("emit widen-range", () => {
    it("should emit widen-range with '1d' when relativeTimePeriod is '15m' (≤60 mins)", async () => {
      setRelative("15m");
      await flushPromises();

      await wrapper
        .find('[data-test="traces-no-events-expand-range-card"]')
        .trigger("click");

      expect(wrapper.emitted("widen-range")).toBeTruthy();
      expect(wrapper.emitted("widen-range")![0]).toEqual(["1d"]);
    });

    it("should emit widen-range with '7d' when relativeTimePeriod is '6h'", async () => {
      setRelative("6h");
      await flushPromises();

      await wrapper
        .find('[data-test="traces-no-events-expand-range-card"]')
        .trigger("click");

      expect(wrapper.emitted("widen-range")![0]).toEqual(["7d"]);
    });

    it("should emit widen-range with '30d' when relativeTimePeriod is '3d'", async () => {
      setRelative("3d");
      await flushPromises();

      await wrapper
        .find('[data-test="traces-no-events-expand-range-card"]')
        .trigger("click");

      expect(wrapper.emitted("widen-range")![0]).toEqual(["30d"]);
    });

    it("should emit widen-range with '7d' fallback when datetime type is 'absolute'", async () => {
      setAbsolute();
      await flushPromises();

      await wrapper
        .find('[data-test="traces-no-events-expand-range-card"]')
        .trigger("click");

      expect(wrapper.emitted("widen-range")![0]).toEqual(["7d"]);
    });
  });

  // -------------------------------------------------------------------------
  // 2b. Ask AI button (gated by aiEnabled)
  // -------------------------------------------------------------------------
  describe("ask-ai button", () => {
    it("should NOT render the Ask AI button when aiEnabled is false", () => {
      const localWrapper = mountComponentWithStore({ aiEnabled: false });

      expect(
        localWrapper.find('[data-test="traces-no-events-ask-ai-btn"]').exists(),
      ).toBe(false);

      localWrapper.unmount();
    });

    it("should render the Ask AI button when aiEnabled is true and the window overlaps data", () => {
      // streamResults.list is empty → streamDocTimeRange undefined →
      // windowHasStreamData true and jumpTarget null, so the button shows.
      const localWrapper = mountComponentWithStore({ aiEnabled: true });

      expect(
        localWrapper.find('[data-test="traces-no-events-ask-ai-btn"]').exists(),
      ).toBe(true);

      localWrapper.unmount();
    });

    it("should emit ask-ai with no payload when the Ask AI button is clicked", async () => {
      const localWrapper = mountComponentWithStore({ aiEnabled: true });

      await localWrapper
        .find('[data-test="traces-no-events-ask-ai-btn"]')
        .trigger("click");

      expect(localWrapper.emitted("ask-ai")).toBeTruthy();
      expect(localWrapper.emitted("ask-ai")![0]).toEqual([]);

      localWrapper.unmount();
    });

    it("should NOT render the Ask AI button when the window is out of range (jumpTarget active)", async () => {
      // A window entirely before the stream's data range → jumpTarget is set,
      // so the Ask AI button is suppressed in favour of the jump card.
      mockSearchObj.data.stream.selectedStream = { value: "default" } as any;
      mockSearchObj.data.streamResults.list = [
        { name: "default", stats: { doc_time_min: 5_000_000, doc_time_max: 10_000_000 } },
      ];
      mockSearchObj.data.datetime = {
        type: "absolute",
        startTime: 100_000_000,
        endTime: 200_000_000,
        relativeTimePeriod: "",
      };
      const localWrapper = mountComponentWithStore({ aiEnabled: true });
      await flushPromises();

      expect(
        localWrapper.find('[data-test="traces-no-events-jump-to-data-card"]').exists(),
      ).toBe(true);
      expect(
        localWrapper.find('[data-test="traces-no-events-ask-ai-btn"]').exists(),
      ).toBe(false);

      localWrapper.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // 2c. Parent-provided range (authoritative props win over streamResults)
  // -------------------------------------------------------------------------
  describe("parent-provided streamDocTimeRange / queryWindowUs", () => {
    it("renders the jump card from props even when streamResults has no stats", async () => {
      // Production scenario: streamResults.list carries no stats, but the parent
      // (traces Index) supplies the authoritative range via props.
      mockSearchObj.data.streamResults.list = [];
      const localWrapper = mountComponentWithStore({
        streamDocTimeRange: { min: 1_000_000, max: 10_000_000 },
        // Window is entirely AFTER the data → out of range → jump.
        queryWindowUs: { start: 100_000_000, end: 200_000_000 },
      });
      await flushPromises();

      const card = localWrapper.find(
        '[data-test="traces-no-events-jump-to-data-card"]',
      );
      expect(card.exists()).toBe(true);

      localWrapper.unmount();
    });

    it("emits jump-to-stream-data with a 15-min window ending at doc_time_max from props", async () => {
      const FIFTEEN_MINS_US = 15 * 60 * 1_000_000;
      const END_NUDGE_US = 1_000_000;
      const max = 50_000_000_000;
      const localWrapper = mountComponentWithStore({
        streamDocTimeRange: { min: 1_000_000, max },
        queryWindowUs: { start: max + 100_000_000, end: max + 200_000_000 },
      });
      await flushPromises();

      await localWrapper
        .find('[data-test="traces-no-events-jump-to-data-card"]')
        .trigger("click");

      expect(localWrapper.emitted("jump-to-stream-data")![0]).toEqual([
        max - FIFTEEN_MINS_US,
        max + END_NUDGE_US,
      ]);

      localWrapper.unmount();
    });

    it("does NOT render the jump card when the props window overlaps the data", async () => {
      const localWrapper = mountComponentWithStore({
        streamDocTimeRange: { min: 1_000_000, max: 100_000_000 },
        // Window sits inside the data range → overlap → expand, not jump.
        queryWindowUs: { start: 10_000_000, end: 90_000_000 },
      });
      await flushPromises();

      expect(
        localWrapper
          .find('[data-test="traces-no-events-jump-to-data-card"]')
          .exists(),
      ).toBe(false);
      expect(
        localWrapper
          .find('[data-test="traces-no-events-expand-range-card"]')
          .exists(),
      ).toBe(true);

      localWrapper.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Expand range sublabel
  // -------------------------------------------------------------------------
  describe("expand range sublabel", () => {
    it("should show 'Past 15 Minutes → Past 1 Day' for relativeTimePeriod '15m'", async () => {
      setRelative("15m");
      await flushPromises();

      const card = wrapper.find('[data-test="traces-no-events-expand-range-card"]');
      expect(card.text()).toContain("Past 15 Minutes");
      expect(card.text()).toContain("Past 1 Day");
    });

    it("should show the absolute fallback string from i18n when type is 'absolute'", async () => {
      setAbsolute();
      await flushPromises();

      const card = wrapper.find('[data-test="traces-no-events-expand-range-card"]');
      // i18n key traces.noEvents.expandRangeDescAbsolute = "Switch to a wider relative time range"
      expect(card.text()).toContain("wider relative time range");
    });
  });
});
