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
import { nextTick, ref } from "vue";

import { withCachedCards } from "@/composables/assistant/historyRecords";
import type { ApprovalOutcome, ApprovalResult } from "@/composables/assistant/pure";
import { approvalOf } from "@/composables/assistant/reducer";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { fakeEvidence } from "../__tests__/fakeEvidence";
import { fakeRouter } from "../__tests__/fakeAssistant";
import AssistantApprovalResult from "./AssistantApprovalResult.vue";
import { assistantApprovalsHostKey, type AssistantApprovalsHost } from "./approvals.types";

const BATCH = approvalOf({
  type: "confirmation_required",
  tool: "o2_delete",
  call_id: "c9",
  args: {
    items: [
      { resource_type: "alert", name: "checkout-latency-old", id: "a1" },
      { resource_type: "alert", name: "payments-5xx-staging", id: "a2" },
    ],
  },
});

const block: ContentBlock = { type: "approval", approval: BATCH };

const routes = [
  { path: "/alerts", name: "alertList", component: { render: () => null } },
  { path: "/alerts/:alert_id", name: "alertDetail", component: { render: () => null } },
];

function mountRecord(
  record: { outcome?: ApprovalOutcome; result?: ApprovalResult } | null,
  over: {
    blocks?: ContentBlock[];
    pending?: boolean;
    readonly?: boolean;
    live?: boolean;
    held?: { value: boolean };
  } = {},
) {
  const message: ChatMessage = {
    role: "assistant",
    content: raw(""),
    contentBlocks: over.blocks ?? [block],
  };
  const evidence = fakeEvidence({ messages: [message] });
  if (record)
    evidence.store.annotate(evidence.sid, "approval:c9", {
      ...(record.outcome && { approvalOutcome: record.outcome }),
      ...(record.result && { approvalResult: record.result }),
    });
  const host: AssistantApprovalsHost = {
    pendingId: () => ((over.held?.value ?? over.pending) ? "c9" : null),
    currentUser: () => "ada@example.com",
    sendAgain: vi.fn(),
    askAgain: vi.fn(),
    stop: vi.fn(),
    undo: vi.fn(async () => ({ ok: true }) as const),
  };
  const wrapper = mount(AssistantApprovalResult, {
    props: {
      block: over.blocks ? over.blocks[over.blocks.length - 1] : block,
      message,
      readonly: !!over.readonly,
      turn: evidence.turn({ outcome: over.live ? "live" : "done" }),
    },
    global: {
      plugins: [fakeRouter(routes)],
      provide: { ...evidence.provide, [assistantApprovalsHostKey as symbol]: host },
    },
  });
  return { wrapper, host, evidence };
}

const line = (wrapper: ReturnType<typeof mountRecord>["wrapper"]) =>
  wrapper.get('[data-test="assistant-approval-result-line"]').text();

