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

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantDecisionNotice from "./AssistantDecisionNotice.vue";
import { fakeRuns, runRow } from "./runsTestKit";

const { fake } = vi.hoisted(() => ({ fake: { current: null as any, runs: null as any } }));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantRuns: () => fake.runs.runs,
}));

const NOW = 5_000_000;

const decision = (sid: string, over = {}) =>
  runRow(sid, {
    group: "needs_you",
    status: "needsApproval",
    request: `card-${sid}`,
    expiresAt: NOW + 300_000,
    ...over,
  });

function setup(decisions = [decision("a")]) {
  fake.current = fakeAssistant();
  fake.runs = fakeRuns();
  fake.runs.decisions.value = decisions;
  const wrapper = mount(AssistantDecisionNotice, {
    attachTo: document.body,
    global: { plugins: [fakeRouter(), fakeVuex()] },
  });
  return { wrapper, store: fake.current.store, runs: fake.runs };
}

const notice = () => document.querySelector<HTMLElement>('[data-test="assistant-decision-notice"]');
const press = (id: string) =>
  document.querySelector<HTMLElement>(`[data-test="assistant-decision-notice-${id}"]`)?.click();

describe("AssistantDecisionNotice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("names the region, has no live role, and never takes focus", async () => {
    setup();
    await nextTick();
    const region = notice();
    expect(region?.tagName).toBe("SECTION");
    expect(region?.getAttribute("aria-label")).toBe("O2 Assistant notice");
    expect(region?.getAttribute("aria-live")).toBeNull();
    expect(region?.textContent).toContain("O2 Assistant needs your decision");
    expect(region?.textContent).toContain("Chat a");
    expect(region?.textContent).toContain("Expires in 5:00");
    expect(document.activeElement).toBe(document.body);
  });

  it("stays away when there is no decision", async () => {
    setup([]);
    await nextTick();
    expect(notice()).toBeNull();
  });

  it("gives way to the Runs button while a visible container shows another chat", async () => {
    const { store } = setup();
    store.state.shell.placement = { kind: "sidebar" };
    store.state.shell.activeSid = "other";
    await nextTick();
    expect(notice()).toBeNull();
  });

  it("replaces the line for a second request, and Review opens the list", async () => {
    const { runs } = setup([decision("a"), decision("b")]);
    await nextTick();
    expect(notice()?.textContent).toContain("2 chats need your decision");
    press("review");
    expect(runs.runs.requestOpen).toHaveBeenCalled();
    expect(runs.runs.open).not.toHaveBeenCalled();
  });

  it("Review opens the one chat on its card", async () => {
    const { runs } = setup();
    await nextTick();
    press("review");
    expect(runs.runs.open).toHaveBeenCalledWith(expect.objectContaining({ sid: "a" }), {
      focus: "card",
    });
  });

  it("Hide notice leaves the request pending and hands focus back", async () => {
    const { wrapper, runs } = setup();
    await nextTick();
    press("hide");
    await nextTick();
    expect(notice()).toBeNull();
    expect(wrapper.emitted("hidden")).toHaveLength(1);
    expect(runs.runs.decisions.value).toHaveLength(1);
  });

  it("comes back at each warning even when hidden, and speaks each once", async () => {
    const { wrapper } = setup([decision("a", { expiresAt: NOW + 90_000 })]);
    await nextTick();
    press("hide");
    await nextTick();
    await vi.advanceTimersByTimeAsync(30_000);
    await nextTick();
    expect(notice()?.textContent).toContain("Expires soon · 1:00");
    press("hide");
    await nextTick();
    expect(notice()).toBeNull();
    await vi.advanceTimersByTimeAsync(40_000);
    await nextTick();
    expect(notice()?.textContent).toContain("Expires soon · 0:20");
    await vi.advanceTimersByTimeAsync(10_000);
    const spoken = (wrapper.emitted("announce") ?? []).map(([text]) => String(text));
    expect(spoken.filter((text) => text.startsWith("Approval expires in"))).toEqual([
      "Approval expires in 60 seconds: Chat a. Review it from the O2 Assistant notice.",
      "Approval expires in 20 seconds: Chat a. Review it from the O2 Assistant notice.",
    ]);
  });

  it("says when no more time can be added", async () => {
    const { wrapper } = setup([decision("a", { expiresAt: NOW + 50_000, extendsLeft: 0 })]);
    await vi.advanceTimersByTimeAsync(3_000);
    const spoken = (wrapper.emitted("announce") ?? []).map(([text]) => String(text));
    expect(spoken.join()).toContain("No more time can be added. Review it from");
  });

  it("warns even while a visible container shows another chat", async () => {
    const { store } = setup([decision("a", { expiresAt: NOW + 70_000 })]);
    store.state.shell.placement = { kind: "sidebar" };
    store.state.shell.activeSid = "other";
    await nextTick();
    expect(notice()).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    await nextTick();
    expect(notice()?.textContent).toContain("Expires soon");
  });

  it("keeps background sentences 3 s apart and drops none", async () => {
    const { wrapper } = setup([decision("a"), decision("b")]);
    await nextTick();
    expect(wrapper.emitted("announce")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(wrapper.emitted("announce")).toHaveLength(2);
  });

  it("leaves the first request's sentence to the header's own light", async () => {
    fake.current = fakeAssistant();
    fake.runs = fakeRuns();
    const { store } = fake.current;
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      thread: "new",
    });
    store.state.sessions[sid].pendingApproval = { id: "c1" };
    fake.runs.decisions.value = [decision(sid)];
    const wrapper = mount(AssistantDecisionNotice, {
      attachTo: document.body,
      global: { plugins: [fakeRouter(), fakeVuex()] },
    });
    await flushPromises();
    expect(wrapper.emitted("announce")).toBeUndefined();
  });

  it("waits for a modal dialog to close", async () => {
    setup();
    const dialog = document.createElement("div");
    dialog.setAttribute("data-o2-dialog", "");
    dialog.setAttribute("data-state", "open");
    document.body.appendChild(dialog);
    await vi.advanceTimersByTimeAsync(1_000);
    await nextTick();
    expect(notice()).toBeNull();
    dialog.remove();
    await vi.advanceTimersByTimeAsync(1_000);
    await nextTick();
    expect(notice()).not.toBeNull();
  });

  it("leaves when the request does", async () => {
    const { runs } = setup();
    await nextTick();
    runs.decisions.value = [];
    await nextTick();
    expect(notice()).toBeNull();
  });
});
