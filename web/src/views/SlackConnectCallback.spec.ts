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
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import slack from "@/services/slack";
import { makeSlackStore, ok } from "@/test/unit/helpers/slack";
import { isSlackOAuthCallbackMessage } from "@/utils/slackOAuth";
import { createStore } from "vuex";
import organizations from "@/services/organizations";
import { ensureBrowserRum } from "@/utils/rum/ensureBrowserRum";
import SlackConnectCallback from "./SlackConnectCallback.vue";

vi.mock("@/services/slack", () => ({ default: { confirmConnection: vi.fn() } }));
vi.mock("@/services/organizations", () => ({ default: { list: vi.fn() } }));
vi.mock("@/utils/rum/ensureBrowserRum", () => ({ ensureBrowserRum: vi.fn() }));

const refusal = (status: number, data: Record<string, unknown> = {}) =>
  Object.assign(new Error("refused"), {
    response: { status, data: { code: status, message: "refused", ...data } },
  });

const testId = (id: string) => `[data-test="${id}"]`;

let router: Router;

const mountCallback = async (
  query: Record<string, string> = { code: "oidc-code", state: "signed-state" },
  store = makeSlackStore(),
) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/slack/connect/callback", component: SlackConnectCallback },
      { path: "/settings/slack", name: "slack", component: { template: "<div />" } },
    ],
  });
  await router.push({ path: "/slack/connect/callback", query });
  await router.isReady();
  const wrapper = mount(SlackConnectCallback, {
    global: { plugins: [i18n, router, store] },
  });
  await flushPromises();
  return wrapper;
};

const setOpener = (value: unknown) =>
  Object.defineProperty(window, "opener", { configurable: true, value });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(slack.confirmConnection).mockReturnValue(ok({ connected: true }) as any);
});

afterEach(() => {
  setOpener(null);
  vi.restoreAllMocks();
});

describe("SlackConnectCallback", () => {
  it("starts RUM from the full config of the org this page resolved", async () => {
    await mountCallback();
    expect(ensureBrowserRum).toHaveBeenCalledWith("acme");
  });

  it("in a popup, posts {type, code, state} to its same-origin opener and closes", async () => {
    const opener = { postMessage: vi.fn() };
    setOpener(opener);
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    const replaceState = vi.spyOn(window.history, "replaceState");

    await mountCallback();

    const [message, origin] = opener.postMessage.mock.calls[0];
    expect(message).toEqual({
      type: "openobserve:slack-oauth",
      code: "oidc-code",
      state: "signed-state",
    });
    expect(isSlackOAuthCallbackMessage(message)).toBe(true);
    expect(origin).toBe(window.location.origin);
    expect(close).toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith({}, document.title, window.location.pathname);
    expect(slack.confirmConnection).not.toHaveBeenCalled();
  });

  it("in a popup, forwards Slack's denial code only", async () => {
    const opener = { postMessage: vi.fn() };
    setOpener(opener);
    vi.spyOn(window, "close").mockImplementation(() => undefined);
    await mountCallback({ error: "access_denied", error_description: "private detail" });
    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: "openobserve:slack-oauth", error: "access_denied" },
      window.location.origin,
    );
  });

  it("without an opener, confirms the connection itself and shows the result", async () => {
    setOpener(null);
    const replaceState = vi.spyOn(window.history, "replaceState");
    const w = await mountCallback();

    expect(slack.confirmConnection).toHaveBeenCalledWith("acme", {
      oidc_code: "oidc-code",
      oidc_state: "signed-state",
    });
    expect(w.find(testId("slack-connect-callback-connected")).text()).toContain(
      "This org is connected to Slack",
    );
    expect(replaceState).toHaveBeenCalled();

    await w.find(testId("slack-connect-callback-settings")).trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/settings/slack");
    expect(router.currentRoute.value.query).toEqual({ org_identifier: "acme" });
  });

  it("without an opener, reports a passing Step 4 test", async () => {
    setOpener(null);
    vi.mocked(slack.confirmConnection).mockReturnValue(ok({ test: "pass" }) as any);
    const w = await mountCallback();
    expect(w.find(testId("slack-connect-callback-test")).text()).toContain(
      "Sign in with Slack works",
    );
  });

  it("keeps the code in the URL on a 401", async () => {
    setOpener(null);
    const replaceState = vi.spyOn(window.history, "replaceState");
    vi.mocked(slack.confirmConnection).mockRejectedValue(refusal(401));
    await mountCallback();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it.each([
    [410, "This sign-in expired", null],
    [403, "Slack sign-in could not be completed", "Only an admin of org prod can do this"],
  ])("without an opener, %i shows its refusal", async (status, title, message) => {
    setOpener(null);
    vi.mocked(slack.confirmConnection).mockRejectedValue(
      refusal(status, message ? { message } : {}),
    );
    const w = await mountCallback();
    const state = w.find(testId("slack-connect-callback-refused"));
    expect(state.text()).toContain(title);
    if (message) expect(state.text()).toContain(message);
    expect(w.find(testId("slack-connect-callback-settings")).exists()).toBe(true);
  });

  it.each([400, 403, 404, 410, 500])(
    "NIT-8 without an opener, a %i strips the code from the URL",
    async (status) => {
      setOpener(null);
      const replaceState = vi.spyOn(window.history, "replaceState");
      vi.mocked(slack.confirmConnection).mockRejectedValue(refusal(status));
      await mountCallback();
      expect(replaceState).toHaveBeenCalledWith({}, document.title, window.location.pathname);
    },
  );

  it("NIT-14 without an opener, a caller in no org gets the no-access state and no call", async () => {
    setOpener(null);
    vi.mocked(organizations.list).mockReturnValue(ok({ data: [] }) as any);
    const w = await mountCallback(undefined, createStore({ state: { selectedOrganization: {} } }));
    expect(slack.confirmConnection).not.toHaveBeenCalled();
    expect(w.find(testId("slack-connect-callback-refused")).text()).toContain(
      "You don't have access to OpenObserve yet",
    );
  });

  it("without an opener or a code, shows the refusal without calling the server", async () => {
    setOpener(null);
    const w = await mountCallback({ state: "signed-state" });
    expect(slack.confirmConnection).not.toHaveBeenCalled();
    expect(w.find(testId("slack-connect-callback-refused")).exists()).toBe(true);
  });
});
