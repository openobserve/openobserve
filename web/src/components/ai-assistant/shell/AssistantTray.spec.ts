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

import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

import type { AssistantSession } from "@/composables/assistant";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantTray, { trayState } from "./AssistantTray.vue";

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
}));

const ORIGIN = { entryKind: "header_button", objectKind: "none", container: "window" } as const;

function setup(count: number, visibleBars = 4) {
  const { store } = fake.current;
  const order = Array.from({ length: count }, () =>
    store.createSession({ origin: ORIGIN, detached: true }),
  );
  const wrapper = mount(AssistantTray, {
    props: { order, visibleBars },
    global: { plugins: [fakeRouter(), fakeVuex()] },
    attachTo: document.body,
  });
  return { wrapper, order };
}

const restores = (wrapper: ReturnType<typeof setup>["wrapper"]) =>
  wrapper.findAll('[data-test="assistant-tray-restore"]');

beforeEach(() => {
  fake.current = fakeAssistant();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AssistantTray", () => {
  it("is gone when empty", () => {
    const { wrapper } = setup(0);
    expect(wrapper.find('[data-test="assistant-tray"]').exists()).toBe(false);
  });

  it("is a named region whose bars restore through the shared button", async () => {
    const { wrapper, order } = setup(2);
    expect(wrapper.get('[data-test="assistant-tray"]').attributes("aria-label")).toBe(
      "Minimised chats",
    );
    const first = restores(wrapper)[0];
    expect(first.attributes("data-o2-btn")).toBeDefined();
    expect(first.attributes("aria-label")).toContain("Restore");
    await first.trigger("click");
    expect(wrapper.emitted("restore")).toEqual([[order[0]]]);
  });

  it("closes from the bar's ×", async () => {
    const { wrapper, order } = setup(1);
    await wrapper.get('[data-test="assistant-tray-close"]').trigger("click");
    expect(wrapper.emitted("close")).toEqual([[order[0]]]);
  });

  it("is one tab stop: arrows rove and wrap, Delete closes the bar in focus", async () => {
    const { wrapper, order } = setup(3);
    const tabIndexes = () => restores(wrapper).map((b) => b.attributes("tabindex"));
    expect(tabIndexes()).toEqual(["0", "-1", "-1"]);
    await restores(wrapper)[0].trigger("keydown", { key: "ArrowLeft" });
    expect(tabIndexes()).toEqual(["-1", "-1", "0"]);
    expect(document.activeElement).toBe(restores(wrapper)[2].element);
    await restores(wrapper)[2].trigger("keydown", { key: "ArrowRight" });
    expect(tabIndexes()).toEqual(["0", "-1", "-1"]);
    await restores(wrapper)[0].trigger("keydown", { key: "Delete" });
    expect(wrapper.emitted("close")).toEqual([[order[0]]]);
  });

  it("writes Failed after the title instead of a mark", async () => {
    const { wrapper, order } = setup(1);
    fake.current.store.state.sessions[order[0]].turn = { state: "failed" } as never;
    await nextTick();
    expect(wrapper.get('[data-test="assistant-tray-failed"]').text()).toBe("Failed");
    expect(wrapper.find('[data-test="assistant-status-dot"]').exists()).toBe(false);
    expect(restores(wrapper)[0].attributes("aria-label")).toContain("Failed");
  });

  it("shows two bars at 1024–1279 and keeps the rest behind +{count}", () => {
    const { wrapper } = setup(4, 2);
    expect(restores(wrapper)).toHaveLength(2);
    expect(wrapper.get('[data-test="assistant-tray-more"]').text()).toBe("+2");
  });
});

describe("trayState", () => {
  const session = (over: Partial<AssistantSession>) =>
    ({ unread: false, turn: { state: "idle" }, ...over }) as AssistantSession;

  it("ranks a decision first; only a waiting or answering chat keeps a mark", () => {
    expect(trayState(undefined)).toBe("idle");
    expect(trayState(session({}))).toBe("idle");
    expect(trayState(session({ pendingApproval: {} as never, unread: true }))).toBe("needsYou");
    expect(trayState(session({ turn: { state: "failed" } as never }))).toBe("failed");
    expect(trayState(session({ unread: true, turn: { state: "done" } as never }))).toBe("idle");
    expect(trayState(session({ turn: { state: "streaming" } as never }))).toBe("working");
  });
});
