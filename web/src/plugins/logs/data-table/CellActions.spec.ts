// Copyright 2026 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import CellActions from "./CellActions.vue";

// ── Mock Vuex ──────────────────────────────────────────────────────────────────
const mockStore = {
  state: {
    theme: "light",
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// ── Global stubs ──────────────────────────────────────────────────────────────
const globalStubs = {
  QBtn: {
    template: '<button @click="$attrs.onClick?.($event)"><slot /></button>',
  },
  QIcon: { template: "<span><slot /></span>" },
  EqualIcon: { template: "<svg />" },
  NotEqualIcon: { template: "<svg />" },
  O2AIContextAddBtn: {
    name: "O2AIContextAddBtn",
    template: '<div @click="$emit(\'send-to-ai-chat\', \'test\')" />',
    emits: ["send-to-ai-chat"],
  },
};

const defaultProps = {
  column: { id: "status" },
  row: { status: "200", message: "OK" },
  selectedStreamFields: [
    { name: "status", isSchemaField: true },
    { name: "message", isSchemaField: false },
  ],
};

const mountComponent = (propsOverrides = {}) =>
  mount(CellActions, {
    global: { stubs: globalStubs },
    props: { ...defaultProps, ...propsOverrides },
  });

describe("CellActions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Component Initialization ─────────────────────────────────────────────────
  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      const wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the actions container", () => {
      const wrapper = mountComponent();
      expect(wrapper.find(".field_overlay").exists()).toBe(true);
    });

    it("renders with correct data-test attribute based on row value", () => {
      const wrapper = mountComponent();
      const container = wrapper.find('[data-test="log-add-data-from-column-200"]');
      expect(container.exists()).toBe(true);
    });
  });

  // ── backgroundClass computed ──────────────────────────────────────────────────
  describe("backgroundClass computed", () => {
    it("applies dark background class in dark theme", () => {
      mockStore.state.theme = "dark";
      const wrapper = mountComponent();
      expect(wrapper.find(".field_overlay").classes()).toContain("tw:bg-black");
    });

    it("applies light background class in light theme", () => {
      mockStore.state.theme = "light";
      const wrapper = mountComponent();
      expect(wrapper.find(".field_overlay").classes()).toContain("tw:bg-white");
    });
  });

  // ── isStreamField computed ────────────────────────────────────────────────────
  describe("isStreamField computed", () => {
    it("returns true when column is a schema field", () => {
      const wrapper = mountComponent({
        column: { id: "status" },
        selectedStreamFields: [{ name: "status", isSchemaField: true }],
      });
      expect(wrapper.vm.isStreamField).toBe(true);
    });

    it("returns false when column is not a schema field", () => {
      const wrapper = mountComponent({
        column: { id: "message" },
        selectedStreamFields: [{ name: "message", isSchemaField: false }],
      });
      expect(wrapper.vm.isStreamField).toBe(false);
    });

    it("returns false when column is not in selectedStreamFields", () => {
      const wrapper = mountComponent({
        column: { id: "unknown_field" },
        selectedStreamFields: [{ name: "status", isSchemaField: true }],
      });
      expect(wrapper.vm.isStreamField).toBe(false);
    });

    it("returns false when selectedStreamFields is empty", () => {
      const wrapper = mountComponent({
        selectedStreamFields: [],
      });
      expect(wrapper.vm.isStreamField).toBe(false);
    });
  });

  // ── Include/Exclude term buttons visibility ────────────────────────────────────
  describe("Include/Exclude term buttons visibility", () => {
    it("shows include/exclude buttons when isStreamField is true and hideSearchTermActions is false", () => {
      const wrapper = mountComponent({
        column: { id: "status" },
        selectedStreamFields: [{ name: "status", isSchemaField: true }],
        hideSearchTermActions: false,
      });
      const includeBtns = wrapper.findAll('[data-test^="log-details-include-field"]');
      const excludeBtns = wrapper.findAll('[data-test^="log-details-exclude-field"]');
      expect(includeBtns.length).toBeGreaterThan(0);
      expect(excludeBtns.length).toBeGreaterThan(0);
    });

    it("hides include/exclude buttons when isStreamField is false", () => {
      const wrapper = mountComponent({
        column: { id: "message" },
        selectedStreamFields: [{ name: "message", isSchemaField: false }],
      });
      const includeBtns = wrapper.findAll('[data-test^="log-details-include-field"]');
      const excludeBtns = wrapper.findAll('[data-test^="log-details-exclude-field"]');
      expect(includeBtns.length).toBe(0);
      expect(excludeBtns.length).toBe(0);
    });

    it("hides include/exclude buttons when hideSearchTermActions is true even for schema fields", () => {
      const wrapper = mountComponent({
        column: { id: "status" },
        selectedStreamFields: [{ name: "status", isSchemaField: true }],
        hideSearchTermActions: true,
      });
      const includeBtns = wrapper.findAll('[data-test^="log-details-include-field"]');
      const excludeBtns = wrapper.findAll('[data-test^="log-details-exclude-field"]');
      expect(includeBtns.length).toBe(0);
      expect(excludeBtns.length).toBe(0);
    });
  });

  // ── copyLogToClipboard ─────────────────────────────────────────────────────────
  describe("copyLogToClipboard", () => {
    it("should emit 'copy' with column id as first arg and value as second arg", () => {
      const wrapper = mountComponent();
      wrapper.vm.copyLogToClipboard("200");
      const emitted = wrapper.emitted("copy");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["status", "200"]);
    });

    it("should emit 'copy' with the correct column id and row value when column differs", () => {
      const wrapper = mountComponent({
        column: { id: "message" },
        row: { message: "Hello World", status: "200" },
      });
      wrapper.vm.copyLogToClipboard("Hello World");
      expect(wrapper.emitted("copy")![0]).toEqual(["message", "Hello World"]);
    });
  });

  // ── addSearchTerm ─────────────────────────────────────────────────────────────
  describe("addSearchTerm", () => {
    it("emits 'addSearchTerm' with field, value, action=include", () => {
      const wrapper = mountComponent();
      wrapper.vm.addSearchTerm("status", "200", "include");
      const emitted = wrapper.emitted("addSearchTerm");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["status", "200", "include"]);
    });

    it("emits 'addSearchTerm' with field, value, action=exclude", () => {
      const wrapper = mountComponent();
      wrapper.vm.addSearchTerm("status", "200", "exclude");
      expect(wrapper.emitted("addSearchTerm")![0]).toEqual(["status", "200", "exclude"]);
    });

    it("emits 'addSearchTerm' with numeric value", () => {
      const wrapper = mountComponent();
      wrapper.vm.addSearchTerm("latency_ms", 42, "include");
      expect(wrapper.emitted("addSearchTerm")![0]).toEqual(["latency_ms", 42, "include"]);
    });

    it("emits 'addSearchTerm' with boolean value", () => {
      const wrapper = mountComponent();
      wrapper.vm.addSearchTerm("is_error", true, "exclude");
      expect(wrapper.emitted("addSearchTerm")![0]).toEqual(["is_error", true, "exclude"]);
    });
  });

  // ── sendToAiChat ──────────────────────────────────────────────────────────────
  describe("sendToAiChat", () => {
    it("emits 'sendToAiChat' with the value", () => {
      const wrapper = mountComponent();
      wrapper.vm.sendToAiChat(JSON.stringify("test value"));
      const emitted = wrapper.emitted("sendToAiChat");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toBe('"test value"');
    });

    it("emits 'sendToAiChat' with JSON-stringified object", () => {
      const wrapper = mountComponent();
      const obj = { key: "value" };
      wrapper.vm.sendToAiChat(JSON.stringify(obj));
      expect(wrapper.emitted("sendToAiChat")![0][0]).toBe('{"key":"value"}');
    });
  });

  // ── Props defaults ────────────────────────────────────────────────────────────
  describe("Props defaults", () => {
    it("defaults hideSearchTermActions to false", () => {
      const wrapper = mountComponent();
      expect(wrapper.props("hideSearchTermActions")).toBe(false);
    });

    it("defaults selectedStreamFields to empty array when not provided", () => {
      const wrapper = mountComponent({ selectedStreamFields: [] });
      expect(wrapper.props("selectedStreamFields")).toEqual([]);
    });
  });

  // ── O2AIContextAddBtn interaction ──────────────────────────────────────────────
  describe("O2AIContextAddBtn interaction", () => {
    it("renders O2AIContextAddBtn", () => {
      const wrapper = mountComponent();
      // O2AIContextAddBtn is always rendered
      const btn = wrapper.findComponent({ name: "O2AIContextAddBtn" });
      expect(btn.exists()).toBe(true);
    });
  });
});
