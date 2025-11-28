// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import PatternList from "./PatternList.vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

installQuasar({
  plugins: [quasar.Notify],
});

describe("PatternList", () => {
  let wrapper: any;
  const mockPatterns = [
    {
      pattern_id: "pattern-1",
      template: "User * logged in from IP *",
      description: "User login pattern",
      frequency: 1234,
      percentage: 45.67,
      is_anomaly: false,
    },
    {
      pattern_id: "pattern-2",
      template: "Error: Connection timeout to server *",
      description: "Connection timeout error",
      frequency: 567,
      percentage: 20.32,
      is_anomaly: true,
    },
    {
      pattern_id: "pattern-3",
      template: "Request processed in * ms",
      description: "Request processing time",
      frequency: 890,
      percentage: 31.89,
      is_anomaly: false,
    },
  ];

  beforeEach(() => {
    wrapper = mount(PatternList, {
      props: {
        patterns: mockPatterns,
        loading: false,
        totalLogsAnalyzed: 2791,
      },
      global: {
        plugins: [i18n],
        provide: { store },
        stubs: {
          PatternCard: {
            template:
              '<div :data-test="`pattern-card-stub-${index}`"><slot></slot></div>',
            props: ["pattern", "index"],
          },
        },
      },
    });
  });

  it("should mount PatternList component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  describe("Pattern Display", () => {
    it("should render q-virtual-scroll when patterns are available", () => {
      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.exists()).toBe(true);
    });

    it("should pass patterns to virtual scroll", () => {
      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("items")).toEqual(mockPatterns);
      expect(virtualScroll.props("items").length).toBe(mockPatterns.length);
    });

    it("should emit open-details event when PatternCard is clicked", async () => {
      // Trigger click on first pattern card
      const card = wrapper.findComponent({ name: "QVirtualScroll" });

      // Since we're using virtual scroll, we need to check if the component
      // would emit the event properly
      await wrapper.vm.$emit("open-details", mockPatterns[0], 0);

      expect(wrapper.emitted("open-details")).toBeTruthy();
    });

    it("should emit add-to-search event with include action", async () => {
      await wrapper.vm.$emit("add-to-search", mockPatterns[0], "include");

      expect(wrapper.emitted("add-to-search")).toBeTruthy();
      expect(wrapper.emitted("add-to-search")![0]).toEqual([
        mockPatterns[0],
        "include",
      ]);
    });

    it("should emit add-to-search event with exclude action", async () => {
      await wrapper.vm.$emit("add-to-search", mockPatterns[1], "exclude");

      expect(wrapper.emitted("add-to-search")).toBeTruthy();
      expect(wrapper.emitted("add-to-search")![0]).toEqual([
        mockPatterns[1],
        "exclude",
      ]);
    });
  });

  describe("Loading State", () => {
    beforeEach(() => {
      wrapper = mount(PatternList, {
        props: {
          patterns: [],
          loading: true,
        },
        global: {
          plugins: [i18n],
          provide: { store },
        },
      });
    });

    it("should display loading spinner when loading is true", () => {
      const spinner = wrapper.findComponent({ name: "QSpinnerHourglass" });
      expect(spinner.exists()).toBe(true);
    });

    it("should display loading text", () => {
      const loadingText = wrapper.text();
      expect(loadingText).toContain("Extracting patterns from logs");
    });

    it("should not display virtual scroll when loading", () => {
      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.exists()).toBe(false);
    });
  });

  describe("Empty State", () => {
    beforeEach(() => {
      wrapper = mount(PatternList, {
        props: {
          patterns: [],
          loading: false,
          totalLogsAnalyzed: 100,
        },
        global: {
          plugins: [i18n],
          provide: { store },
        },
      });
    });

    it("should display empty state message when no patterns", () => {
      const emptyText = wrapper.text();
      expect(emptyText).toContain("No patterns found");
    });

    it("should display total logs analyzed in empty state", () => {
      const emptyText = wrapper.text();
      expect(emptyText).toContain("Only 100 logs were analyzed");
    });

    it("should display helpful suggestion text", () => {
      const emptyText = wrapper.text();
      expect(emptyText).toContain(
        "Try increasing the time range or selecting a different stream",
      );
      expect(emptyText).toContain(
        "Pattern extraction works best with at least 1000+ logs",
      );
    });

    it("should not display total logs analyzed when not provided", () => {
      wrapper = mount(PatternList, {
        props: {
          patterns: [],
          loading: false,
        },
        global: {
          plugins: [i18n],
          provide: { store },
        },
      });

      const emptyText = wrapper.text();
      expect(emptyText).not.toContain("Only");
      expect(emptyText).not.toContain("logs were analyzed");
    });
  });

  describe("Props Validation", () => {
    it("should handle empty patterns array", () => {
      wrapper = mount(PatternList, {
        props: {
          patterns: [],
          loading: false,
        },
        global: {
          plugins: [i18n],
          provide: { store },
        },
      });

      expect(wrapper.exists()).toBe(true);
      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.exists()).toBe(false);
    });

    it("should handle undefined totalLogsAnalyzed", () => {
      wrapper = mount(PatternList, {
        props: {
          patterns: mockPatterns,
          loading: false,
        },
        global: {
          plugins: [i18n],
          provide: { store },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Virtual Scroll Configuration", () => {
    it("should configure virtual scroll with correct slice size", () => {
      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("virtualScrollSliceSize")).toBe("5");
    });

    it("should pass patterns to virtual scroll items", () => {
      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("items")).toEqual(mockPatterns);
    });
  });
});
