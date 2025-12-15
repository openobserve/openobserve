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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "../../test/unit/helpers/install-quasar-plugin";
import { Notify, copyToClipboard } from "quasar";
import ShareButton from "./ShareButton.vue";
import { createStore } from "vuex";

installQuasar({
  plugins: { Notify },
});

// Mock copyToClipboard
vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    copyToClipboard: vi.fn(() => Promise.resolve()),
  };
});

// Mock short URL service
vi.mock("@/services/short_url", () => ({
  default: {
    create: vi.fn(() =>
      Promise.resolve({
        status: 200,
        data: { short_url: "https://short.url/abc123" },
      })
    ),
  },
}));

describe("ShareButton", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        pendingShortURL: null,
      },
      mutations: {
        setPendingShortURL(state, payload) {
          state.pendingShortURL = payload;
        },
        clearPendingShortURL(state) {
          state.pendingShortURL = null;
        },
      },
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("should render the share button", () => {
    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs?query=test",
      },
      global: {
        plugins: [store],
        stubs: ["q-btn", "q-tooltip"],
      },
    });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find('[data-test="share-link-btn"]').exists()).toBe(true);
  });

  it("should disable button when no URL is provided", () => {
    const wrapper = mount(ShareButton, {
      props: {
        url: "",
      },
      global: {
        plugins: [store],
        stubs: ["q-btn", "q-tooltip"],
      },
    });

    const button = wrapper.find("q-btn-stub");
    expect(button.attributes("disable")).toBe("true");
  });

  it("should copy URL to clipboard on click", async () => {
    const mockCopyToClipboard = copyToClipboard as any;
    mockCopyToClipboard.mockResolvedValue(undefined);

    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs?query=test",
      },
      global: {
        plugins: [store],
        stubs: ["q-btn", "q-tooltip"],
      },
    });

    await wrapper.vm.handleShareClick();

    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      "https://example.com/logs?query=test"
    );
  });

  it("should emit copy:success event when copy succeeds", async () => {
    const mockCopyToClipboard = copyToClipboard as any;
    mockCopyToClipboard.mockResolvedValue(undefined);

    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs?query=test",
      },
      global: {
        plugins: [store],
        stubs: ["q-btn", "q-tooltip"],
      },
    });

    await wrapper.vm.handleShareClick();
    await wrapper.vm.$nextTick();

    // Wait for promise to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    const copyEvents = wrapper.emitted("copy:success");
    expect(copyEvents).toBeTruthy();
    expect(copyEvents?.[0]?.[0]).toEqual({
      url: "https://example.com/logs?query=test",
      type: "long",
    });
  });

  it("should show custom tooltip when provided", () => {
    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs",
        tooltip: "Custom Share Tooltip",
      },
      global: {
        plugins: [store],
        stubs: ["q-btn", "q-tooltip"],
      },
    });

    const tooltip = wrapper.find("q-tooltip-stub");
    expect(tooltip.text()).toContain("Custom Share Tooltip");
  });

  it("should use custom button class and size", () => {
    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs",
        buttonClass: "custom-class",
        buttonSize: "md",
      },
      global: {
        plugins: [store],
        stubs: ["q-btn", "q-tooltip"],
      },
    });

    const button = wrapper.find("q-btn-stub");
    expect(button.attributes("class")).toBe("custom-class");
    expect(button.attributes("size")).toBe("md");
  });

  it("should show label when showLabel is true", () => {
    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs",
        showLabel: true,
      },
      global: {
        plugins: [store],
        stubs: ["q-btn", "q-tooltip"],
      },
    });

    expect(wrapper.find("span").exists()).toBe(true);
  });

  it("should respect disabled prop", () => {
    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs",
        disabled: true,
      },
      global: {
        plugins: [store],
        stubs: ["q-btn", "q-tooltip"],
      },
    });

    const button = wrapper.find("q-btn-stub");
    expect(button.attributes("disable")).toBe("true");
  });
});
