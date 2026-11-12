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
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import { createStore } from "vuex";
import organizations from "@/services/organizations";
import slack from "@/services/slack";
import { leaveFor, recallLinkRequest } from "@/utils/slackLink";
import { axiosError, makeSlackStore, ok } from "@/test/unit/helpers/slack";
import { ensureBrowserRum } from "@/utils/rum/ensureBrowserRum";
import SlackLink from "./SlackLink.vue";

vi.mock("@/services/slack", () => ({
  default: { startLinkRequest: vi.fn(), resendLinkRequest: vi.fn() },
}));
vi.mock("@/services/organizations", () => ({ default: { list: vi.fn() } }));
vi.mock("@/utils/rum/ensureBrowserRum", () => ({ ensureBrowserRum: vi.fn() }));
vi.mock("@/utils/slackLink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/slackLink")>()),
  leaveFor: vi.fn(),
}));

const SIGN_IN_URL = "https://slack.com/openid/connect/authorize?team=T0SAMPLE01&state=s";

const started = (over: Record<string, unknown> = {}) =>
  ok({
    url: SIGN_IN_URL,
    request: { question_preview: "what is wrong", channel_name: "sre", team_name: "Acme Corp" },
    help_contact: "#observability-help",
    ...over,
  });

const refusal = (status: number, data: Record<string, unknown> = {}) =>
  Object.assign(axiosError(status), {
    response: { status, data: { code: status, message: "refused", ...data } },
  });

const mountLink = async (
  query: Record<string, string> = { r: "req-1.sig.part" },
  store = makeSlackStore(),
) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/slack/link", name: "slackLink", component: SlackLink }],
  });
  await router.push({ path: "/slack/link", query });
  await router.isReady();
  const wrapper = mount(SlackLink, { global: { plugins: [i18n, router, store] } });
  await flushPromises();
  return wrapper;
};

const testId = (id: string) => `[data-test="${id}"]`;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(slack.startLinkRequest).mockReturnValue(started() as any);
  vi.mocked(slack.resendLinkRequest).mockReturnValue(ok(undefined) as any);
});

afterEach(() => {
  localStorage.clear();
});

