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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import i18n from "@/locales";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw } from "@/types/i18n";
import {
  SLACK_OAUTH_POPUP_NAME,
  useSlackOAuthPopup,
  type UseSlackOAuthPopupOptions,
} from "./useSlackOAuthPopup";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const authorizationUrl = "https://slack.com/oauth/v2/authorize?client_id=1&state=signed";
const callback = { type: "openobserve:slack-oauth", code: "temporary-code", state: "signed" };

const makePopup = (): Window =>
  ({
    closed: false,
    close: vi.fn(),
    focus: vi.fn(),
    location: { href: "about:blank" },
  }) as unknown as Window;

let popup: Window;
let options: UseSlackOAuthPopupOptions<{ team: string }>;
let wrapper: ReturnType<typeof mountHost> | null = null;

const mountHost = () =>
  mount(
    defineComponent({
      setup: () => useSlackOAuthPopup(options),
      template: "<div />",
    }),
    { global: { plugins: [i18n] } },
  );

const post = (data: unknown, source: unknown = popup, origin = window.location.origin) =>
  window.dispatchEvent(new MessageEvent("message", { origin, source: source as Window, data }));

const lastToast = () => vi.mocked(toast).mock.calls.at(-1)?.[0];

const openPopup = async () => {
  wrapper = mountHost();
  await wrapper.vm.open();
  await flushPromises();
};

