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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ShareButton from "./ShareButton.vue";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import shortURLService from "@/services/short_url";

// Mock copyToClipboard
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: vi.fn(() => Promise.resolve(true)),
}));

import { copyToClipboard } from "@/utils/clipboard";

// Mock short URL service
vi.mock("@/services/short_url", () => ({
  default: {
    create: vi.fn(() =>
      Promise.resolve({
        status: 200,
        data: { short_url: "https://short.url/abc123" },
      }),
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
            webUrlNotConfigured:
              "Share URL is disabled until ZO_WEB_URL is configured by your administrator.",
          },
        },
      },
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("keeps the icon-only Share name distinct from its unavailable reason", () => {
    const wrapper = mount(ShareButton, {
      props: { url: "https://example.com/logs", disabled: true, tooltip: "Run first" },
      global: { plugins: [store, i18n] },
    });
    const button = wrapper.get("button");
    expect(button.attributes("aria-label")).toBe("Share Link");
    const reason = wrapper.get(".sr-only");
    expect(reason.attributes("aria-hidden")).toBe("true");
    expect(button.attributes("aria-describedby")).toBe(reason.attributes("id"));
    expect(reason.text()).toBe("Run first");
    wrapper.unmount();
  });

  it.each(["", "   "])(
    "describes an unconfigured web URL (%j) while keeping Share focusable",
    async (webUrl) => {
      store.state.zoConfig.web_url = webUrl;
      const wrapper = mount(ShareButton, {
        props: { url: "https://example.com/logs", tooltip: "Run first" },
        attachTo: document.body,
        global: { plugins: [store, i18n] },
      });
      const button = wrapper.get("button");
      expect(button.attributes("aria-label")).toBe("Share Link");
      expect(button.attributes("disabled")).toBeUndefined();
      expect(button.attributes("aria-disabled")).toBe("true");
      const reason = wrapper.get(".sr-only");
      expect(button.attributes("aria-describedby")).toBe(reason.attributes("id"));
      expect(reason.text()).toBe(
        "Share URL is disabled until ZO_WEB_URL is configured by your administrator.",
      );
      button.element.focus();
      expect(document.activeElement).toBe(button.element);
      await button.trigger("keydown", { key: "Enter" });
      await button.trigger("keydown", { key: " " });
      await button.trigger("click");
      expect(shortURLService.create).not.toHaveBeenCalled();
      expect(copyToClipboard).not.toHaveBeenCalled();
      wrapper.unmount();
    },
  );

  it("should render the share button", () => {
    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs?query=test",
      },
      global: {
        plugins: [store, i18n],
        stubs: {
          OButton: {
            template: '<button :data-test="dataTest"><slot /></button>',
            props: ["dataTest", "class", "size", "loading", "disable", "icon"],
          },
          OTooltip: { template: "<div><slot /></div>" },
        },
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("exposes handleShareClick, which keyboard shortcuts invoke through a template ref", () => {
    const wrapper = mount(ShareButton, {
      props: {
        url: "https://example.com/logs?query=test",
      },
      global: {
        plugins: [store, i18n],
      },
    });

    expect(typeof wrapper.vm.handleShareClick).toBe("function");
  });

  it("should disable button when no URL is provided", () => {
    const wrapper = mount(ShareButton, {
      props: {
        url: "",
      },
      global: {
        plugins: [store, i18n],
        stubs: {
          OButton: {
            template: '<button :disable="disable"><slot /></button>',
            props: ["dataTest", "class", "size", "loading", "disable", "icon"],
          },
          OTooltip: { template: "<div><slot /></div>" },
        },
      },
    });

    const button = wrapper.find("button");
    expect(button.attributes("disabled")).toBeDefined();
  });

  it("should copy URL to clipboard on click (Chrome)", async () => {
    // Mock non-Safari browser
    Object.defineProperty(window.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
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
          OButton: {
            template: "<button @click=\"$emit('click')\"><slot /></button>",
            props: ["dataTest", "class", "size", "loading", "disable", "icon"],
            emits: ["click"],
          },
          OTooltip: { template: "<div><slot /></div>" },
        },
      },
    });

    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(mockCreate).toHaveBeenCalledWith("test-org", "https://example.com/logs?query=test");
    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      "https://short.url/abc123",
      expect.any(Function),
      {
        successMessage: "Link copied successfully",
        errorMessage: "Error copying link",
        timeout: 5000,
        anchor: wrapper.find("button").element,
      },
    );
  });

  it("anchors the Copied confirmation on the share button, even from a shortcut", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0",
      configurable: true,
    });
    (shortURLService.create as any).mockResolvedValue({
      status: 200,
      data: { short_url: "https://short.url/abc123" },
    });
    const wrapper = mount(ShareButton, {
      props: { url: "https://example.com/logs" },
      global: { plugins: [store, i18n] },
    });

    (wrapper.vm as any).handleShareClick();
    await flushPromises();

    expect((copyToClipboard as any).mock.calls[0][2].anchor).toBe(wrapper.get("button").element);
    wrapper.unmount();
  });

  it("should emit copy:success event when copy succeeds (Chrome)", async () => {
    // Mock non-Safari browser
    Object.defineProperty(window.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      configurable: true,
    });

    const mockCopyToClipboard = copyToClipboard as any;
    const mockCreate = shortURLService.create as any;

    // Must resolve to true so the component emits copy:success (not copy:error)
    mockCopyToClipboard.mockResolvedValue(true);
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
          OButton: {
            template: "<button @click=\"$emit('click')\"><slot /></button>",
            props: ["dataTest", "class", "size", "loading", "disable", "icon"],
            emits: ["click"],
          },
          OTooltip: { template: "<div><slot /></div>" },
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
          OButton: {
            template: "<button><slot /></button>",
            props: ["dataTest", "class", "size", "loading", "disable", "icon"],
          },
          OTooltip: {
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
          OTooltip: { template: "<div><slot /></div>" },
        },
      },
    });

    const button = wrapper.find("button");
    expect(button.classes()).toContain("custom-class");
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
          OButton: {
            template: "<button><slot /></button>",
            props: ["dataTest", "class", "size", "loading", "disable", "icon"],
          },
          OTooltip: { template: "<div><slot /></div>" },
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
          OButton: {
            template: '<button :disable="disable"><slot /></button>',
            props: ["dataTest", "class", "size", "loading", "disable", "icon"],
          },
          OTooltip: { template: "<div><slot /></div>" },
        },
      },
    });

    const button = wrapper.find("button");
    expect(button.attributes("disabled")).toBeDefined();
  });

  it("ignores a programmatic handleShareClick when web_url is not configured", async () => {
    const storeWithoutWebUrl = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        pendingShortURL: null,
        zoConfig: { web_url: "" },
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
      props: { url: "https://example.com/logs" },
      global: { plugins: [storeWithoutWebUrl, i18n] },
    });

    // Keyboard shortcuts call this directly, so the disabled attribute cannot gate it.
    wrapper.vm.handleShareClick();
    await flushPromises();

    expect(shortURLService.create).not.toHaveBeenCalled();
  });

  it("ignores a programmatic handleShareClick while the disabled prop is set", async () => {
    const wrapper = mount(ShareButton, {
      props: { url: "https://example.com/logs", disabled: true },
      global: { plugins: [store, i18n] },
    });

    wrapper.vm.handleShareClick();
    await flushPromises();

    expect(shortURLService.create).not.toHaveBeenCalled();
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
          OButton: {
            template: '<button :disable="disable"><slot /></button>',
            props: ["dataTest", "class", "size", "loading", "disable", "icon"],
          },
          OTooltip: { template: "<div><slot /></div>" },
        },
      },
    });

    const button = wrapper.find("button");
    expect(button.attributes("disabled")).toBeDefined();
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

  describe("live and fixed links", () => {
    const FIXED = "https://example.com/logs?from=1&to=2";
    const LIVE = "https://example.com/logs?period=15m";
    const FIXED_LABEL = "Nov 11, 12:27 – 12:42 UTC+05:30";
    const kindI18n = () =>
      createI18n({
        locale: "en",
        messages: {
          en: {
            search: {
              shareLink: "Share Link",
              linkCopiedSuccessfully: "Link copied successfully",
              errorCopyingLink: "Error copying link",
              errorShorteningLink: "Error shortening link",
              webUrlNotConfigured: "Not configured",
            },
            dateTime: {
              shareCopyLive: "Copy live link",
              shareCopyFixed: "Copy fixed link",
              shareCopyWithRange: "Copy link and range",
              shareLiveHint: "{name} · moves with now",
              shareKindLive: "live",
              shareKindFixed: "fixed",
              shareOptions: "Share options",
              linkCopiedFixed: "Fixed link copied · {range}",
              linkCopiedLive: "Live link copied · {name}",
            },
          },
        },
      });
    const mountKinds = (props: Record<string, unknown>) =>
      mount(ShareButton, {
        props: {
          url: FIXED,
          fixedLabel: FIXED_LABEL,
          liveLabel: "Last 15 minutes",
          ...props,
        },
        global: {
          plugins: [store, kindI18n()],
          stubs: {
            OButton: {
              template:
                '<button :data-test="dataTest" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
              props: ["dataTest", "disabled"],
              emits: ["click"],
            },
            OTooltip: {
              props: ["content"],
              template: "<span data-test='tip'>{{ content }}</span>",
            },
            ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
            ODropdownSeparator: { template: "<hr />" },
            ODropdownItem: {
              template:
                "<div role='menuitem' @click=\"$emit('select')\"><slot /><slot name='icon-right' /></div>",
              emits: ["select"],
            },
          },
        },
      });
    const lastCopy = () => (copyToClipboard as any).mock.calls.at(-1);
    const itemIds = (wrapper: ReturnType<typeof mountKinds>) =>
      wrapper.findAll('[role="menuitem"]').map((item) => item.attributes("data-test"));

    beforeEach(() => {
      Object.defineProperty(window.navigator, "userAgent", {
        value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0 Safari/537.36",
        configurable: true,
      });
      (copyToClipboard as any).mockResolvedValue(true);
      (shortURLService.create as any).mockResolvedValue({
        status: 200,
        data: { short_url: "https://short.url/abc123" },
      });
    });

    it("copies the fixed window first by default and names it with its zone in the toast", async () => {
      const wrapper = mountKinds({ liveUrl: LIVE });
      await wrapper.get('[data-test="share-link-btn"]').trigger("click");
      await flushPromises();
      expect(shortURLService.create).toHaveBeenCalledWith("test-org", FIXED);
      expect(lastCopy()[0]).toBe("https://short.url/abc123");
      expect(lastCopy()[2].successMessage).toBe(`Fixed link copied · ${FIXED_LABEL}`);
    });

    it("copies the live period first when the page default is live", async () => {
      const wrapper = mountKinds({ liveUrl: LIVE, defaultKind: "live" });
      await wrapper.get('[data-test="share-link-btn"]').trigger("click");
      await flushPromises();
      expect(shortURLService.create).toHaveBeenCalledWith("test-org", LIVE);
      expect(lastCopy()[2].successMessage).toBe("Live link copied · Last 15 minutes");
    });

    it.each(["fixed", "live"])(
      "lists live, then fixed, then the range copy, and checks the %s default",
      (defaultKind) => {
        const wrapper = mountKinds({ liveUrl: LIVE, defaultKind, rangeContext: "Logs · default" });
        expect(itemIds(wrapper)).toEqual([
          "share-button-copy-live",
          "share-button-copy-fixed",
          "share-button-copy-with-range",
        ]);
        const checked = wrapper
          .findAll('[role="menuitem"]')
          .filter((item) => item.find('[data-test="share-button-default-check"]').exists());
        expect(checked.map((item) => item.attributes("data-test"))).toEqual([
          `share-button-copy-${defaultKind}`,
        ]);
        expect(wrapper.get('[data-test="share-button-copy-live"]').text()).toContain(
          "Last 15 minutes · moves with now",
        );
        expect(wrapper.get('[data-test="share-button-copy-fixed"]').text()).toContain(FIXED_LABEL);
      },
    );

    it("copies the other kind picked from the caret menu", async () => {
      const wrapper = mountKinds({ liveUrl: LIVE });
      await wrapper.get('[data-test="share-button-copy-live"]').trigger("click");
      await flushPromises();
      expect(shortURLService.create).toHaveBeenCalledWith("test-org", LIVE);
      expect(lastCopy()[2].successMessage).toBe("Live link copied · Last 15 minutes");
    });

    it("copies the default link and a line naming page, range and kind", async () => {
      const wrapper = mountKinds({
        liveUrl: LIVE,
        rangeContext: "Logs · default",
        fixedCopyLabel: "Nov 11, 06:57 – 07:12 UTC",
      });
      await wrapper.get('[data-test="share-button-copy-with-range"]').trigger("click");
      await flushPromises();
      expect(shortURLService.create).toHaveBeenCalledWith("test-org", FIXED);
      expect(lastCopy()[0]).toBe(
        "https://short.url/abc123\nLogs · default · Nov 11, 06:57 – 07:12 UTC · fixed",
      );
    });

    it("names the live period, its dates and offset in the live range copy", async () => {
      const wrapper = mountKinds({
        liveUrl: LIVE,
        defaultKind: "live",
        rangeContext: "Logs · default",
        fixedCopyLabel: "Nov 11, 06:57 – 07:12 UTC",
      });
      await wrapper.get('[data-test="share-button-copy-with-range"]').trigger("click");
      await flushPromises();
      expect(shortURLService.create).toHaveBeenCalledWith("test-org", LIVE);
      expect(lastCopy()[0]).toBe(
        "https://short.url/abc123\nLogs · default · Last 15 minutes · Nov 11, 06:57 – 07:12 UTC · live",
      );
    });

    it("says why Share is greyed instead of naming the copy kind", () => {
      const wrapper = mountKinds({ liveUrl: LIVE, disabled: true, tooltip: "Run the query first" });
      const tip = wrapper.get('[data-test="share-link-btn"] [data-test="tip"]');
      expect(tip.text()).toBe("Run the query first");
    });

    it("names the copy kind on the main button when Share is available", () => {
      const wrapper = mountKinds({ liveUrl: LIVE });
      const tip = wrapper.get('[data-test="share-link-btn"] [data-test="tip"]');
      expect(tip.text()).toBe("Copy fixed link");
    });

    it("offers the fixed link and the range copy for a fixed range", async () => {
      const wrapper = mountKinds({ liveUrl: "", defaultKind: "live", rangeContext: "Traces · t" });
      expect(itemIds(wrapper)).toEqual(["share-button-copy-fixed", "share-button-copy-with-range"]);
      await wrapper.get('[data-test="share-link-btn"]').trigger("click");
      await flushPromises();
      expect(shortURLService.create).toHaveBeenCalledWith("test-org", FIXED);
      expect(lastCopy()[2].successMessage).toBe(`Fixed link copied · ${FIXED_LABEL}`);
    });

    it("is a plain button, copied at once, for a fixed range with no range context", () => {
      const wrapper = mountKinds({ liveUrl: "" });
      expect(wrapper.find('[data-test="share-link-btn-kinds"]').exists()).toBe(false);
      expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(0);
    });

    it("keeps the generic toast when the caller gives no label", async () => {
      const wrapper = mountKinds({ fixedLabel: "", liveLabel: "" });
      await wrapper.get('[data-test="share-link-btn"]').trigger("click");
      await flushPromises();
      expect(lastCopy()[2].successMessage).toBe("Link copied successfully");
    });

    it("disables the caret with the main button when the web URL is not configured", () => {
      store.state.zoConfig.web_url = "";
      const wrapper = mountKinds({ liveUrl: LIVE });
      expect(
        wrapper.get('[data-test="share-link-btn-kinds"]').attributes("disabled"),
      ).toBeDefined();
    });
  });
});
