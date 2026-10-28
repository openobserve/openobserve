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

  // the start record that marks the question can land after first data put the prompt on screen
  it("asks once the question is marked pending after it mounted", async () => {
    await mountIt();
    expect(byTest("heard-from-prompt").exists()).toBe(false);

    markHeardFromPending(EMAIL);
    await flushPromises();

    expect(byTest("heard-from-prompt").exists()).toBe(true);
  });

  it("sends once when a second prompt is clicked while the first answer is on its way", async () => {
    let finish!: (res: { status: number }) => void;
    submitNewUserInfo.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    markHeardFromPending(EMAIL);
    const first = await mountIt();
    const second = await mountIt();

    await first.find('[data-test="heard-from-prompt-option-github"]').trigger("click");
    await second.find('[data-test="heard-from-prompt-option-reddit"]').trigger("click");
    finish({ status: 200 });
    await flushPromises();

    expect(submitNewUserInfo).toHaveBeenCalledTimes(1);
    first.unmount();
  });

  it("settles the user who answered when they log out before the answer lands", async () => {
    let finish!: (res: { status: number }) => void;
    submitNewUserInfo.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    markHeardFromPending(EMAIL);
    markHeardFromPending(undefined);
    const store = createStore({ state: { userInfo: { email: EMAIL } as { email?: string } } });
    const mountOn = () =>
      mount(HeardFromPrompt, { props: { org: ORG }, global: { plugins: [i18n, store] } });
    const first = mountOn();
    await flushPromises();
    await first.find('[data-test="heard-from-prompt-option-github"]').trigger("click");
    // Logout unmounts the page and clears the user before the reply arrives.
    first.unmount();
    store.state.userInfo = {};
    finish({ status: 200 });
    await flushPromises();

    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(localStorage.getItem(`${HEARD_FROM_PENDING_PREFIX}anonymous`)).toBe("true");
    // The user's own send is over, so asked again later they can answer.
    store.state.userInfo = { email: EMAIL };
    markHeardFromPending(EMAIL);
    wrapper = mountOn();
    await flushPromises();
    await byTest("heard-from-prompt-option-reddit").trigger("click");
    await flushPromises();
    expect(submitNewUserInfo).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["answers", (w: VueWrapper) => w.find('[data-test="heard-from-prompt-option-github"]')],
    ["skips", (w: VueWrapper) => w.find('[data-test="heard-from-prompt-dismiss-btn"]')],
  ])("hides every other prompt on the page once one %s, so none can send again", async (_, btn) => {
    markHeardFromPending(EMAIL);
    const first = await mountIt();
    const second = await mountIt();
    await btn(first).trigger("click");
    await flushPromises();
    expect(second.find('[data-test="heard-from-prompt"]').exists()).toBe(false);
    expect(submitNewUserInfo.mock.calls.length).toBeLessThanOrEqual(1);
    first.unmount();
  });
});
