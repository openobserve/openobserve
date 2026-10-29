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

import type { TurnMeta, TurnState } from "@/composables/assistant/pure";
import { raw } from "@/types/i18n";

import AssistantTurnStatus from "./AssistantTurnStatus.vue";

const meta = (over: Partial<TurnMeta> = {}): TurnMeta => ({
  turnId: "t1",
  serverTurnId: null,
  ownedByThisTab: true,
  startedAt: 0,
  firstByteAt: null,
  traceId: null,
  lastSeq: null,
  usage: null,
  contextUsed: null,
  lastFrameAt: 0,
  ...over,
});

function mountStatus(
  turn: TurnState,
  over: {
    meta?: Partial<TurnMeta>;
    now?: number;
    variant?: "block" | "line" | "card";
    owned?: boolean;
    trailShown?: boolean;
  } = {},
) {
  return mount(AssistantTurnStatus, {
    props: {
      turn,
      meta: meta(over.meta),
      variant: over.variant ?? "block",
      ownedByThisTab: over.owned ?? true,
      trailShown: over.trailShown ?? false,
      now: () => over.now ?? 1_000,
    },
  });
}

const text = (wrapper: ReturnType<typeof mountStatus>) =>
  wrapper.find('[data-test="assistant-turn-status-text"]').text();

