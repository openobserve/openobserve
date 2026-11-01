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
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantRunsMenu from "./AssistantRunsMenu.vue";
import { fakeRuns, runRow } from "./runsTestKit";

const { fake } = vi.hoisted(() => ({ fake: { current: null as any, runs: null as any } }));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantRuns: () => fake.runs.runs,
}));

const waiting = runRow("wait", {
  group: "needs_you",
  status: "needsApproval",
  request: "c1",
  expiresAt: Date.now() + 240_000,
});
const answering = runRow("run");
const done = runRow("done", { group: "ready", status: "ready" });

function setup(rows = [waiting, answering, done]) {
  fake.current = fakeAssistant();
  fake.runs = fakeRuns(rows);
  const wrapper = mount(AssistantRunsMenu, {
    attachTo: document.body,
    global: {
      plugins: [
        fakeRouter([
          { path: "/assistant/:chatId?", name: "assistant", component: { template: "<div />" } },
        ]),
        fakeVuex(),
      ],
    },
  });
  return { wrapper, store: fake.current.store, runs: fake.runs.runs, source: fake.runs };
}

const rowsOf = (wrapper: ReturnType<typeof setup>["wrapper"]) =>
  wrapper.findAll('[data-test="assistant-runs-row-open"]');

describe("AssistantRunsMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("states the cap and the summary, zero parts dropped", () => {
    const { wrapper, source } = setup();
    source.active.value = 2;
    return wrapper.vm.$nextTick().then(() => {
      expect(wrapper.get('[data-test="assistant-runs-capacity"]').text()).toBe(
        "2 of 3 running chats",
      );
      expect(wrapper.get('[data-test="assistant-runs-summary"]').text()).toBe(
        "1 needs you · 1 answering",
      );
    });
  });

  it("names each row, with the time left on a pending card", () => {
    const { wrapper } = setup();
    const [first, second] = rowsOf(wrapper);
    expect(first.attributes("aria-label")).toBe(
      "Chat wait, O2 Assistant, Needs your approval, 4 minutes left",
    );
    expect(second.attributes("aria-label")).toContain("Chat run, O2 Assistant, Answering");
  });

  it("offers Stop on an answering row and Review on a waiting one, with the title in their names", async () => {
    const { wrapper, runs } = setup();
    const stop = wrapper.get('[data-test="assistant-runs-row-stop"]');
    expect(stop.attributes("aria-label")).toBe("Stop Chat run");
    await stop.trigger("click");
    expect(runs.stop).toHaveBeenCalledWith(answering);
    const review = wrapper.get('[data-test="assistant-runs-row-review"]');
    expect(review.attributes("aria-label")).toBe("Review Chat wait");
    await review.trigger("click");
    expect(runs.open).toHaveBeenCalledWith(waiting, expect.objectContaining({ focus: "card" }));
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("opens a row on click and marks the chat on screen", async () => {
    const { wrapper, runs, store } = setup();
    store.state.shell.activeSid = "run";
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-sid="run"]').attributes("data-current")).toBe("");
    expect(wrapper.find('[data-sid="run"]').text()).toContain("This chat");
    await rowsOf(wrapper)[0].trigger("click");
    expect(runs.open).toHaveBeenCalledWith(waiting, expect.objectContaining({ focus: "composer" }));
  });

  it("moves through the rows with the arrow keys, Home and End, with one Tab stop", async () => {
    const { wrapper } = setup();
    const rows = rowsOf(wrapper);
    expect(rows.map((row) => row.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);
    rows[0].element.focus();
    await rows[0].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1].element);
    await rows[1].trigger("keydown", { key: "End" });
    expect(document.activeElement).toBe(rows[2].element);
    await rows[2].trigger("keydown", { key: "Home" });
    expect(document.activeElement).toBe(rows[0].element);
    await wrapper.vm.$nextTick();
    expect(rowsOf(wrapper).map((row) => row.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);
  });

  it("clears only a finished row with Delete", async () => {
    const { wrapper, runs } = setup();
    const rows = rowsOf(wrapper);
    await rows[0].trigger("keydown", { key: "Delete" });
    expect(runs.clear).not.toHaveBeenCalled();
    await rows[2].trigger("keydown", { key: "Delete" });
    expect(runs.clear).toHaveBeenCalledWith("done");
  });

  it("offers Clear finished only when a finished row is listed", async () => {
    const { wrapper, runs } = setup();
    await wrapper.get('[data-test="assistant-runs-clear-finished"]').trigger("click");
    expect(runs.clearFinished).toHaveBeenCalled();
    expect(
      setup([answering]).wrapper.find('[data-test="assistant-runs-clear-finished"]').exists(),
    ).toBe(false);
  });

  it("shows another org's chat with no way to open it in place (PO B51)", () => {
    const { wrapper } = setup([runRow("x", { otherOrg: true, org: "acme", title: null })]);
    const row = wrapper.get('[data-test="assistant-runs-row-other-org"]');
    expect(row.text()).toContain("A chat in acme");
    expect(row.text()).toContain("In acme");
    expect(wrapper.find('[data-test="assistant-runs-row-open"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-runs-row-menu"]').exists()).toBe(false);
  });

  it("moves to the full view from the row menu", async () => {
    const { wrapper, runs, store } = setup([answering]);
    const move = vi.spyOn(store, "moveTo");
    await (wrapper.vm as any).$.setupState.openFull(answering);
    await flushPromises();
    expect(runs.open).toHaveBeenCalledWith(answering);
    expect(move).toHaveBeenCalledWith({ kind: "full" });
  });
});