describe("SlackLink (N7 pass-through)", () => {
  it("starts RUM from the full config of the org this page resolved", async () => {
    await mountLink();
    expect(ensureBrowserRum).toHaveBeenCalledWith("acme");
  });

  it("starts the request with the signature from ?r and hands off to Sign in with Slack", async () => {
    const w = await mountLink();

    expect(slack.startLinkRequest).toHaveBeenCalledWith("acme", "req-1", { sig: "sig.part" });
    expect(leaveFor).toHaveBeenCalledWith(SIGN_IN_URL);
    expect(recallLinkRequest()).toEqual({
      r: "req-1.sig.part",
      helpContact: "#observability-help",
    });
    expect(w.find(testId("slack-link-card-working")).text()).toContain(
      "Linking your Slack account…",
    );
  });

  it("uses the org named in the link over the selected org", async () => {
    await mountLink({ r: "req-1.sig", org_identifier: "prod" });
    expect(slack.startLinkRequest).toHaveBeenCalledWith("prod", "req-1", { sig: "sig" });
  });

  it("on a fresh load with no selected org, uses the caller's default org", async () => {
    vi.mocked(organizations.list).mockReturnValue(
      ok({
        data: [
          { identifier: "team-b", name: "Team B", type: "custom" },
          { identifier: "home", name: "Home", type: "default" },
        ],
      }) as any,
    );
    await mountLink(undefined, createStore({ state: { selectedOrganization: {} } }));
    expect(organizations.list).toHaveBeenCalled();
    expect(slack.startLinkRequest).toHaveBeenCalledWith("home", "req-1", { sig: "sig.part" });
  });

  it("does not fetch the org list when an org is already selected", async () => {
    await mountLink();
    expect(organizations.list).not.toHaveBeenCalled();
  });

  it("never leaves for a URL that is not http(s)", async () => {
    vi.mocked(slack.startLinkRequest).mockReturnValue(
      started({ url: "javascript:alert(1)" }) as any,
    );
    const w = await mountLink();
    expect(leaveFor).not.toHaveBeenCalled();
    expect(w.find(testId("slack-link-state-failed")).exists()).toBe(true);
  });

  it.each(["https://evil.example/openid/connect/authorize", "http://slack.com/openid"])(
    "NIT-9 never leaves for %s, which is not Slack's own https sign-in",
    async (url) => {
      vi.mocked(slack.startLinkRequest).mockReturnValue(started({ url }) as any);
      const w = await mountLink();
      expect(leaveFor).not.toHaveBeenCalled();
      expect(w.find(testId("slack-link-state-failed")).exists()).toBe(true);
      expect(recallLinkRequest()).toBeNull();
    },
  );

  it("NIT-14 a caller in no org gets the no-access state, never a call with an empty org", async () => {
    vi.mocked(organizations.list).mockReturnValue(ok({ data: [] }) as any);
    const w = await mountLink(undefined, createStore({ state: { selectedOrganization: {} } }));
    expect(slack.startLinkRequest).not.toHaveBeenCalled();
    expect(w.find(testId("slack-link-state-noAccess")).exists()).toBe(true);
  });

  it("treats a malformed ?r as an unknown link without calling the server", async () => {
    const w = await mountLink({ r: "nodot" });
    expect(slack.startLinkRequest).not.toHaveBeenCalled();
    expect(w.find(testId("slack-link-state-unknown")).text()).toContain("This link expired");
    expect(w.find(testId("slack-link-resend")).exists()).toBe(false);
  });

  it.each([400, 410])(
    "AC-12.3 %i shows This link expired with Send me a new link, which resends",
    async (status) => {
      vi.mocked(slack.startLinkRequest).mockRejectedValue(refusal(status));
      const w = await mountLink();

      expect(w.find(testId("slack-link-state-expired")).text()).toContain("This link expired");
      await w.find(testId("slack-link-resend")).trigger("click");
      await flushPromises();

      expect(slack.resendLinkRequest).toHaveBeenCalledWith("acme", "req-1", { sig: "sig.part" });
      expect(w.find(testId("slack-link-resent")).text()).toContain("We sent you a new link");
      expect(leaveFor).not.toHaveBeenCalled();
    },
  );

  it("404 shows This link expired without a resend", async () => {
    vi.mocked(slack.startLinkRequest).mockRejectedValue(refusal(404));
    const w = await mountLink();
    expect(w.find(testId("slack-link-state-unknown")).exists()).toBe(true);
    expect(w.find(testId("slack-link-resend")).exists()).toBe(false);
    expect(w.find(testId("slack-link-retry")).exists()).toBe(false);
  });

  it("a failed resend shows its own refusal", async () => {
    vi.mocked(slack.startLinkRequest).mockRejectedValue(refusal(410));
    vi.mocked(slack.resendLinkRequest).mockRejectedValue(refusal(429));
    const w = await mountLink();
    await w.find(testId("slack-link-resend")).trigger("click");
    await flushPromises();
    expect(w.find(testId("slack-link-state-rateLimited")).exists()).toBe(true);
  });

  it("AC-12.3 403 no access shows the server sentence and the help contact", async () => {
    vi.mocked(slack.startLinkRequest).mockRejectedValue(
      refusal(403, {
        message: "You don't have access to OpenObserve in Acme yet",
        error_detail: "no_access",
        hint: "#observability-help",
      }),
    );
    const w = await mountLink();
    const state = w.find(testId("slack-link-state-noAccess"));
    expect(state.text()).toContain("You don't have access to OpenObserve in Acme yet");
    expect(state.text()).not.toContain("You don't have access to OpenObserve yet");
    expect(w.find(testId("slack-link-help-contact")).text()).toBe(
      "Ask #observability-help for access.",
    );
    expect(w.find(testId("slack-link-retry")).exists()).toBe(false);
  });

  it("403 without a help contact names the administrator", async () => {
    vi.mocked(slack.startLinkRequest).mockRejectedValue(refusal(403, { message: "" }));
    const w = await mountLink();
    expect(w.find(testId("slack-link-state-noAccess")).text()).toContain(
      "you have no account in its organizations",
    );
    expect(w.find(testId("slack-link-help-contact")).text()).toBe(
      "Ask your OpenObserve administrator for access.",
    );
  });

  it("AC-12.3 403 wrong Slack account offers Try again, which starts again", async () => {
    vi.mocked(slack.startLinkRequest).mockRejectedValueOnce(
      refusal(403, {
        message:
          "This link was sent to @dana in Acme, but this browser is signed in to Slack as another account",
        error_detail: "wrong_account",
      }),
    );
    const w = await mountLink();
    expect(w.find(testId("slack-link-state-wrongAccount")).text()).toContain(
      "This link was sent to @dana in Acme",
    );

    await w.find(testId("slack-link-retry")).trigger("click");
    await flushPromises();
    expect(slack.startLinkRequest).toHaveBeenCalledTimes(2);
    expect(leaveFor).toHaveBeenCalledWith(SIGN_IN_URL);
  });

  it.each([
    [429, "slack-link-state-rateLimited"],
    [500, "slack-link-state-failed"],
  ])("%i offers Try again", async (status, id) => {
    vi.mocked(slack.startLinkRequest).mockRejectedValue(refusal(status));
    const w = await mountLink();
    expect(w.find(testId(id)).exists()).toBe(true);
    expect(w.find(testId("slack-link-retry")).exists()).toBe(true);
  });
});
