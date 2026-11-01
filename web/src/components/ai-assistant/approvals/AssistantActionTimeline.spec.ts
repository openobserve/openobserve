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

import type { ActionLedgerEntry } from "@/composables/assistant/pure";

import AssistantActionTimeline from "./AssistantActionTimeline.vue";
import { assistantApprovalsHostKey } from "./approvals.types";

const entry = (over: Partial<ActionLedgerEntry> = {}): ActionLedgerEntry => ({
  id: "c9:0",
  approvalId: "c9",
  turnId: "t1",
  tool: "o2_delete",
  op: "delete",
  resource: { type: "alert", id: "a1", name: "checkout-latency-old" },
  status: "done",
  undoable: false,
  at: 1_760_000_000_000,
  ...over,
});

function mountTimeline(
  entries: ActionLedgerEntry[],
  undo = vi.fn(async () => ({ ok: true }) as const),
) {
  const host = {
    pendingId: () => null,
    currentUser: () => "",
    sendAgain: vi.fn(),
    askAgain: vi.fn(),
    stop: vi.fn(),
    undo,
  };
  const wrapper = mount(AssistantActionTimeline, {
    props: { entries, sid: "s1" },
    global: { provide: { [assistantApprovalsHostKey as symbol]: host } },
  });
  return { wrapper, undo };
}

async function expand(wrapper: ReturnType<typeof mountTimeline>["wrapper"]): Promise<void> {
  await wrapper.get("button").trigger("click");
  await flushPromises();
}

describe("AssistantActionTimeline", () => {
  it("is collapsed to a count and lists each action with who approved it", async () => {
    const { wrapper } = mountTimeline([
      entry(),
      entry({ id: "c9:1", resource: { type: "alert", name: "b" } }),
    ]);
    expect(wrapper.get("button").text()).toContain("2 actions in this chat");
    await expand(wrapper);
    expect(wrapper.get('[data-test="assistant-action-entry-c9:0"]').text()).toMatch(
      /^Deleted alert checkout-latency-old · approved by you · /,
    );
  });

  it("says Undo is not available without the server's ledger, and offers no button", async () => {
    const { wrapper } = mountTimeline([entry()]);
    await expand(wrapper);
    expect(wrapper.find('[data-test="assistant-action-undo-c9:0"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-action-timeline-limits"]').text()).toBe(
      "Undo isn't available yet",
    );
  });

  it("undoes an entry the server can restore, and states the honest limit", async () => {
    const { wrapper, undo } = mountTimeline([entry({ undoable: true })]);
    await expand(wrapper);
    expect(wrapper.get('[data-test="assistant-action-timeline-limits"]').text()).toBe(
      "Undo restores the object. Notifications already sent and data already deleted stay as they are.",
    );
    await wrapper.get('[data-test="assistant-action-undo-c9:0"]').trigger("click");
    await flushPromises();
    expect(undo).toHaveBeenCalledWith("s1", "c9:0");
  });

  it("posts Undo through the host, keeps the button while it runs and says when it did not work", async () => {
    const { wrapper, undo } = mountTimeline([entry({ undoable: true })]);
    await expand(wrapper);
    await wrapper.get('[data-test="assistant-action-undo-c9:0"]').trigger("click");
    expect(undo).toHaveBeenCalledWith("s1", "c9:0");
    await wrapper.setProps({ entries: [entry({ undoable: true, undoing: true })] });
    const button = wrapper.get('[data-test="assistant-action-undo-c9:0"]');
    expect(button.text()).toBe("Undoing…");
    expect(button.attributes("aria-disabled")).toBe("true");
    await wrapper.setProps({ entries: [entry({ undoable: true, undoFailed: true })] });
    expect(wrapper.get('[data-test="assistant-action-entry-c9:0"]').text()).toContain(
      "Undo didn't work.",
    );
  });

  it("lists a change made without a review step, tagged, with no Undo", async () => {
    const wrapper = mount(AssistantActionTimeline, {
      props: {
        entries: [],
        unreviewed: [{ kind: "unreviewed", resourceType: "alert", count: 2 }],
        sid: "s1",
      },
    });
    expect(wrapper.get("button").text()).toContain("1 action in this chat");
    await expand(wrapper);
    const row = wrapper.get('[data-test="assistant-action-entry-unreviewed"]');
    expect(row.text()).toContain("The assistant changed 2 alerts without a review step.");
    expect(row.text()).toContain("No review step");
    expect(row.find("button").exists()).toBe(false);
  });

  it("reads an undone entry as restored, an unconfirmed undo as such, and a failed one in the error colour", async () => {
    const { wrapper } = mountTimeline([
      entry({ status: "undone", undoable: true }),
      entry({ id: "c9:1", status: "failed", resource: { type: "alert", name: "b" } }),
      entry({ id: "c9:2", undoable: true, undoUnconfirmed: true }),
    ]);
    await expand(wrapper);
    expect(wrapper.get('[data-test="assistant-action-entry-c9:0"]').text()).toContain("Restored");
    const unconfirmed = wrapper.get('[data-test="assistant-action-entry-c9:2"]');
    expect(unconfirmed.text()).toContain("Undo was sent, but its result couldn't be confirmed.");
    expect(unconfirmed.find("button").exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-action-entry-c9:1"] span').classes()).toContain(
      "text-status-error-text",
    );
  });
});
