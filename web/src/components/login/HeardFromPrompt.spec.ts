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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import enLocale from "@/locales/languages/en-US.json";
import HeardFromPrompt from "./HeardFromPrompt.vue";
import { HEARD_FROM_PENDING_PREFIX, markHeardFromPending } from "./heardFrom";

const submitNewUserInfo = vi.fn();
vi.mock("@/services/billings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { submit_new_user_info: (...args: unknown[]) => submitNewUserInfo(...args) },
  });
});

const toastMock = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

const track = vi.fn();
vi.mock("@/services/product_analytics", () => ({
  default: { track: (...args: unknown[]) => track(...args) },
}));

const ORG = "test-org";
const EMAIL = "jane@acme.io";
const PENDING_KEY = `${HEARD_FROM_PENDING_PREFIX}${EMAIL}`;

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: enLocale } });

describe("HeardFromPrompt.vue", () => {
  let wrapper: VueWrapper | undefined;

  const mountIt = async () => {
    const store = createStore({ state: { userInfo: { email: EMAIL } } });
    wrapper = mount(HeardFromPrompt, {
      props: { org: ORG },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();
    return wrapper;
  };
  const byTest = (id: string) => wrapper!.find(`[data-test="${id}"]`);
  const choose = async (value: string) => {
    await byTest(`heard-from-prompt-option-${value}`).trigger("click");
    await flushPromises();
  };

  beforeEach(() => {
    submitNewUserInfo.mockReset();
    submitNewUserInfo.mockResolvedValue({ status: 200 });
    toastMock.mockClear();
    track.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("stays hidden unless the welcome dialog left the question pending", async () => {
    await mountIt();
    expect(byTest("heard-from-prompt").exists()).toBe(false);
  });

  it("offers the eight answers as one-click buttons, with Skip", async () => {
    markHeardFromPending(EMAIL);
    await mountIt();
    expect(byTest("heard-from-prompt").text()).toContain("Quick question: how did you find us?");
    // No dropdown, so nothing can show a stray value such as "false".
    expect(wrapper!.findComponent({ name: "OSelect" }).exists()).toBe(false);
    expect(byTest("heard-from-prompt-dismiss-btn").text()).toBe("Skip");
    const options = wrapper!.findAll('[data-test^="heard-from-prompt-option-"]').map((b) => ({
      value: b.attributes("data-test")!.replace("heard-from-prompt-option-", ""),
      label: b.text(),
    }));
    expect(options.map((o) => o.value)).toEqual([
      "search_engine",
      "friend_or_colleague",
      "ai_assistant",
      "github",
      "linkedin",
      "reddit",
      "youtube",
      "other",
    ]);
    expect(options.map((o) => o.label)).toEqual([
      "Search engine",
      "Friend or colleague",
      "AI assistant",
      "GitHub",
      "LinkedIn",
      "Reddit",
      "YouTube",
      "Other",
    ]);
  });

  it("sends the code with the stored pick, then thanks and stops asking", async () => {
    markHeardFromPending(EMAIL);
    localStorage.setItem(`o2.onboarding.firstSource.${ORG}`, "kubernetes");
    await mountIt();
    await choose("ai_assistant");
    expect(submitNewUserInfo).toHaveBeenCalledWith(ORG, {
      from: "ai_assistant",
      company: "",
      first_source: "kubernetes",
      skipped: false,
    });
    // The row goes away and a short toast says thanks: no leftover line under the success state.
    expect(byTest("heard-from-prompt").exists()).toBe(false);
    expect(toastMock).toHaveBeenCalledWith({
      message: "Thanks for telling us!",
      variant: "success",
    });
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(track).toHaveBeenCalledWith("onboarding_heard_from_answered", { from: "ai_assistant" });
  });

  it("offers only the listed codes, so nothing else can be sent", async () => {
    markHeardFromPending(EMAIL);
    await mountIt();
    expect(byTest("heard-from-prompt-option-google").exists()).toBe(false);
    expect(submitNewUserInfo).not.toHaveBeenCalled();
  });

  it("keeps the question and shows the error toast when the call fails", async () => {
    submitNewUserInfo.mockResolvedValue({ status: 500 });
    markHeardFromPending(EMAIL);
    await mountIt();
    await choose("github");
    expect(toastMock).toHaveBeenCalledWith({ message: "Something went wrong", variant: "error" });
    expect(localStorage.getItem(PENDING_KEY)).toBe("true");
    expect(byTest("heard-from-prompt-option-github").exists()).toBe(true);
  });

  it("dismisses without a call and never asks again", async () => {
    markHeardFromPending(EMAIL);
    await mountIt();
    await byTest("heard-from-prompt-dismiss-btn").trigger("click");
    await flushPromises();
    expect(byTest("heard-from-prompt").exists()).toBe(false);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(submitNewUserInfo).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("onboarding_heard_from_dismissed");
  });
});
