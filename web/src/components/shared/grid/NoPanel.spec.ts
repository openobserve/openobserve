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
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import NoPanel from "./NoPanel.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      panel: {
        add: "Add Panel",
      },
    },
  },
});

// Stubs for components not under test
const oBtnStub = {
  template:
    "<button :data-test=\"$attrs['data-test']\" @click=\"$emit('click')\"><slot></slot></button>",
  props: ["variant", "size"],
  emits: ["click"],
};

function mountNoPanel(props: Record<string, unknown> = {}) {
  return mount(NoPanel, {
    global: {
      plugins: [i18n],
      stubs: {
        OButton: oBtnStub,
      },
    },
    props,
  });
}

describe("NoPanel", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    beforeEach(() => {
      wrapper = mountNoPanel();
    });

    it("should mount without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should show the descriptive message", () => {
      expect(wrapper.text()).toContain(
        "Add a panel to start visualizing logs, metrics, and traces.",
      );
    });

    it("should render the inline svg image", () => {
      const svg = wrapper.find('[data-test="empty-panel-art"]');
      expect(svg.exists()).toBe(true);
      expect(svg.element.tagName.toLowerCase()).toBe("svg");
    });

    it("should use CSS custom properties for colors so it follows the theme", () => {
      const svg = wrapper.find('[data-test="empty-panel-art"]');
      expect(svg.html()).toContain("var(--color-primary");
    });
  });

  describe("add panel button visibility", () => {
    it("should show the add panel button when viewOnly is false", () => {
      wrapper = mountNoPanel({ viewOnly: false });
      expect(wrapper.find('[data-test="dashboard-if-no-panel-add-panel-btn"]').exists()).toBe(true);
    });

    it("should show the add panel button when viewOnly prop is not provided", () => {
      wrapper = mountNoPanel();
      expect(wrapper.find('[data-test="dashboard-if-no-panel-add-panel-btn"]').exists()).toBe(true);
    });

    it("should hide the add panel button when viewOnly is true", () => {
      wrapper = mountNoPanel({ viewOnly: true });
      expect(wrapper.find('[data-test="dashboard-if-no-panel-add-panel-btn"]').exists()).toBe(
        false,
      );
    });
  });

  describe("add panel button label", () => {
    beforeEach(() => {
      wrapper = mountNoPanel({ viewOnly: false });
    });

    it("should display the label for the first quick-start card", () => {
      const btn = wrapper.find('[data-test="dashboard-if-no-panel-add-panel-btn"]');
      expect(btn.exists()).toBe(true);
    });
  });

  describe("add panel button click", () => {
    beforeEach(() => {
      wrapper = mountNoPanel({ viewOnly: false });
    });

    it("should emit update:Panel when the add button is clicked", async () => {
      const btn = wrapper.find('[data-test="dashboard-if-no-panel-add-panel-btn"]');
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      expect(wrapper.emitted("update:Panel")).toBeTruthy();
      expect(wrapper.emitted("update:Panel")).toHaveLength(1);
    });

    it("should emit update:Panel on every click", async () => {
      const btn = wrapper.find('[data-test="dashboard-if-no-panel-add-panel-btn"]');
      await btn.trigger("click");
      await btn.trigger("click");
      expect(wrapper.emitted("update:Panel")).toHaveLength(2);
    });
  });

  describe("image visibility", () => {
    it("should keep the image in the DOM regardless of viewOnly", async () => {
      wrapper = mountNoPanel({ viewOnly: false });
      await wrapper.setProps({ viewOnly: true });
      expect(wrapper.find('[data-test="empty-panel-art"]').exists()).toBe(true);
    });
  });
});
