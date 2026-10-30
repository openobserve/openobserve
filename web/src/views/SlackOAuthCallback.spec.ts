// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import SlackOAuthCallback from "./SlackOAuthCallback.vue";

const mountCallback = async (query: Record<string, string>) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/slack/oauth/callback", component: SlackOAuthCallback }],
  });
  await router.push({ path: "/slack/oauth/callback", query });
  await router.isReady();
  return mount(SlackOAuthCallback, {
    global: { plugins: [i18n, router] },
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SlackOAuthCallback", () => {
  it("posts the code and state only to its same-origin opener", async () => {
    const opener = { postMessage: vi.fn() };
    Object.defineProperty(window, "opener", { configurable: true, value: opener });
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    const replaceState = vi.spyOn(window.history, "replaceState");

    const wrapper = await mountCallback({ code: "temporary-code", state: "signed-state" });
    await flushPromises();

    expect(replaceState).toHaveBeenCalledWith({}, document.title, window.location.pathname);
    expect(opener.postMessage).toHaveBeenCalledWith(
      {
        type: "openobserve:slack-oauth",
        code: "temporary-code",
        state: "signed-state",
      },
      window.location.origin,
    );
    expect(close).toHaveBeenCalled();
    expect(wrapper.text()).not.toContain("temporary-code");
    expect(wrapper.text()).not.toContain("signed-state");
  });

  it("reports Slack denial to the opener without forwarding arbitrary details", async () => {
    const opener = { postMessage: vi.fn() };
    Object.defineProperty(window, "opener", { configurable: true, value: opener });
    vi.spyOn(window, "close").mockImplementation(() => undefined);

    await mountCallback({ error: "access_denied", error_description: "private detail" });
    await flushPromises();

    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: "openobserve:slack-oauth", error: "access_denied" },
      window.location.origin,
    );
    expect(opener.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ error_description: expect.anything() }),
      expect.anything(),
    );
  });

  it("shows a localized error when callback parameters or opener are missing", async () => {
    Object.defineProperty(window, "opener", { configurable: true, value: null });
    const replaceState = vi.spyOn(window.history, "replaceState");
    const wrapper = await mountCallback({ code: "temporary-code" });
    await flushPromises();

    expect(replaceState).toHaveBeenCalledWith({}, document.title, window.location.pathname);
    expect(wrapper.find('[data-test="slack-oauth-callback-error"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("temporary-code");
  });
});
