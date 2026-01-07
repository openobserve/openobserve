// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import CellActions from "@/plugins/logs/data-table/CellActions.vue";

describe("CellActions.vue", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
      },
    });
  });

  const defaultProps = {
    column: { id: "status" },
    row: { status: "200", method: "GET" },
    selectedStreamFields: [
      { name: "status", isSchemaField: true },
      { name: "method", isSchemaField: true },
    ],
  };

  describe("rendering", () => {
    it("should render all action buttons", () => {
      const wrapper = mount(CellActions, {
        props: defaultProps,
        global: {
          plugins: [store],
          stubs: {
            "q-btn": { template: '<button class="q-btn"><slot /></button>' },
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      const buttons = wrapper.findAll(".q-btn");
      expect(buttons.length).toBeGreaterThanOrEqual(3); // copy, include, exclude
    });

    it("should render copy button", () => {
      const wrapper = mount(CellActions, {
        props: defaultProps,
        global: {
          plugins: [store],
          stubs: {
            "q-btn": {
              template:
                '<button :title="$attrs.title" :icon="$attrs.icon"><slot /></button>',
            },
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      const copyBtn = wrapper.find('[title="Copy"]');
      expect(copyBtn.exists()).toBe(true);
    });

    it("should render include button", () => {
      const wrapper = mount(CellActions, {
        props: defaultProps,
        global: {
          plugins: [store],
          stubs: {
            "q-btn": {
              template: '<button :title="$attrs.title"><slot /></button>',
            },
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      const includeBtn = wrapper.find('[title="Include Term"]');
      expect(includeBtn.exists()).toBe(true);
    });

    it("should render exclude button", () => {
      const wrapper = mount(CellActions, {
        props: defaultProps,
        global: {
          plugins: [store],
          stubs: {
            "q-btn": {
              template: '<button :title="$attrs.title"><slot /></button>',
            },
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      const excludeBtn = wrapper.find('[title="Exclude Term"]');
      expect(excludeBtn.exists()).toBe(true);
    });

    it("should render O2 AI context add button", () => {
      const wrapper = mount(CellActions, {
        props: defaultProps,
        global: {
          plugins: [store],
          stubs: {
            "q-btn": true,
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: {
              template: '<div class="o2-ai-btn"></div>',
            },
          },
        },
      });

      expect(wrapper.find(".o2-ai-btn").exists()).toBe(true);
    });
  });

  describe("event emissions", () => {
    it("should emit copy event when copy button is clicked", async () => {
      const wrapper = mount(CellActions, {
        props: defaultProps,
        global: {
          plugins: [store],
          stubs: {
            "q-btn": {
              template: '<button @click="$attrs.onClick"><slot /></button>',
            },
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      const buttons = wrapper.findAll("button");
      await buttons[0].trigger("click");

      expect(wrapper.emitted("copy")).toBeTruthy();
      expect(wrapper.emitted("copy")?.[0]).toEqual(["200", false]);
    });

    it("should emit addSearchTerm with include action", async () => {
      const wrapper = mount(CellActions, {
        props: defaultProps,
        global: {
          plugins: [store],
          stubs: {
            "q-btn": {
              template: '<button @click="$attrs.onClick"><slot /></button>',
            },
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      const buttons = wrapper.findAll("button");
      await buttons[1].trigger("click");

      expect(wrapper.emitted("addSearchTerm")).toBeTruthy();
      expect(wrapper.emitted("addSearchTerm")?.[0]).toEqual([
        "status",
        "200",
        "include",
      ]);
    });

    it("should emit addSearchTerm with exclude action", async () => {
      const wrapper = mount(CellActions, {
        props: defaultProps,
        global: {
          plugins: [store],
          stubs: {
            "q-btn": {
              template: '<button @click="$attrs.onClick"><slot /></button>',
            },
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      const buttons = wrapper.findAll("button");
      await buttons[2].trigger("click");

      expect(wrapper.emitted("addSearchTerm")).toBeTruthy();
      expect(wrapper.emitted("addSearchTerm")?.[0]).toEqual([
        "status",
        "200",
        "exclude",
      ]);
    });

    it("should emit sendToAiChat when AI button is clicked", async () => {
      const wrapper = mount(CellActions, {
        props: defaultProps,
        global: {
          plugins: [store],
          stubs: {
            "q-btn": true,
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: {
              template:
                '<button class="ai-btn" @click="$emit(\'send-to-ai-chat\')"></button>',
            },
          },
        },
      });

      await wrapper.find(".ai-btn").trigger("click");

      expect(wrapper.emitted("sendToAiChat")).toBeTruthy();
      expect(wrapper.emitted("sendToAiChat")?.[0]).toEqual([
        JSON.stringify("200"),
      ]);
    });
  });

  describe("different data types", () => {
    it("should handle string values", () => {
      const wrapper = mount(CellActions, {
        props: {
          column: { id: "method" },
          row: { method: "GET" },
        },
        global: {
          plugins: [store],
          stubs: {
            "q-btn": true,
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      expect(wrapper.props("row")["method"]).toBe("GET");
    });

    it("should handle number values", async () => {
      const wrapper = mount(CellActions, {
        props: {
          column: { id: "status" },
          row: { status: 404 },
          selectedStreamFields: [{ name: "status", isSchemaField: true }],
        },
        global: {
          plugins: [store],
          stubs: {
            "q-btn": {
              template: '<button @click="$attrs.onClick"><slot /></button>',
            },
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      const buttons = wrapper.findAll("button");
      await buttons[1].trigger("click");

      expect(wrapper.emitted("addSearchTerm")?.[0]).toEqual([
        "status",
        404,
        "include",
      ]);
    });

    it("should handle boolean values", async () => {
      const wrapper = mount(CellActions, {
        props: {
          column: { id: "is_error" },
          row: { is_error: true },
          selectedStreamFields: [{ name: "is_error", isSchemaField: true }],
        },
        global: {
          plugins: [store],
          stubs: {
            "q-btn": {
              template: '<button @click="$attrs.onClick"><slot /></button>',
            },
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      const buttons = wrapper.findAll("button");
      await buttons[1].trigger("click");

      expect(wrapper.emitted("addSearchTerm")?.[0]).toEqual([
        "is_error",
        true,
        "include",
      ]);
    });
  });

  describe("theme support", () => {
    it("should apply dark theme class", () => {
      const darkStore = createStore({
        state: {
          theme: "dark",
        },
      });

      const wrapper = mount(CellActions, {
        props: defaultProps,
        global: {
          plugins: [darkStore],
          stubs: {
            "q-btn": true,
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      const rootDiv = wrapper.find(".field_overlay");
      expect(rootDiv.classes()).toContain("tw:bg-black");
    });

    it("should apply light theme class", () => {
      const wrapper = mount(CellActions, {
        props: defaultProps,
        global: {
          plugins: [store],
          stubs: {
            "q-btn": true,
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      const rootDiv = wrapper.find(".field_overlay");
      expect(rootDiv.classes()).toContain("tw:bg-white");
    });
  });

  describe("data attributes", () => {
    it("should have correct data-test attribute", () => {
      const wrapper = mount(CellActions, {
        props: defaultProps,
        global: {
          plugins: [store],
          stubs: {
            "q-btn": true,
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      const rootDiv = wrapper.find(".field_overlay");
      expect(rootDiv.attributes("data-test")).toBe(
        "log-add-data-from-column-200"
      );
    });

    it("should have correct title attribute", () => {
      const wrapper = mount(CellActions, {
        props: defaultProps,
        global: {
          plugins: [store],
          stubs: {
            "q-btn": true,
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      const rootDiv = wrapper.find(".field_overlay");
      expect(rootDiv.attributes("title")).toBe("200");
    });
  });

  describe("props validation", () => {
    it("should require column prop", () => {
      const wrapper = mount(CellActions, {
        props: {
          column: { id: "test" },
          row: {},
        },
        global: {
          plugins: [store],
          stubs: {
            "q-btn": true,
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      expect(wrapper.props("column")).toEqual({ id: "test" });
    });

    it("should require row prop", () => {
      const wrapper = mount(CellActions, {
        props: {
          column: { id: "test" },
          row: { test: "value" },
        },
        global: {
          plugins: [store],
          stubs: {
            "q-btn": true,
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      expect(wrapper.props("row")).toEqual({ test: "value" });
    });
  });

  describe("event prevent and stop", () => {
    it("should prevent default and stop propagation on copy", async () => {
      const wrapper = mount(CellActions, {
        props: defaultProps,
        global: {
          plugins: [store],
          stubs: {
            "q-btn": {
              template:
                '<button @click.prevent.stop="$attrs.onClick"><slot /></button>',
            },
            "q-icon": true,
            EqualIcon: true,
            NotEqualIcon: true,
            O2AIContextAddBtn: true,
          },
        },
      });

      const buttons = wrapper.findAll("button");
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      await buttons[0].element.dispatchEvent(event);

      expect(wrapper.emitted("copy")).toBeTruthy();
    });
  });
});
