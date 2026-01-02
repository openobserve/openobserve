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
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "../../test/unit/helpers/install-quasar-plugin";
import { Notify, copyToClipboard } from "quasar";
import ShareButton from "./ShareButton.vue";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import shortURLService from "@/services/short_url";

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
  let i18n: any;

  beforeEach(() => {
    store = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        pendingShortURL: null,
        zoConfig: {
          web_url: "https://example.com",
        },
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

    i18n = createI18n({
      locale: "en",
      messages: {
        en: {
          search: {
            shareLink: "Share Link",
            linkCopiedSuccessfully: "Link copied successfully",
            errorCopyingLink: "Error copying link",
            errorShorteningLink: "Error shortening link",
            webUrlNotConfigured: "Share URL is disabled until ZO_WEB_URL is configured by your administrator.",
          },
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
        plugins: [store, i18n],
        stubs: {
          QBtn: {
            template: '<button :data-test="dataTest"><slot /></button>',
            props: ['dataTest', 'class', 'size', 'loading', 'disable', 'icon'],
          },
          QTooltip: { template: '<div><slot /></div>' },
        },
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should disable button when no URL is provided", () => {
    const wrapper = mount(ShareButton, {
      props: {
        url: "",
      },
      global: {
        plugins: [store, i18n],
        stubs: {
          QBtn: {
            template: '<button :disable="disable"><slot /></button>',
            props: ['dataTest', 'class', 'size', 'loading', 'disable', 'icon'],
          },
          QTooltip: { template: '<div><slot /></div>' },
        },
      },
    });

    const button = wrapper.find("button");
    expect(button.attributes("disable")).toBeDefined();
  });

  it("should copy URL to clipboard on click (Chrome)", async () => {
    // Mock non-Safari browser
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      configurable: true,
    });

    const mockCopyToClipboard = copyToClipboard as any;
    const mockCreate = shortURLService.create as any;

    mockCopyToClipboard.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({
      status: 200,
      data: { short_url: "https://short.url/abc123" },
    });

    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs?query=test",
      },
      global: {
        plugins: [store, i18n],
        stubs: {
          QBtn: {
            template: '<button @click="$emit(\'click\')"><slot /></button>',
            props: ['dataTest', 'class', 'size', 'loading', 'disable', 'icon'],
            emits: ['click'],
          },
          QTooltip: { template: '<div><slot /></div>' },
        },
      },
    });

    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(mockCreate).toHaveBeenCalledWith("test-org", "https://example.com/logs?query=test");
    expect(mockCopyToClipboard).toHaveBeenCalledWith("https://short.url/abc123");
  });

  it("should emit copy:success event when copy succeeds (Chrome)", async () => {
    // Mock non-Safari browser
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      configurable: true,
    });

    const mockCopyToClipboard = copyToClipboard as any;
    const mockCreate = shortURLService.create as any;

    mockCopyToClipboard.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({
      status: 200,
      data: { short_url: "https://short.url/abc123" },
    });

    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs?query=test",
      },
      global: {
        plugins: [store, i18n],
        stubs: {
          QBtn: {
            template: '<button @click="$emit(\'click\')"><slot /></button>',
            props: ['dataTest', 'class', 'size', 'loading', 'disable', 'icon'],
            emits: ['click'],
          },
          QTooltip: { template: '<div><slot /></div>' },
        },
      },
    });

    await wrapper.find("button").trigger("click");
    await flushPromises();

    const copyEvents = wrapper.emitted("copy:success");
    expect(copyEvents).toBeTruthy();
    expect(copyEvents?.[0]?.[0]).toEqual({
      url: "https://short.url/abc123",
      type: "short",
    });
  });

  it("should show custom tooltip when provided", () => {
    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs",
        tooltip: "Custom Share Tooltip",
      },
      global: {
        plugins: [store, i18n],
        stubs: {
          QBtn: {
            template: '<button><slot /></button>',
            props: ['dataTest', 'class', 'size', 'loading', 'disable', 'icon'],
          },
          QTooltip: {
            template: '<div class="tooltip">{{ $slots.default?.()[0]?.children }}</div>',
          },
        },
      },
    });

    expect(wrapper.html()).toContain("Custom Share Tooltip");
  });

  it("should use custom button class and size", () => {
    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs",
        buttonClass: "custom-class",
        buttonSize: "md",
      },
      global: {
        plugins: [store, i18n],
        stubs: {
          QBtn: {
            template: '<button :class="buttonClass" :size="buttonSize"><slot /></button>',
            props: ['dataTest', 'buttonClass', 'buttonSize', 'loading', 'disable', 'icon'],
          },
          QTooltip: { template: '<div><slot /></div>' },
        },
      },
    });

    const button = wrapper.find("button");
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
        plugins: [store, i18n],
        stubs: {
          QBtn: {
            template: '<button><slot /></button>',
            props: ['dataTest', 'class', 'size', 'loading', 'disable', 'icon'],
          },
          QTooltip: { template: '<div><slot /></div>' },
        },
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
        plugins: [store, i18n],
        stubs: {
          QBtn: {
            template: '<button :disable="disable"><slot /></button>',
            props: ['dataTest', 'class', 'size', 'loading', 'disable', 'icon'],
          },
          QTooltip: { template: '<div><slot /></div>' },
        },
      },
    });

    const button = wrapper.find("button");
    expect(button.attributes("disable")).toBeDefined();
  });

  it("should disable button when web_url is not configured", () => {
    const storeWithoutWebUrl = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        pendingShortURL: null,
        zoConfig: {
          web_url: "",
        },
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

    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs",
      },
      global: {
        plugins: [storeWithoutWebUrl, i18n],
        stubs: {
          QBtn: {
            template: '<button :disable="disable"><slot /></button>',
            props: ['dataTest', 'class', 'size', 'loading', 'disable', 'icon'],
          },
          QTooltip: { template: '<div><slot /></div>' },
        },
      },
    });

    const button = wrapper.find("button");
    expect(button.attributes("disable")).toBeDefined();
  });

  it("should show warning tooltip when web_url is not configured", () => {
    const storeWithoutWebUrl = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        pendingShortURL: null,
        zoConfig: {
          web_url: "",
        },
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

    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs",
      },
      global: {
        plugins: [storeWithoutWebUrl, i18n],
      },
    });

    // Check that isWebUrlNotConfigured computed property is true
    expect(wrapper.vm.isWebUrlNotConfigured).toBe(true);
  });
});
