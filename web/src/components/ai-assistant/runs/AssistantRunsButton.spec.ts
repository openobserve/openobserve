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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

import OPopover from "@/lib/overlay/Popover/OPopover.vue";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantRunsButton from "./AssistantRunsButton.vue";
import { fakeRuns, runRow } from "./runsTestKit";

const { fake, md } = vi.hoisted(() => ({
  fake: { current: null as any, runs: null as any },
  md: { value: true },
}));

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({
      lgUp: computed(() => md.value),
      mdUp: computed(() => md.value),
      isMobile: computed(() => !md.value),
      isTablet: computed(() => false),
      isDesktop: computed(() => md.value),
    }),
  };
});
vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantRuns: () => fake.runs.runs,
}));

// An open popover closes the previous one, so each spec's wrapper is unmounted, never wiped from the DOM.
const mounted: { unmount(): void }[] = [];

function mountButton() {
  const wrapper = mount(AssistantRunsButton, {
    attachTo: document.body,
    global: { plugins: [fakeRouter(), fakeVuex()] },
  });
  mounted.push(wrapper);
  return wrapper;
}

function setup(rows = [runRow("a"), runRow("b", { group: "needs_you", status: "needsApproval" })]) {
  fake.current = fakeAssistant();
  fake.runs = fakeRuns(rows);
  const wrapper = mountButton();
  return { wrapper, store: fake.current.store, runs: fake.runs };
}

const button = (wrapper: ReturnType<typeof setup>["wrapper"]) =>
  wrapper.find('[data-test="assistant-runs-button"]');

describe("AssistantRunsButton", () => {
  beforeEach(() => {
    md.value = true;
  });

  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  });

  it("stays away while no other chat is listed", () => {
    const { wrapper } = setup([]);
    expect(button(wrapper).exists()).toBe(false);
  });

  it("starts its name with the number it shows, then counts per signal (WCAG 2.5.3, PO B53)", () => {
    const { wrapper } = setup();
    const target = button(wrapper);
    expect(target.attributes("aria-label")).toBe("2 other chats: 1 answering · 1 needs you");
    expect(target.attributes("data-state")).toBe("attention");
    expect(target.text()).toContain("2");
  });

  it("does not count the chat its own container shows", async () => {
    const { wrapper, store } = setup();
    store.state.shell.activeSid = "a";
    await nextTick();
    expect(button(wrapper).attributes("aria-label")).toBe("1 other chat: 1 needs you");
    store.state.shell.activeSid = null;
    await nextTick();
    expect(button(wrapper).attributes("aria-expanded")).toBe("false");
  });

  it("takes a window's chat as its own, which the store's active chat is not", async () => {
    const { wrapper, store } = setup();
    store.state.shell.activeSid = "b";
    await wrapper.setProps({ sid: "a" });
    expect(button(wrapper).attributes("aria-label")).toBe("1 other chat: 1 needs you");
  });

  it("opens the list and reports it expanded", async () => {
    const { wrapper } = setup();
    await button(wrapper).trigger("click");
    await flushPromises();
    expect(button(wrapper).attributes("aria-expanded")).toBe("true");
    expect(document.querySelector('[data-test="assistant-runs-menu"]')).not.toBeNull();
  });

  it("closes on a second press, though the popover already closed on the pointer going down", async () => {
    const { wrapper } = setup();
    await button(wrapper).trigger("click");
    await flushPromises();
    await button(wrapper).trigger("pointerdown");
    wrapper.findComponent(OPopover).vm.$emit("update:open", false);
    await flushPromises();
    await button(wrapper).trigger("click");
    await flushPromises();
    expect(button(wrapper).attributes("aria-expanded")).toBe("false");
  });

  it("opens on a request from elsewhere, even with nothing else to show", async () => {
    const { wrapper, runs } = setup([]);
    await runs.runs.requestOpen();
    await flushPromises();
    expect(runs.runs.takeOpenRequest).toHaveBeenCalled();
    expect(button(wrapper).attributes("aria-expanded")).toBe("true");
  });

  it("takes a request made before it mounted", async () => {
    fake.current = fakeAssistant();
    fake.runs = fakeRuns();
    fake.runs.runs.openRequested.value = true;
    const wrapper = mountButton();
    await flushPromises();
    expect(button(wrapper).attributes("aria-expanded")).toBe("true");
  });

  it("uses a sheet below md", async () => {
    md.value = false;
    const { wrapper } = setup();
    await button(wrapper).trigger("click");
    await flushPromises();
    expect(document.querySelector('[data-test="assistant-runs-sheet-back"]')).not.toBeNull();
  });

  it("says once that a slot freed while the refusal shows", async () => {
    const { wrapper, store, runs } = setup();
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      thread: "new",
    });
    store.state.shell.activeSid = sid;
    store.state.sessions[sid].turn = {
      state: "refused",
      error: { code: "run_limit_member", limit: 3 },
    };
    store.state.sessions[sid].turnMeta.turnId = "t1";
    runs.active.value = 3;
    await nextTick();
    runs.active.value = 2;
    await nextTick();
    const region = wrapper.find('[data-test="assistant-runs-status-region"]');
    expect(region.text()).toBe("A chat finished. You can send now.");
  });

  it("stays quiet when a chat ends with no refusal showing", async () => {
    const { wrapper, runs } = setup();
    runs.active.value = 3;
    await nextTick();
    runs.active.value = 2;
    await nextTick();
    expect(wrapper.find('[data-test="assistant-runs-status-region"]').text()).toBe("");
  });
});