describe("AssistantApprovalResult", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders nothing in the card's place while this tab still holds the card", () => {
    const { wrapper } = mountRecord(null, { pending: true });
    expect(wrapper.find('[data-test="assistant-approval-result"]').exists()).toBe(false);
  });

  it("is never green before /confirm answers", () => {
    const { wrapper } = mountRecord({ outcome: { state: "sending", at: Date.now() } });
    expect(line(wrapper)).toBe("Sending your decision…");
    expect(wrapper.find('[data-test^="assistant-approval-result-item-"]').exists()).toBe(false);
  });

  it("says what was deleted, item by item when part of it failed", () => {
    const done = mountRecord({
      outcome: { state: "done", at: 1 },
      result: {
        status: "done",
        items: [
          { id: "a1", type: "alert", name: "checkout-latency-old", status: "done" },
          { id: "a2", type: "alert", name: "payments-5xx-staging", status: "done" },
        ],
        resolvedBy: "ada@example.com",
        resolvedAt: 1,
      },
    });
    expect(line(done.wrapper)).toBe("Deleted 2 alerts");
    const partial = mountRecord({
      outcome: { state: "partial", at: 1 },
      result: {
        status: "partial",
        items: [
          { id: "a1", type: "alert", name: "checkout-latency-old", status: "failed", code: "403" },
          { id: "a2", type: "alert", name: "payments-5xx-staging", status: "done" },
        ],
        resolvedBy: "ada@example.com",
        resolvedAt: 1,
      },
    });
    expect(line(partial.wrapper)).toBe("Deleted 1 of 2 alerts · 1 failed");
    const failed = partial.wrapper.get('[data-test="assistant-approval-result-item-a1"]');
    expect(failed.get("span").text()).toBe("checkout-latency-old failed: no permission");
    expect(failed.classes()).toContain("text-status-error-text");
  });

  it.each([
    ["declined", "Declined · nothing was changed"],
    ["new_chat", "Declined because you started a new chat"],
    ["stopped", "Declined · you stopped the answer"],
    ["withdrawn", "This request is no longer valid. The conversation moved on."],
    ["expired", "No answer in time, so the assistant didn't run this action."],
  ] as const)("reads %s as its own record", (state, text) => {
    const { wrapper } = mountRecord({ outcome: { state, at: 1 } });
    expect(line(wrapper)).toBe(text);
  });

  it("quotes a reply in its record", () => {
    const { wrapper } = mountRecord({
      outcome: {
        state: "replied",
        at: 1,
        decision: { approved: false, reason: "reply", reply: "keep it" },
      },
    });
    expect(line(wrapper)).toBe("Declined · replied: “keep it”");
  });

  it("offers Send again after a lost decision, and Ask again after an expiry", async () => {
    const lost = mountRecord({ outcome: { state: "delivery_failed", at: 1 } });
    expect(line(lost.wrapper)).toBe(
      "Your decision didn't reach the assistant. Nothing was changed.",
    );
    await lost.wrapper.get('[data-test="assistant-approval-result-send-again"]').trigger("click");
    expect(lost.host.sendAgain).toHaveBeenCalledWith(lost.evidence.sid, "c9");
    const expired = mountRecord({ outcome: { state: "expired", at: 1 } });
    await expired.wrapper.get('[data-test="assistant-approval-result-ask-again"]').trigger("click");
    expect(expired.host.askAgain).toHaveBeenCalledWith(expired.evidence.sid, "c9");
  });

  it("names a refusal the server explained", () => {
    const { wrapper } = mountRecord({ outcome: { state: "failed", at: 1, httpStatus: 403 } });
    expect(line(wrapper)).toBe(
      "Nothing was changed. You don't have permission to make this change.",
    );
  });

  it("says a replayed card has no record here, and offers no action on a readonly page", () => {
    const { wrapper } = mountRecord(null, { readonly: true });
    expect(line(wrapper)).toBe("This browser has no record of how this request was answered.");
    expect(wrapper.find("button, a").exists()).toBe(false);
  });

  it("renders a redacted record that keeps only its kind, count and answer", () => {
    const redacted = { id: "c9", kind: "delete", total: 2 } as ContentBlock["approval"];
    const blocks: ContentBlock[] = [
      { type: "approval", approval: redacted },
      { type: "approval_result", resolved: { id: "c9", approved: true, at: 60_000 } },
    ];
    const { wrapper } = mountRecord(null, { readonly: true, blocks });
    expect(wrapper.text()).not.toContain("undefined");
    expect(wrapper.find("button, a").exists()).toBe(false);
  });

  it("never offers Ask again for a delete whose outcome is unknown; it points at the list", () => {
    const { wrapper } = mountRecord({ outcome: { state: "unconfirmed", at: 1 } });
    expect(line(wrapper)).toBe("Your decision was sent, but its result couldn't be confirmed.");
    expect(wrapper.find('[data-test="assistant-approval-result-ask-again"]').exists()).toBe(false);
    const check = wrapper.get('[data-test="assistant-approval-result-check-list"]');
    expect(check.attributes("href")).toContain("/alerts");
    expect(check.attributes("aria-label")).toBe("Check the list (opens in a new tab)");
  });

  it("names every object it changed, and links the ones that still exist", () => {
    const single = mountRecord({
      outcome: { state: "done", at: 1 },
      result: {
        status: "done",
        items: [{ id: "a1", type: "alert", name: "checkout-latency-old", status: "done" }],
        resolvedBy: "ada@example.com",
        resolvedAt: 1,
      },
    });
    const row = single.wrapper.get('[data-test="assistant-approval-result-item-a1"]');
    expect(row.text()).toBe("checkout-latency-old");
    expect(single.wrapper.find('[data-test="assistant-approval-result-open-a1"]').exists()).toBe(
      false,
    );
    const failed = mountRecord({
      outcome: { state: "failed", at: 1 },
      result: {
        status: "failed",
        items: [{ id: "a1", type: "alert", name: "checkout-latency-old", status: "failed" }],
        resolvedBy: "ada@example.com",
        resolvedAt: 1,
      },
    });
    expect(
      failed.wrapper.get('[data-test="assistant-approval-result-open-a1"]').attributes("href"),
    ).toContain("/alerts/a1");
  });

  it("keeps Undo in place while it runs, and says so inline when it failed", async () => {
    const { wrapper, evidence } = mountRecord({
      outcome: { state: "done", at: 1 },
      result: {
        status: "done",
        items: [
          {
            id: "a1",
            type: "alert",
            name: "checkout-latency-old",
            status: "done",
            undoable: true,
            ledgerId: "led-1",
          },
        ],
        resolvedBy: "ada@example.com",
        resolvedAt: 1,
      },
    });
    const session = evidence.store.state.sessions[evidence.sid];
    const entry = {
      id: "led-1",
      approvalId: "c9",
      turnId: "t1",
      tool: "o2_delete",
      op: "delete" as const,
      resource: { type: "alert", name: "checkout-latency-old" },
      status: "done" as const,
      undoable: true,
      at: 1,
    };
    session.ledger = [{ ...entry, undoing: true }];
    await nextTick();
    const undo = wrapper.get('[data-test="assistant-undo-led-1"]');
    expect(undo.text()).toBe("Undoing…");
    expect(undo.attributes("aria-disabled")).toBe("true");
    session.ledger = [{ ...entry, undoFailed: true }];
    await nextTick();
    expect(wrapper.get('[data-test="assistant-approval-result-item-a1"]').text()).toContain(
      "Undo didn't work.",
    );
  });

  it("stays quiet while its turn still runs elsewhere, and when the turn's own expired outcome says it", () => {
    expect(
      mountRecord(null, { live: true })
        .wrapper.find('[data-test="assistant-approval-result"]')
        .exists(),
    ).toBe(false);
    const withOutcome = mountRecord(null, {
      blocks: [block, { type: "turn_outcome", outcome: { kind: "expired" } }],
    });
    expect(withOutcome.wrapper.find('[data-test="assistant-approval-result"]').exists()).toBe(
      false,
    );
  });

  it("reads confirmation_resolved as decided in another tab", () => {
    const resolved: ContentBlock = {
      type: "approval_result",
      resolved: { id: "c9", approved: true, at: 1_760_000_000_000 },
    };
    const { wrapper } = mountRecord(null, { blocks: [block, resolved] });
    expect(line(wrapper)).toMatch(/^Approved in another tab · /);
  });

  it("reads an expired or withdrawn confirmation_resolved as that, never as a denial", () => {
    const ended = (flag: "expired" | "withdrawn") =>
      line(
        mountRecord(null, {
          blocks: [
            block,
            { type: "approval_result", resolved: { id: "c9", approved: false, [flag]: true } },
          ],
        }).wrapper,
      );
    expect(ended("expired")).toBe("No answer in time, so the assistant didn't run this action.");
    expect(ended("withdrawn")).toBe("This request is no longer valid. The conversation moved on.");
  });

  it("reads a replayed card's server approval row as this user's own decision", () => {
    const recorded = (status: "approved" | "denied" | "expired" | "withdrawn", at?: number) => {
      const approval = { ...BATCH, recorded: { status, ...(at && { at }) } };
      return mountRecord(null, { readonly: true, blocks: [{ type: "approval", approval }] });
    };
    expect(line(recorded("approved", 1_760_000_000_000).wrapper)).toMatch(/^Approved · /);
    expect(line(recorded("denied").wrapper)).toBe("Declined · nothing was changed");
    expect(line(recorded("expired").wrapper)).toBe(
      "No answer in time, so the assistant didn't run this action.",
    );
    expect(recorded("denied").wrapper.find("button, a").exists()).toBe(false);
    expect(line(recorded("withdrawn").wrapper)).toBe(
      "This request is no longer valid. The conversation moved on.",
    );
  });

  it("reads a card recovered from this browser's copy as approved without a made-up time, and with the server's time when it has one", () => {
    const recovered = (frames: unknown[]) => {
      const messages = withCachedCards(
        [{ role: "user", content: raw("clean up"), turnId: "t1" }],
        [
          { role: "user", content: raw("clean up"), turnId: "t1" },
          { role: "assistant", content: raw(""), contentBlocks: [block] },
        ],
        {},
        { active_turn: false, turns: [{ turn_id: "t1", user: null, frames, status: "completed" }] },
      );
      const blocks = messages.flatMap((m) => m.contentBlocks ?? []);
      return line(mountRecord(null, { readonly: true, blocks }).wrapper);
    };
    expect(recovered([{ type: "tool_result", call_id: "c9", tool: "o2_delete" }])).toBe("Approved");
    const at = Date.UTC(2026, 9, 29, 12, 30);
    const timed = recovered([{ type: "confirmation_resolved", id: "c9", approved: true, at }]);
    expect(timed).toMatch(/^Approved · /);
    expect(timed).not.toContain("1970");
  });

  it("shows the waiting line with Stop for a card another tab holds", async () => {
    const evidence = fakeEvidence();
    const host = {
      pendingId: () => null,
      currentUser: () => "",
      sendAgain: vi.fn(),
      askAgain: vi.fn(),
      stop: vi.fn(),
      undo: vi.fn(),
    };
    const wrapper = mount(AssistantApprovalResult, {
      props: { state: "waiting_elsewhere", sid: evidence.sid },
      global: {
        plugins: [fakeRouter()],
        provide: { ...evidence.provide, [assistantApprovalsHostKey as symbol]: host },
      },
    });
    await flushPromises();
    expect(line(wrapper)).toBe(
      "Waiting for your approval in the tab where you asked. Approve or deny it there, or stop this answer.",
    );
    await wrapper.get('[data-test="assistant-approval-result-stop"]').trigger("click");
    expect(wrapper.emitted("stop")).toHaveLength(1);
  });

  it("speaks the move from a held card to its record once, however often it renders", async () => {
    const held = ref(true);
    const first = mountRecord(null, { held });
    expect(first.wrapper.find('[data-test="assistant-approval-result"]').exists()).toBe(false);
    first.evidence.store.annotate(first.evidence.sid, "approval:c9", {
      approvalOutcome: { state: "declined", at: Date.now() },
    });
    held.value = false;
    await nextTick();
    expect(first.evidence.host.announce).toHaveBeenCalledTimes(1);
    expect(first.evidence.host.announce).toHaveBeenCalledWith(
      first.evidence.sid,
      "Declined · nothing was changed",
    );
    first.wrapper.unmount();
  });

  it("speaks a decision just made once, and history never", () => {
    const fresh = mountRecord({ outcome: { state: "declined", at: Date.now() } });
    expect(fresh.evidence.host.announce).toHaveBeenCalledWith(
      fresh.evidence.sid,
      "Declined · nothing was changed",
    );
    const old = mountRecord({ outcome: { state: "declined", at: 1 } });
    expect(old.evidence.host.announce).not.toHaveBeenCalled();
  });
});
