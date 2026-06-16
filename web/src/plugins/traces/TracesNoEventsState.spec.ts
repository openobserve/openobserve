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

/** Used by jump-to-stream-data tests: the store is required because
 *  jumpTargetSublabel reads store.state.timezone via useStore(). */
function mountComponentWithStore() {
  return mount(TracesNoEventsState, {
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

    it("should always render the expand range card", () => {
      expect(
        wrapper.find('[data-test="traces-no-events-expand-range-card"]').exists(),
      ).toBe(true);
    });

    it("should NOT render the remove filter card when editorValue is empty", () => {
      expect(
        wrapper
          .find('[data-test="traces-no-events-remove-filter-card"]')
          .exists(),
      ).toBe(false);
    });

    it("should render the remove filter card when editorValue is non-empty", async () => {
      mockSearchObj.data.editorValue = "service_name = 'frontend'";
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="traces-no-events-remove-filter-card"]')
          .exists(),
      ).toBe(true);
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
  // 3. Emit: remove-filter
  // -------------------------------------------------------------------------
  describe("emit remove-filter", () => {
    it("should emit remove-filter with no payload when the remove filter card is clicked", async () => {
      mockSearchObj.data.editorValue = "service_name = 'api'";
      await flushPromises();

      const card = wrapper.find('[data-test="traces-no-events-remove-filter-card"]');
      expect(card.exists()).toBe(true);
      await card.trigger("click");

      expect(wrapper.emitted("remove-filter")).toBeTruthy();
      expect(wrapper.emitted("remove-filter")![0]).toEqual([]);
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

  // -------------------------------------------------------------------------
  // 5. Remove filter sublabel
  // -------------------------------------------------------------------------
  describe("remove filter sublabel", () => {
    it("should say 'You have 1 active condition on this query' for a single condition", async () => {
      mockSearchObj.data.editorValue = "service_name = 'api'";
      await flushPromises();

      const card = wrapper.find('[data-test="traces-no-events-remove-filter-card"]');
      expect(card.text()).toBe("You have 1 active condition on this query");
    });

    it("should say 'You have 3 active conditions on this query' for 'a AND b AND c'", async () => {
      mockSearchObj.data.editorValue = "a AND b AND c";
      await flushPromises();

      const card = wrapper.find('[data-test="traces-no-events-remove-filter-card"]');
      expect(card.text()).toBe("You have 3 active conditions on this query");
    });
  });
});
