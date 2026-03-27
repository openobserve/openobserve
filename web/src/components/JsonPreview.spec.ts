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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";

// All vi.mock() calls must come before any component imports — they are hoisted by Vitest.

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn(() => "mock-url"),
}));

vi.mock("@/components/logs/LogsHighLighting.vue", () => ({
  default: {
    name: "LogsHighLighting",
    template: '<span data-test="logs-highlighting-stub" />',
    props: ["data", "showBraces", "queryString"],
  },
}));

vi.mock("@/components/logs/ChunkedContent.vue", () => ({
  default: {
    name: "ChunkedContent",
    template: '<span data-test="chunked-content-stub" />',
    props: ["data", "fieldKey", "queryString", "simpleMode"],
  },
}));

const mockNotify = vi.fn();

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({ notify: mockNotify }),
  };
});

import JsonPreview from "./JsonPreview.vue";

installQuasar();

// ── Mount factory ─────────────────────────────────────────────────────────────

function mountJsonPreview(
  props: Record<string, unknown> = {},
  slots: Record<string, unknown> = {},
) {
  return mount(JsonPreview, {
    global: {
      plugins: [store],
    },
    props: {
      value: { level: "info", message: "hello" },
      ...props,
    },
    slots,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("JsonPreview", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    beforeEach(() => {
      wrapper = mountJsonPreview();
    });

    it("should render without errors with a simple value object", () => {
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("copy button visibility", () => {
    it("should show the copy button when showCopyButton is true (default)", () => {
      wrapper = mountJsonPreview({ showCopyButton: true });
      // The copy button is a q-btn with an icon; it renders when showCopyButton is true.
      // We locate it by its click handler binding — the element with icon="content_copy" exists.
      expect(wrapper.find("button").exists()).toBe(true);
    });

    it("should hide the copy button when showCopyButton is false", () => {
      wrapper = mountJsonPreview({ showCopyButton: false });
      // With showCopyButton false the q-btn is removed from the DOM entirely.
      // The only remaining button-like elements would belong to q-btn-dropdown if present,
      // but with no field-dropdown slot there are none either.
      const buttons = wrapper.findAll("button");
      // None of the buttons should be the copy button — identified by the content_copy icon text.
      const hasCopyButton = buttons.some((b) =>
        b.html().includes("content_copy"),
      );
      expect(hasCopyButton).toBe(false);
    });
  });

  describe("key spans", () => {
    it("should render a key span with correct data-test attribute for each key in value", () => {
      wrapper = mountJsonPreview({
        value: { level: "info", message: "hello", status: 200 },
      });

      expect(
        wrapper.find('[data-test="json-preview-key-level"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="json-preview-key-message"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="json-preview-key-status"]').exists(),
      ).toBe(true);
    });

    it("should render the key label text inside the key span", () => {
      wrapper = mountJsonPreview({ value: { severity: "error" } });

      const keySpan = wrapper.find('[data-test="json-preview-key-severity"]');
      expect(keySpan.exists()).toBe(true);
      expect(keySpan.text()).toContain("severity");
    });
  });

  describe("field-dropdown button without slot", () => {
    beforeEach(() => {
      wrapper = mountJsonPreview({ value: { level: "warn" } });
    });

    it("should NOT render the field-dropdown button when no field-dropdown slot is provided", () => {
      expect(
        wrapper.find('[data-test="json-preview-field-dropdown-btn"]').exists(),
      ).toBe(false);
    });
  });

  describe("field-dropdown button with slot", () => {
    beforeEach(() => {
      wrapper = mountJsonPreview(
        { value: { level: "warn" } },
        {
          "field-dropdown": `<li data-test="dropdown-slot-item">Filter</li>`,
        },
      );
    });

    it("should render the field-dropdown button when the field-dropdown slot is provided", () => {
      expect(
        wrapper.find('[data-test="json-preview-field-dropdown-btn"]').exists(),
      ).toBe(true);
    });
  });

  describe("copy event", () => {
    it("should emit the copy event with the current value when the copy button is clicked", async () => {
      const value = { level: "info", message: "hello" };
      wrapper = mountJsonPreview({ showCopyButton: true, value });

      const copyButton = wrapper.find("button");
      expect(copyButton.exists()).toBe(true);

      await copyButton.trigger("click");

      const emitted = wrapper.emitted("copy");
      expect(emitted).toBeTruthy();
      expect(emitted!.length).toBe(1);
      expect(emitted![0][0]).toEqual(value);
    });

    it("should call $q.notify after clicking the copy button", async () => {
      wrapper = mountJsonPreview({
        showCopyButton: true,
        value: { key: "val" },
      });

      const copyButton = wrapper.find("button");
      expect(copyButton.exists()).toBe(true);

      await copyButton.trigger("click");

      expect(mockNotify).toHaveBeenCalledOnce();
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: "positive" }),
      );
    });
  });

  describe("toolbar slot", () => {
    it("should render toolbar slot content when provided", () => {
      wrapper = mountJsonPreview(
        { value: { field: "val" } },
        {
          toolbar: `<button data-test="custom-toolbar-btn">View Trace</button>`,
        },
      );

      expect(
        wrapper.find('[data-test="custom-toolbar-btn"]').exists(),
      ).toBe(true);
      expect(wrapper.find('[data-test="custom-toolbar-btn"]').text()).toBe(
        "View Trace",
      );
    });

    it("should not render any toolbar content when toolbar slot is not provided", () => {
      wrapper = mountJsonPreview({ value: { field: "val" } });

      expect(
        wrapper.find('[data-test="custom-toolbar-btn"]').exists(),
      ).toBe(false);
    });
  });
});