beforeEach(() => {
  vi.clearAllMocks();
  popup = makePopup();
  vi.spyOn(window, "open").mockReturnValue(popup);
  options = {
    start: vi.fn().mockResolvedValue(authorizationUrl),
    exchange: vi.fn().mockResolvedValue({ team: "Acme" }),
    onSuccess: vi.fn(),
  };
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSlackOAuthPopup", () => {
  it("opens the named popup synchronously and points it at the URL from start", async () => {
    wrapper = mountHost();
    const pending = wrapper.vm.open();

    expect(window.open).toHaveBeenCalledWith(
      "",
      SLACK_OAUTH_POPUP_NAME,
      "popup,width=720,height=760,resizable=yes,scrollbars=yes",
    );
    expect(wrapper.vm.connecting).toBe(true);
    await pending;

    expect(options.start).toHaveBeenCalledTimes(1);
    expect(popup.location.href).toBe(authorizationUrl);
    expect(popup.focus).toHaveBeenCalled();
  });

  it("does not start when the browser blocks the popup", async () => {
    vi.mocked(window.open).mockReturnValue(null);
    await openPopup();

    expect(options.start).not.toHaveBeenCalled();
    expect(wrapper!.vm.connecting).toBe(false);
    expect(lastToast()).toMatchObject({ variant: "error" });
    expect(String(lastToast()?.message)).toContain("blocked the Slack window");
  });

  it("ignores a second open while one popup is in flight", async () => {
    await openPopup();
    await wrapper!.vm.open();

    expect(window.open).toHaveBeenCalledTimes(1);
    expect(options.start).toHaveBeenCalledTimes(1);
  });

  it("AC-6.4 ignores a message from another origin or another window", async () => {
    await openPopup();

    post(callback, popup, "https://attacker.example.com");
    post(callback, makePopup());
    post(callback, window);
    await flushPromises();

    expect(options.exchange).not.toHaveBeenCalled();
    expect(popup.close).not.toHaveBeenCalled();
    expect(wrapper!.vm.connecting).toBe(true);
  });

  it.each([
    ["wrong type", { ...callback, type: "other" }],
    ["blank code", { ...callback, code: "" }],
    ["missing state", { type: callback.type, code: callback.code }],
    ["not an object", "temporary-code"],
  ])("ignores a same-origin popup message with %s", async (_case, data) => {
    await openPopup();

    post(data);
    await flushPromises();

    expect(options.exchange).not.toHaveBeenCalled();
  });

  it("exchanges the popup's code and state, closes it and hands the result over", async () => {
    await openPopup();

    post(callback);
    await flushPromises();

    expect(popup.close).toHaveBeenCalled();
    expect(options.exchange).toHaveBeenCalledWith({ code: "temporary-code", state: "signed" });
    expect(options.onSuccess).toHaveBeenCalledWith({ team: "Acme" });
    expect(wrapper!.vm.connecting).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it("does not exchange a denied authorization", async () => {
    await openPopup();

    post({ type: callback.type, error: "access_denied" });
    await flushPromises();

    expect(options.exchange).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalled();
    expect(String(lastToast()?.message)).toContain("Slack access was not granted");
  });

  it("reports a failed exchange and never calls onSuccess", async () => {
    vi.mocked(options.exchange).mockRejectedValueOnce(new Error("bad code"));
    await openPopup();

    post(callback);
    await flushPromises();

    expect(options.onSuccess).not.toHaveBeenCalled();
    expect(wrapper!.vm.connecting).toBe(false);
    expect(String(lastToast()?.message)).toContain("could not be completed");
  });

  it("closes the popup and reports a failed start", async () => {
    vi.mocked(options.start).mockRejectedValueOnce(new Error("unconfigured"));
    await openPopup();

    expect(popup.close).toHaveBeenCalled();
    expect(popup.location.href).toBe("about:blank");
    expect(wrapper!.vm.connecting).toBe(false);
    expect(String(lastToast()?.message)).toContain("could not be started");
  });

  it("leaves a popup the user already closed alone when start resolves", async () => {
    let resolveStart: (url: string) => void = () => undefined;
    vi.mocked(options.start).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );
    wrapper = mountHost();
    const pending = wrapper.vm.open();
    Object.assign(popup, { closed: true });
    resolveStart(authorizationUrl);
    await pending;

    expect(popup.location.href).toBe("about:blank");
  });

  it("returns to idle after the close grace when the user closes the popup", async () => {
    vi.useFakeTimers();
    await openPopup();

    Object.assign(popup, { closed: true });
    await vi.advanceTimersByTimeAsync(1_500);

    expect(wrapper!.vm.connecting).toBe(false);
    expect(lastToast()).toMatchObject({ variant: "warning" });

    post(callback);
    await flushPromises();
    expect(options.exchange).not.toHaveBeenCalled();
  });

  it("accepts a queued callback after the popup closes but before the grace expires", async () => {
    vi.useFakeTimers();
    await openPopup();

    Object.assign(popup, { closed: true });
    // Past the first close check (500 ms), inside the grace that follows it.
    await vi.advanceTimersByTimeAsync(700);
    post(callback);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1_500);

    expect(options.exchange).toHaveBeenCalledTimes(1);
    expect(options.onSuccess).toHaveBeenCalledWith({ team: "Acme" });
    expect(toast).not.toHaveBeenCalled();
  });

  it("removes the listener it added and closes the popup on unmount", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    await openPopup();
    const listener = add.mock.calls.find(([type]) => type === "message")?.[1];

    wrapper!.unmount();
    wrapper = null;
    post(callback);
    await flushPromises();

    expect(listener).toBeTypeOf("function");
    expect(remove).toHaveBeenCalledWith("message", listener);
    expect(popup.close).toHaveBeenCalled();
    expect(options.exchange).not.toHaveBeenCalled();
  });

  it("release(true) closes the popup and drops any later callback from it", async () => {
    await openPopup();

    wrapper!.vm.release(true);
    post(callback);
    await flushPromises();

    expect(popup.close).toHaveBeenCalled();
    expect(wrapper!.vm.connecting).toBe(false);
    expect(options.exchange).not.toHaveBeenCalled();
  });

  it("uses the caller's toast text where given", async () => {
    vi.mocked(window.open).mockReturnValue(null);
    options.messages = { popupBlocked: () => raw("Allow popups to connect Slack") };
    await openPopup();

    expect(lastToast()).toEqual({ variant: "error", message: "Allow popups to connect Slack" });
  });
});
