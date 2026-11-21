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
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { fakeVuex } from "../__tests__/fakeAssistant";
import { historyRow, historyStubs } from "../__tests__/historyStubs";
import { fakeRuns, runRow } from "../runs/runsTestKit";
import AssistantTitleMenu from "./AssistantTitleMenu.vue";
import { titleMenuRows, type TitleMenuInput } from "./titleMenu";

const { fake } = vi.hoisted(() => ({ fake: { history: null as any, runs: null as any } }));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => ({ state: { sessions: {} } }),
  useAssistantHistory: () => fake.history,
  useAssistantRuns: () => fake.runs.runs,
}));

const input = (over: Partial<TitleMenuInput> = {}): TitleMenuInput => ({
  runs: [],
  history: [],
  drafts: [],
  turnOf: () => undefined,
  current: null,
  ...over,
});

describe("titleMenuRows", () => {
  it("orders waiting, answering, failed, expired, drafts, then recent", () => {
    const rows = titleMenuRows(
      input({
        runs: [runRow("answer"), runRow("wait", { group: "needs_you", expiresAt: 9 })],
        drafts: [historyRow({ sid: "draft" })],
        history: [
          historyRow({ sid: "recent" }),
          historyRow({ sid: "expired" }),
          historyRow({ sid: "failed" }),
        ],
        turnOf: (sid) =>
          sid === "failed"
            ? { state: "failed", error: { code: "provider_error" } }
            : sid === "expired"
              ? { state: "failed", error: { code: "approval_expired" } }
              : undefined,
      }),
    );
    expect(rows.map((row) => [row.sid, row.status])).toEqual([
      ["wait", "needs_you"],
      ["answer", "answering"],
      ["failed", "failed"],
      ["expired", "expired"],
      ["draft", "draft"],
      ["recent", null],
    ]);
    expect(rows[0].expiresAt).toBe(9);
  });

  it("carries when each chat last changed, so a row with no status word shows its time (I7)", () => {
    const [row] = titleMenuRows(input({ history: [historyRow({ sid: "recent", updatedAt: 42 })] }));
    expect(row.updatedAt).toBe(42);
  });

  it("never lists the chat in view, nor a finished run as live", () => {
    const rows = titleMenuRows(
      input({
        runs: [runRow("mine"), runRow("done", { group: "ready", status: "ready" })],
        history: [historyRow({ sid: "done" })],
        current: "mine",
      }),
    );
    expect(rows.map((row) => [row.sid, row.status])).toEqual([["done", null]]);
  });

  it("reads a chat another tab saw fail as Failed", () => {
    const rows = titleMenuRows(
      input({
        runs: [runRow("x", { group: "failed", status: "failed" })],
        history: [historyRow({ sid: "x" })],
      }),
    );
    expect(rows[0].status).toBe("failed");
  });

  it("gives another org's chat its org, so the row names it and stays put", () => {
    const [row] = titleMenuRows(
      input({ runs: [runRow("x", { group: "needs_you", otherOrg: true, org: "payments" })] }),
    );
    expect(row.org).toBe("payments");
  });
});

describe("AssistantTitleMenu", () => {
  const mountMenu = (status: "ready" | "error", runs = fakeRuns()) => {
    fake.runs = runs;
    fake.history = {
      rows: ref([]),
      drafts: ref([]),
      listState: ref({ status }),
      retry: vi.fn(),
      ensureLoaded: vi.fn(),
    };
    return mount(AssistantTitleMenu, {
      props: { sid: null },
      global: { plugins: [fakeVuex()], stubs: historyStubs },
    });
  };

  it("says a failed list as one unframed error row whose Retry reloads it", async () => {
    const wrapper = mountMenu("error");
    const row = wrapper.get('[data-test="assistant-title-menu-error-row"]');
    expect(row.attributes("data-tone")).toBe("failed");
    expect(row.text()).toContain("Couldn't load");
    expect(wrapper.html()).not.toContain("bg-banner");
    const retry = wrapper.get('[data-test="assistant-title-menu-error-row-retry"]');
    expect(retry.attributes("aria-label")).toBe("Retry");
    await retry.trigger("click");
    expect(fake.history.retry).toHaveBeenCalledTimes(1);
  });

  it("keeps another org's chat disabled, naming its org (D4)", () => {
    const runs = fakeRuns([runRow("x", { group: "needs_you", otherOrg: true, org: "payments" })]);
    const wrapper = mountMenu("ready", runs);
    const row = wrapper.get('[data-test="assistant-title-menu-row"]');
    expect(row.attributes("disabled")).toBeDefined();
    expect(row.get('[data-test="assistant-title-menu-row-org"]').text()).toBe("payments");
    expect(wrapper.find('[data-test="assistant-title-menu-error-row"]').exists()).toBe(false);
  });
});
