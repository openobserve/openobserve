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
import { leaveFor, recallLinkRequest, rememberLinkRequest } from "@/utils/slackLink";
import { makeSlackStore, ok } from "@/test/unit/helpers/slack";
import { createStore } from "vuex";
import organizations from "@/services/organizations";
import { ensureBrowserRum } from "@/utils/rum/ensureBrowserRum";
import SlackLinkCallback from "./SlackLinkCallback.vue";

vi.mock("@/services/slack", () => ({
  default: { confirmLinkRequest: vi.fn(), resendLinkRequest: vi.fn() },
}));
vi.mock("@/services/organizations", () => ({ default: { list: vi.fn() } }));
vi.mock("@/utils/rum/ensureBrowserRum", () => ({ ensureBrowserRum: vi.fn() }));
vi.mock("@/utils/slackLink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/slackLink")>()),
  leaveFor: vi.fn(),
}));

const PERMALINK = "https://acme.slack.com/archives/C0SAMPLE01/p1760000000000100";

const linked = (over: Record<string, unknown> = {}) =>
  ok({
    linked_as: "alice@acme.example",
    org_id: "prod",
    orgs: ["prod"],
    return_url: PERMALINK,
    ...over,
  });

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
      { path: "/slack/link/callback", component: SlackLinkCallback },
      { path: "/slack/link", name: "slackLink", component: { template: "<div />" } },
    ],
  });
  await router.push({ path: "/slack/link/callback", query });
  await router.isReady();
  const wrapper = mount(SlackLinkCallback, {
    global: { plugins: [i18n, router, store] },
  });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  vi.mocked(slack.confirmLinkRequest).mockReturnValue(linked() as any);
  vi.mocked(slack.resendLinkRequest).mockReturnValue(ok(undefined) as any);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("SlackLinkCallback", () => {
  it("starts RUM from the full config of the org this page resolved", async () => {
    await mountCallback();
    expect(ensureBrowserRum).toHaveBeenCalledWith("acme");
  });

  it("confirms the code, shows Linked as, then strips the query and forgets the request", async () => {
    rememberLinkRequest("req-1.sig", "#help");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const w = await mountCallback();

    expect(slack.confirmLinkRequest).toHaveBeenCalledWith("acme", {
      oidc_code: "oidc-code",
      oidc_state: "signed-state",
    });
    const card = w.find(testId("slack-link-linked"));
    expect(card.text()).toContain("Linked as alice@acme.example");
    expect(card.text()).toContain("Questions you ask in Slack run in org prod.");
    expect(replaceState).toHaveBeenCalledWith({}, document.title, window.location.pathname);
    expect(recallLinkRequest()).toBeNull();
    expect(w.text()).not.toContain("oidc-code");
  });

  it("opens the thread permalink after a moment, or at once from Back to Slack", async () => {
    vi.useFakeTimers();
    const w = await mountCallback();
    expect(leaveFor).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(leaveFor).toHaveBeenCalledWith(PERMALINK);

    vi.mocked(leaveFor).mockClear();
    await w.find(testId("slack-link-back-to-slack")).trigger("click");
    expect(leaveFor).toHaveBeenCalledWith(PERMALINK);
  });

  it("mentions Change org when the user is in more than one connected org", async () => {
    vi.mocked(slack.confirmLinkRequest).mockReturnValue(
      linked({ orgs: ["prod", "staging"] }) as any,
    );
    const w = await mountCallback();
    expect(w.find(testId("slack-link-linked")).text()).toContain(
      "Change it from the message in Slack.",
    );
  });

  it("never opens a return_url that is not http(s)", async () => {
    vi.useFakeTimers();
    vi.mocked(slack.confirmLinkRequest).mockReturnValue(
      linked({ return_url: "javascript:alert(1)" }) as any,
    );
    const w = await mountCallback();
    vi.advanceTimersByTime(5000);
    expect(leaveFor).not.toHaveBeenCalled();
    expect(w.find(testId("slack-link-back-to-slack")).exists()).toBe(false);
    expect(w.find(testId("slack-link-linked")).text()).toContain("You can close this tab.");
  });

  it.each([
    ["an https page elsewhere", "https://evil.example/phish"],
    ["a non-https Slack URL", "http://slack.com/app_redirect?team=T0"],
  ])("NIT-9 never opens %s as the return_url", async (_label, url) => {
    vi.useFakeTimers();
    vi.mocked(slack.confirmLinkRequest).mockReturnValue(linked({ return_url: url }) as any);
    const w = await mountCallback();
    vi.advanceTimersByTime(5000);
    expect(leaveFor).not.toHaveBeenCalled();
    expect(w.find(testId("slack-link-back-to-slack")).exists()).toBe(false);
  });

  it("NIT-9 returns to a page of this OpenObserve", async () => {
    const url = `${window.location.origin}/web/logs?org_identifier=prod`;
    vi.mocked(slack.confirmLinkRequest).mockReturnValue(linked({ return_url: url }) as any);
    const w = await mountCallback();
    await w.find(testId("slack-link-back-to-slack")).trigger("click");
    expect(leaveFor).toHaveBeenCalledWith(url);
  });

  it.each([400, 403, 404, 410, 429, 500])(
    "NIT-8 W-S12 a %i strips the code from the URL and forgets the stored request",
    async (status) => {
      rememberLinkRequest("req-1.sig", null);
      const replaceState = vi.spyOn(window.history, "replaceState");
      vi.mocked(slack.confirmLinkRequest).mockRejectedValue(refusal(status));
      await mountCallback();
      expect(replaceState).toHaveBeenCalledWith({}, document.title, window.location.pathname);
      expect(recallLinkRequest()).toBeNull();
    },
  );

  it("W-S12 Slack's Cancel forgets the stored request but keeps Try again", async () => {
    rememberLinkRequest("req-1.sig", null);
    const w = await mountCallback({ error: "access_denied", state: "signed-state" });
    expect(recallLinkRequest()).toBeNull();
    await w.find(testId("slack-link-retry")).trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ r: "req-1.sig" });
  });

  it("NIT-14 a caller in no org gets the no-access state, never a call with an empty org", async () => {
    vi.mocked(organizations.list).mockReturnValue(ok({ data: [] }) as any);
    const w = await mountCallback(undefined, createStore({ state: { selectedOrganization: {} } }));
    expect(slack.confirmLinkRequest).not.toHaveBeenCalled();
    expect(w.find(testId("slack-link-state-noAccess")).exists()).toBe(true);
  });

  it("keeps the code in the URL on a 401, so the login round trip can confirm it", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    vi.mocked(slack.confirmLinkRequest).mockRejectedValue(refusal(401));
    await mountCallback();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("W-S12 keeps the stored request on a 401, for the login round trip", async () => {
    rememberLinkRequest("req-1.sig", null);
    vi.mocked(slack.confirmLinkRequest).mockRejectedValue(refusal(401));
    await mountCallback();
    expect(recallLinkRequest()?.r).toBe("req-1.sig");
  });

  it.each([400, 410])(
    "%i shows This link expired and resends the remembered request",
    async (s) => {
      rememberLinkRequest("req-1.sig.part", null);
      vi.mocked(slack.confirmLinkRequest).mockRejectedValue(refusal(s));
      const w = await mountCallback();

      expect(w.find(testId("slack-link-state-expired")).exists()).toBe(true);
      await w.find(testId("slack-link-resend")).trigger("click");
      await flushPromises();
      expect(slack.resendLinkRequest).toHaveBeenCalledWith("acme", "req-1", { sig: "sig.part" });
      expect(w.find(testId("slack-link-resent")).exists()).toBe(true);
    },
  );

  it("offers no resend when this browser never started the request", async () => {
    vi.mocked(slack.confirmLinkRequest).mockRejectedValue(refusal(410));
    const w = await mountCallback();
    expect(w.find(testId("slack-link-state-expired")).exists()).toBe(true);
    expect(w.find(testId("slack-link-resend")).exists()).toBe(false);
  });

  it("AC-12.3 403 wrong account: Try again goes back through /slack/link", async () => {
    rememberLinkRequest("req-1.sig", null);
    vi.mocked(slack.confirmLinkRequest).mockRejectedValue(
      refusal(403, {
        message:
          "This link was sent to @dana in Acme, but this browser is signed in to Slack as another account",
        error_detail: "wrong_account",
      }),
    );
    const w = await mountCallback();
    expect(w.find(testId("slack-link-state-wrongAccount")).text()).toContain("@dana");

    await w.find(testId("slack-link-retry")).trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/slack/link");
    expect(router.currentRoute.value.query).toEqual({ r: "req-1.sig" });
  });

  it("a 403 without error_detail reads as the wrong Slack account here", async () => {
    vi.mocked(slack.confirmLinkRequest).mockRejectedValue(refusal(403, { message: "" }));
    const w = await mountCallback();
    expect(w.find(testId("slack-link-state-wrongAccount")).exists()).toBe(true);
    expect(w.find(testId("slack-link-retry")).exists()).toBe(false);
  });

  it("403 no access falls back to the help contact remembered from the start call", async () => {
    rememberLinkRequest("req-1.sig", "#observability-help");
    vi.mocked(slack.confirmLinkRequest).mockRejectedValue(
      refusal(403, { message: "No account", error_detail: "no_access" }),
    );
    const w = await mountCallback();
    expect(w.find(testId("slack-link-help-contact")).text()).toBe(
      "Ask #observability-help for access.",
    );
  });

  it("Slack's Cancel shows Linking was cancelled without calling confirm", async () => {
    rememberLinkRequest("req-1.sig", null);
    const w = await mountCallback({ error: "access_denied", state: "signed-state" });
    expect(slack.confirmLinkRequest).not.toHaveBeenCalled();
    expect(w.find(testId("slack-link-cancelled")).text()).toContain("Linking was cancelled");
    expect(w.find(testId("slack-link-retry")).exists()).toBe(true);
  });
});
