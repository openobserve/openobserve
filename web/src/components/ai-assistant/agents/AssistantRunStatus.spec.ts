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

import AssistantRunStatus from "./AssistantRunStatus.vue";

const meta = (over: Partial<TurnMeta> = {}): TurnMeta =>
  ({ ownedByThisTab: true, startedAt: 0, lastFrameAt: 0, ...over }) as TurnMeta;

const status = (w: ReturnType<typeof mount>) => w.find('[data-test="assistant-run-status"]');

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("AssistantRunStatus", () => {
  it("renders nothing for an idle or a finished turn", () => {
    for (const turn of [{ state: "idle" }, { state: "done", saved: "server" }] as TurnState[]) {
      const w = mount(AssistantRunStatus, { props: { turn, meta: meta(), now: () => 0 } });
      expect(status(w).exists()).toBe(false);
    }
  });

  it("uses the shared status line of a running turn", () => {
    const w = mount(AssistantRunStatus, {
      props: { turn: { state: "connecting" } as TurnState, meta: meta(), now: () => 100 },
    });
    expect(status(w).attributes("data-state")).toBe("connecting");
    expect(status(w).text()).not.toBe("");
  });

  it("names the other tab when this one does not own the turn", () => {
    const w = mount(AssistantRunStatus, {
      props: {
        turn: { state: "connecting" } as TurnState,
        meta: meta({ ownedByThisTab: false }),
        now: () => 0,
      },
    });
    expect(status(w).text()).toContain("another tab");
  });

  it("stops ticking when it unmounts", () => {
    const w = mount(AssistantRunStatus, {
      props: { turn: { state: "connecting" } as TurnState, meta: meta(), now: () => 0 },
    });
    expect(vi.getTimerCount()).toBe(1);
    w.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