describe("AssistantTurnStatus", () => {
  afterEach(() => vi.useRealTimers());

  it.each<[string, TurnState, string]>([
    ["queued", { state: "queued" }, "Sending…"],
    ["connecting", { state: "connecting" }, "Connecting…"],
    ["thinking", { state: "responding.thinking" }, "Thinking"],
    ["writing", { state: "responding.writing" }, "Writing the answer"],
    [
      "running_tool",
      { state: "running_tool", tool: "SearchSQL", target: "default", callId: "c1" },
      "Querying default",
    ],
    [
      "awaiting_approval",
      { state: "awaiting_approval", callId: "c1" },
      "Waiting for your approval",
    ],
    ["awaiting_consent", { state: "awaiting_consent" }, "Waiting for your decision on paid usage"],
    ["reconnecting", { state: "reconnecting", attempt: 1 }, "Reconnecting…"],
    ["stopping", { state: "stopping" }, "Stopping…"],
  ])("reads the %s row from turnStatusText only (`30` §3.1)", (_name, turn, line) => {
    const wrapper = mountStatus(turn);
    expect(text(wrapper)).toBe(line);
    expect(wrapper.attributes("aria-live")).toBe("off");
    expect(wrapper.attributes("data-state")).toBe(turn.state);
  });

  it("renders nothing for idle and every terminal (the outcome block owns those)", () => {
    for (const turn of [
      { state: "idle" },
      { state: "done", saved: "server" },
      { state: "stopped", steps: 0, partial: false },
    ] as TurnState[])
      expect(mountStatus(turn).find('[data-test="assistant-turn-status"]').exists()).toBe(false);
  });

  it("adds elapsed after 5 s and the stall line in the warning tone after 30 s (HT-01 AC 2-3)", () => {
    const tool: TurnState = {
      state: "running_tool",
      tool: "SearchSQL",
      target: "default",
      callId: "c1",
    };
    expect(text(mountStatus(tool, { now: 4_000, meta: { lastFrameAt: 4_000 } }))).toBe(
      "Querying default",
    );
    expect(text(mountStatus(tool, { now: 12_000, meta: { lastFrameAt: 12_000 } }))).toBe(
      "Querying default · 12 s",
    );
    const stalled = mountStatus(tool, { now: 31_000 });
    expect(stalled.find('[data-test="assistant-turn-status-stall"]').text()).toBe(
      "No response for 31 s",
    );
    expect(stalled.attributes("data-tone")).toBe("warning");
    expect(stalled.classes()).toContain("text-status-warning-text");
  });

  it("drops a bare Running {tool} beside the trail's row, unless the turn stalls", () => {
    const bare: TurnState = {
      state: "running_tool",
      tool: "o2_Custom",
      target: null,
      callId: "c1",
    };
    const quiet = mountStatus(bare, { trailShown: true, meta: { lastFrameAt: 1_000 } });
    expect(quiet.find('[data-test="assistant-turn-status"]').exists()).toBe(false);
    const stalled = mountStatus(bare, { trailShown: true, now: 31_000 });
    expect(stalled.find('[data-test="assistant-turn-status-stall"]').exists()).toBe(true);
    const named: TurnState = {
      state: "running_tool",
      tool: "SearchSQL",
      target: "default",
      callId: "c1",
    };
    expect(text(mountStatus(named, { trailShown: true, meta: { lastFrameAt: 1_000 } }))).toBe(
      "Querying default",
    );
  });

  it("pauses with no motion while the turn waits on the user (HT-01 AC 4)", () => {
    const wrapper = mountStatus({ state: "awaiting_approval", callId: "c1" }, { now: 60_000 });
    expect(wrapper.find('[data-test="assistant-turn-status-spinner"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-turn-status-glyph"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-turn-status-stall"]').exists()).toBe(false);
  });

  it("shows a static glyph instead of the dots under reduced motion (HT-01 AC 11)", () => {
    const match = vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList);
    const wrapper = mountStatus({ state: "responding.thinking" });
    expect(wrapper.find('[data-test="assistant-turn-status-spinner"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-turn-status-glyph"]').exists()).toBe(true);
    match.mockRestore();
  });

  it("says another tab answers when this tab does not own the turn", () => {
    expect(text(mountStatus({ state: "responding.writing" }, { owned: false }))).toBe(
      "Answering in another tab",
    );
  });

  it("leaves Stop to the composer in the block variant; line and card render it (`30` §3.2)", async () => {
    expect(
      mountStatus({ state: "connecting" })
        .find('[data-test="assistant-turn-status-stop"]')
        .exists(),
    ).toBe(false);
    const line = mountStatus({ state: "connecting" }, { variant: "line" });
    await line.get('[data-test="assistant-turn-status-stop"]').trigger("click");
    expect(line.emitted("stop")).toHaveLength(1);
    const card = mountStatus({ state: "stopping" }, { variant: "card" });
    expect(card.get('[data-test="assistant-turn-status-stop"]').attributes("aria-disabled")).toBe(
      "true",
    );
  });

  describe("clock", () => {
    beforeEach(() => vi.useFakeTimers());

    it("redraws elapsed once a second while live and keeps no timer once ended (PERF-07)", async () => {
      let now = 6_000;
      const wrapper = mount(AssistantTurnStatus, {
        props: {
          turn: { state: "responding.thinking" },
          meta: meta({ lastFrameAt: 6_000 }),
          variant: "block",
          ownedByThisTab: true,
          now: () => now,
        },
      });
      expect(text(wrapper)).toBe("Thinking · 6 s");
      now = 7_000;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(text(wrapper)).toBe("Thinking · 7 s");
      await wrapper.setProps({ turn: { state: "done", saved: "server" } });
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("host copy", () => {
    const mountCopy = (turn: TurnState, copy: "helper" | "rca", now: number, line?: string) =>
      mount(AssistantTurnStatus, {
        props: {
          turn,
          meta: meta({ startedAt: 0, lastFrameAt: now }),
          variant: "line",
          ownedByThisTab: true,
          copy,
          ...(line && { line: raw(line) }),
          now: () => now,
        },
      });
    const line = (wrapper: ReturnType<typeof mountCopy>) =>
      wrapper.get('[data-test="assistant-turn-status-text"]').text();

    it("words the helper's run in its own copy with whole seconds", () => {
      expect(line(mountCopy({ state: "connecting" } as TurnState, "helper", 500))).toBe("Sending…");
      expect(line(mountCopy({ state: "responding.writing" } as TurnState, "helper", 3_400))).toBe(
        "Generating… 3 s",
      );
    });

    it("words an analysis as starting, then analysing with its elapsed time", () => {
      expect(line(mountCopy({ state: "connecting" } as TurnState, "rca", 200))).toBe(
        "Starting analysis… 0 s",
      );
      expect(line(mountCopy({ state: "responding.writing" } as TurnState, "rca", 12_000))).toBe(
        "Analysing · 12 s",
      );
    });

    it("lets the host's own line win", () => {
      expect(
        line(
          mountCopy({ state: "responding.writing" } as TurnState, "rca", 1_000, "Reconnecting…"),
        ),
      ).toBe("Reconnecting…");
    });
  });

  it.each([
    { state: "connecting" },
    { state: "responding.thinking" },
    { state: "responding.writing" },
    { state: "running_tool", tool: "search_logs", target: "default" },
    { state: "reconnecting", attempt: 1 },
    { state: "stopping" },
    { state: "awaiting_consent" },
  ] as TurnState[])("words $state the same in the block, line and card variants", (turn) => {
    const looks = (["block", "line", "card"] as const).map((variant) => {
      const wrapper = mountStatus(turn, { variant, now: 40_000, meta: { lastFrameAt: 1_000 } });
      const root = wrapper.find('[data-test="assistant-turn-status"]');
      return {
        line: root.exists() ? root.get('[data-test="assistant-turn-status-text"]').text() : null,
        tone: root.attributes("data-tone") ?? null,
        glyph: root.find('[data-test="assistant-turn-status-glyph"]').exists()
          ? root.get('[data-test="assistant-turn-status-glyph"]').attributes("name")
          : null,
      };
    });
    expect(looks[1]).toEqual(looks[0]);
    expect(looks[2]).toEqual(looks[0]);
  });
});
