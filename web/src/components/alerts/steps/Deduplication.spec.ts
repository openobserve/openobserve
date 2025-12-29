// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";
import Deduplication from "./Deduplication.vue";
import i18n from "@/locales";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock store
const createMockStore = (overrides = {}) => ({
  state: {
    theme: "light",
    zoConfig: {
      build_type: "opensource",
    },
    ...overrides,
  },
  dispatch: vi.fn(),
  commit: vi.fn(),
});

describe("Deduplication.vue", () => {
  let wrapper: VueWrapper<any>;
  let mockStore: any;

  beforeEach(() => {
    mockStore = createMockStore();

    wrapper = mount(Deduplication, {
      global: {
        mocks: {
          $store: mockStore,
        },
        provide: {
          store: mockStore,
        },
        plugins: [i18n],
      },
      props: {
        deduplication: {
          enabled: true,
          fingerprint_fields: [],
          time_window_minutes: undefined,
        },
        columns: ["field1", "field2", "field3"],
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Initialization", () => {
    it("should mount component successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render with correct theme class (light mode)", () => {
      expect(wrapper.find(".step-deduplication.light-mode").exists()).toBe(
        true
      );
    });

    it("should render with correct theme class (dark mode)", async () => {
      const darkStore = createMockStore({ theme: "dark" });
      const darkWrapper = mount(Deduplication, {
        global: {
          mocks: { $store: darkStore },
          provide: { store: darkStore },
          plugins: [i18n],
        },
        props: {
          deduplication: {
            enabled: true,
            fingerprint_fields: [],
            time_window_minutes: undefined,
          },
          columns: [],
        },
      });

      expect(darkWrapper.find(".step-deduplication.dark-mode").exists()).toBe(
        true
      );
      darkWrapper.unmount();
    });

    it("should initialize with empty fingerprint fields", () => {
      expect(wrapper.vm.localDeduplication.fingerprint_fields).toEqual([]);
    });

    it("should initialize with undefined time window", () => {
      expect(wrapper.vm.localDeduplication.time_window_minutes).toBeUndefined();
    });

    it("should initialize enabled as true", () => {
      expect(wrapper.vm.localDeduplication.enabled).toBe(true);
    });

    it("should initialize with provided fingerprint fields", async () => {
      const wrapperWithFields = mount(Deduplication, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          deduplication: {
            enabled: true,
            fingerprint_fields: ["field1", "field2"],
            time_window_minutes: 10,
          },
          columns: ["field1", "field2"],
        },
      });

      expect(
        wrapperWithFields.vm.localDeduplication.fingerprint_fields
      ).toEqual(["field1", "field2"]);
      expect(
        wrapperWithFields.vm.localDeduplication.time_window_minutes
      ).toBe(10);
      wrapperWithFields.unmount();
    });
  });

  describe("Props", () => {
    it("should accept deduplication prop", () => {
      expect(wrapper.props().deduplication).toBeDefined();
    });

    it("should accept columns prop", () => {
      expect(wrapper.props().columns).toEqual(["field1", "field2", "field3"]);
    });

    it("should use default deduplication values", () => {
      const defaultWrapper = mount(Deduplication, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          columns: [],
        },
      });

      expect(defaultWrapper.props().deduplication).toBeDefined();
      expect(defaultWrapper.props().deduplication.enabled).toBe(true);
      expect(defaultWrapper.props().deduplication.fingerprint_fields).toEqual(
        []
      );
      defaultWrapper.unmount();
    });

    it("should use default empty columns array", () => {
      const emptyWrapper = mount(Deduplication, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          deduplication: {
            enabled: true,
            fingerprint_fields: [],
            time_window_minutes: undefined,
          },
        },
      });

      expect(emptyWrapper.props().columns).toEqual([]);
      emptyWrapper.unmount();
    });

    it("should handle deduplication prop updates", async () => {
      await wrapper.setProps({
        deduplication: {
          enabled: true,
          fingerprint_fields: ["newField"],
          time_window_minutes: 20,
        },
      });
      await nextTick();

      expect(wrapper.vm.localDeduplication.fingerprint_fields).toEqual([
        "newField",
      ]);
      expect(wrapper.vm.localDeduplication.time_window_minutes).toBe(20);
    });

    it("should handle columns prop updates", async () => {
      await wrapper.setProps({
        columns: ["new1", "new2"],
      });

      expect(wrapper.props().columns).toEqual(["new1", "new2"]);
    });
  });

  describe("Fingerprint Fields Selection", () => {
    it("should update fingerprint fields on selection", async () => {
      wrapper.vm.localDeduplication.fingerprint_fields = ["field1", "field2"];
      await wrapper.vm.emitUpdate();

      expect(wrapper.emitted("update:deduplication")).toBeTruthy();
      expect(wrapper.emitted("update:deduplication")![0][0]).toEqual({
        enabled: true,
        fingerprint_fields: ["field1", "field2"],
        time_window_minutes: undefined,
      });
    });

    it("should handle single fingerprint field", async () => {
      wrapper.vm.localDeduplication.fingerprint_fields = ["field1"];
      await wrapper.vm.emitUpdate();

      expect(
        wrapper.emitted("update:deduplication")![0][0].fingerprint_fields
      ).toEqual(["field1"]);
    });

    it("should handle multiple fingerprint fields", async () => {
      wrapper.vm.localDeduplication.fingerprint_fields = [
        "field1",
        "field2",
        "field3",
      ];
      await wrapper.vm.emitUpdate();

      expect(
        wrapper.emitted("update:deduplication")![0][0].fingerprint_fields
      ).toEqual(["field1", "field2", "field3"]);
    });

    it("should handle empty fingerprint fields", async () => {
      wrapper.vm.localDeduplication.fingerprint_fields = [];
      await wrapper.vm.emitUpdate();

      expect(
        wrapper.emitted("update:deduplication")![0][0].fingerprint_fields
      ).toEqual([]);
    });

    it("should allow adding custom field values", async () => {
      wrapper.vm.localDeduplication.fingerprint_fields = ["customField"];
      await wrapper.vm.emitUpdate();

      expect(
        wrapper.emitted("update:deduplication")![0][0].fingerprint_fields
      ).toEqual(["customField"]);
    });
  });

  describe("Time Window Management", () => {
    it("should update time window minutes", async () => {
      wrapper.vm.localDeduplication.time_window_minutes = 15;
      await wrapper.vm.emitUpdate();

      expect(wrapper.emitted("update:deduplication")).toBeTruthy();
      expect(
        wrapper.emitted("update:deduplication")![0][0].time_window_minutes
      ).toBe(15);
    });

    it("should handle zero time window", async () => {
      wrapper.vm.localDeduplication.time_window_minutes = 0;
      await wrapper.vm.emitUpdate();

      expect(
        wrapper.emitted("update:deduplication")![0][0].time_window_minutes
      ).toBe(0);
    });

    it("should handle undefined time window", async () => {
      wrapper.vm.localDeduplication.time_window_minutes = undefined;
      await wrapper.vm.emitUpdate();

      expect(
        wrapper.emitted("update:deduplication")![0][0].time_window_minutes
      ).toBeUndefined();
    });

    it("should handle very large time window values", async () => {
      wrapper.vm.localDeduplication.time_window_minutes = 99999;
      await wrapper.vm.emitUpdate();

      expect(
        wrapper.emitted("update:deduplication")![0][0].time_window_minutes
      ).toBe(99999);
    });

    it("should handle minimum time window value", async () => {
      wrapper.vm.localDeduplication.time_window_minutes = 1;
      await wrapper.vm.emitUpdate();

      expect(
        wrapper.emitted("update:deduplication")![0][0].time_window_minutes
      ).toBe(1);
    });
  });

  describe("Emit Events", () => {
    it("should emit update:deduplication event", async () => {
      await wrapper.vm.emitUpdate();

      expect(wrapper.emitted("update:deduplication")).toBeTruthy();
    });

    it("should emit correct data structure", async () => {
      wrapper.vm.localDeduplication = {
        enabled: true,
        fingerprint_fields: ["field1"],
        time_window_minutes: 10,
      };
      await wrapper.vm.emitUpdate();

      const emitted = wrapper.emitted("update:deduplication")![0][0];
      expect(emitted).toHaveProperty("enabled");
      expect(emitted).toHaveProperty("fingerprint_fields");
      expect(emitted).toHaveProperty("time_window_minutes");
    });

    it("should always emit enabled as true", async () => {
      wrapper.vm.localDeduplication.enabled = false;
      await wrapper.vm.emitUpdate();

      expect(wrapper.emitted("update:deduplication")![0][0].enabled).toBe(true);
    });

    it("should emit multiple times on multiple updates", async () => {
      await wrapper.vm.emitUpdate();
      await wrapper.vm.emitUpdate();
      await wrapper.vm.emitUpdate();

      expect(wrapper.emitted("update:deduplication")!.length).toBe(3);
    });
  });

  describe("Watcher Behavior", () => {
    it("should update local state when deduplication prop changes", async () => {
      await wrapper.setProps({
        deduplication: {
          enabled: true,
          fingerprint_fields: ["watchedField"],
          time_window_minutes: 25,
        },
      });
      await nextTick();

      expect(wrapper.vm.localDeduplication.fingerprint_fields).toEqual([
        "watchedField",
      ]);
      expect(wrapper.vm.localDeduplication.time_window_minutes).toBe(25);
    });

    it("should handle null deduplication prop", async () => {
      await wrapper.setProps({
        deduplication: null,
      });
      await nextTick();

      // Should not crash
      expect(wrapper.exists()).toBe(true);
    });

    it("should update when fingerprint_fields change", async () => {
      await wrapper.setProps({
        deduplication: {
          enabled: true,
          fingerprint_fields: ["field1", "field2"],
          time_window_minutes: 10,
        },
      });
      await nextTick();

      expect(wrapper.vm.localDeduplication.fingerprint_fields).toEqual([
        "field1",
        "field2",
      ]);
    });

    it("should update when time_window_minutes changes", async () => {
      await wrapper.setProps({
        deduplication: {
          enabled: true,
          fingerprint_fields: [],
          time_window_minutes: 30,
        },
      });
      await nextTick();

      expect(wrapper.vm.localDeduplication.time_window_minutes).toBe(30);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty columns array", async () => {
      await wrapper.setProps({ columns: [] });
      expect(wrapper.props().columns).toEqual([]);
    });

    it("should handle very long column names", async () => {
      const longColumnName = "a".repeat(500);
      await wrapper.setProps({ columns: [longColumnName] });
      expect(wrapper.props().columns[0]).toBe(longColumnName);
    });

    it("should handle special characters in column names", async () => {
      const specialColumns = ["field-1", "field_2", "field.3", "field@4"];
      await wrapper.setProps({ columns: specialColumns });
      expect(wrapper.props().columns).toEqual(specialColumns);
    });

    it("should handle numeric string as time window", async () => {
      wrapper.vm.localDeduplication.time_window_minutes = 123;
      await wrapper.vm.emitUpdate();

      expect(
        wrapper.emitted("update:deduplication")![0][0].time_window_minutes
      ).toBe(123);
    });

    it("should handle duplicate fingerprint fields", async () => {
      wrapper.vm.localDeduplication.fingerprint_fields = [
        "field1",
        "field1",
        "field2",
      ];
      await wrapper.vm.emitUpdate();

      expect(
        wrapper.emitted("update:deduplication")![0][0].fingerprint_fields
      ).toEqual(["field1", "field1", "field2"]);
    });
  });

  describe("UI Rendering", () => {
    it("should render fingerprint fields label", () => {
      const label = wrapper.find(".tw\\:font-semibold");
      expect(label.exists()).toBe(true);
    });

    it("should render time window label", () => {
      const labels = wrapper.findAll(".tw\\:font-semibold");
      expect(labels.length).toBeGreaterThan(1);
    });

    it("should render info icons", () => {
      // q-icon components are rendered - check HTML contains info icon references
      const html = wrapper.html();
      expect(html).toContain("info");
    });

    it("should render hint text for fingerprint fields", () => {
      // Hint text is in a slot template, check HTML contains the hint text
      const html = wrapper.html();
      expect(html).toContain("auto-detect");
    });

    it("should render minutes label for time window", () => {
      const minutesLabel = wrapper.find(".flex.justify-center.items-center");
      expect(minutesLabel.exists()).toBe(true);
    });
  });

  describe("Accessibility", () => {
    it("should have tooltips for info icons", () => {
      const tooltips = wrapper.findAllComponents({ name: "QTooltip" });
      expect(tooltips.length).toBe(2);
    });

    it("should have proper structure for form inputs", () => {
      const select = wrapper.findComponent({ name: "QSelect" });
      expect(select.exists()).toBe(true);

      const input = wrapper.findComponent({ name: "QInput" });
      expect(input.exists()).toBe(true);
    });
  });

  describe("Boundary Conditions", () => {
    it("should handle minimum valid time window (1 minute)", async () => {
      wrapper.vm.localDeduplication.time_window_minutes = 1;
      await wrapper.vm.emitUpdate();

      expect(
        wrapper.emitted("update:deduplication")![0][0].time_window_minutes
      ).toBe(1);
    });

    it("should handle maximum reasonable time window", async () => {
      wrapper.vm.localDeduplication.time_window_minutes = 525600; // 1 year in minutes
      await wrapper.vm.emitUpdate();

      expect(
        wrapper.emitted("update:deduplication")![0][0].time_window_minutes
      ).toBe(525600);
    });

    it("should handle empty state", async () => {
      wrapper.vm.localDeduplication = {
        enabled: true,
        fingerprint_fields: [],
        time_window_minutes: undefined,
      };
      await wrapper.vm.emitUpdate();

      const emitted = wrapper.emitted("update:deduplication")![0][0];
      expect(emitted.fingerprint_fields).toEqual([]);
      expect(emitted.time_window_minutes).toBeUndefined();
    });

    it("should handle fully populated state", async () => {
      wrapper.vm.localDeduplication = {
        enabled: true,
        fingerprint_fields: ["f1", "f2", "f3", "f4", "f5"],
        time_window_minutes: 60,
      };
      await wrapper.vm.emitUpdate();

      const emitted = wrapper.emitted("update:deduplication")![0][0];
      expect(emitted.fingerprint_fields.length).toBe(5);
      expect(emitted.time_window_minutes).toBe(60);
    });
  });

  describe("Negative Cases", () => {
    it("should not emit when emitUpdate is not called", () => {
      expect(wrapper.emitted("update:deduplication")).toBeFalsy();
    });

    it("should handle negative time window gracefully", async () => {
      wrapper.vm.localDeduplication.time_window_minutes = -5;
      await wrapper.vm.emitUpdate();

      expect(
        wrapper.emitted("update:deduplication")![0][0].time_window_minutes
      ).toBe(-5);
    });
  });

  describe("Theme Switching", () => {
    it("should apply light mode theme", () => {
      expect(wrapper.find(".light-mode").exists()).toBe(true);
    });

    it("should apply dark mode theme", async () => {
      const darkStore = createMockStore({ theme: "dark" });
      const darkWrapper = mount(Deduplication, {
        global: {
          mocks: { $store: darkStore },
          provide: { store: darkStore },
          plugins: [i18n],
        },
        props: {
          deduplication: {
            enabled: true,
            fingerprint_fields: [],
            time_window_minutes: undefined,
          },
          columns: [],
        },
      });

      expect(darkWrapper.find(".dark-mode").exists()).toBe(true);
      darkWrapper.unmount();
    });
  });
});
