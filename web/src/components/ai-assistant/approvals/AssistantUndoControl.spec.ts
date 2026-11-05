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
import { describe, expect, it, vi } from "vitest";

import type { ActionLedgerEntry, ActionResult } from "@/composables/assistant/pure";

import { fakeEvidence } from "../__tests__/fakeEvidence";
import AssistantUndoControl from "./AssistantUndoControl.vue";
import { assistantApprovalsHostKey } from "./approvals.types";

const entry = (over: Partial<ActionLedgerEntry> = {}): ActionLedgerEntry => ({
  id: "led-1",
  approvalId: "c9",
  turnId: "t1",
  tool: "o2_delete",
  op: "delete",
  resource: { type: "alert", name: "checkout-latency-old" },
  status: "done",
  undoable: true,
  at: 1,
  ...over,
});

function mountControl(undo: (wrapper: ReturnType<typeof mount>) => Promise<ActionResult>) {
  const evidence = fakeEvidence();
  const host = {
    pendingId: () => null,
    currentUser: () => "",
    sendAgain: vi.fn(),
    askAgain: vi.fn(),
    stop: vi.fn(),
    undo: vi.fn(() => undo(wrapper)),
  };
  const wrapper = mount(AssistantUndoControl, {
    props: { entry: entry(), sid: evidence.sid, testId: "assistant-undo" },
    attachTo: document.body,
    global: {
      provide: { ...evidence.provide, [assistantApprovalsHostKey as symbol]: host },
    },
  });
  return { wrapper, evidence, host };
}

describe("AssistantUndoControl", () => {
  it("says the object came back and moves focus to Restored where Undo was", async () => {
    const { wrapper, evidence, host } = mountControl(async (w) => {
      await w.setProps({ entry: entry({ status: "undone" }) });
      return { ok: true };
    });
    await wrapper.get('[data-test="assistant-undo-led-1"]').trigger("click");
    await flushPromises();
    expect(host.undo).toHaveBeenCalledWith(evidence.sid, "led-1");
    const restored = wrapper.get('[data-test="assistant-undo-restored-led-1"]');
    expect(document.activeElement).toBe(restored.element);
    expect(evidence.host.announce).toHaveBeenCalledWith(
      evidence.sid,
      "Undone · checkout-latency-old restored",
    );
    wrapper.unmount();
  });

  it("says when an undo did not work, and keeps Undo", async () => {
    const { wrapper, evidence } = mountControl(async (w) => {
      await w.setProps({ entry: entry({ undoFailed: true }) });
      return { ok: false, reason: "failed" };
    });
    await wrapper.get('[data-test="assistant-undo-led-1"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Undo didn't work.");
    expect(evidence.host.announce).toHaveBeenCalledWith(evidence.sid, "Undo didn't work.");
    expect(wrapper.find('[data-test="assistant-undo-led-1"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
