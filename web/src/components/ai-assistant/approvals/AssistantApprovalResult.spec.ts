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
import {
  assistantTranscriptHostKey,
  type ApprovalOutcome,
  type ApprovalResult,
} from "@/composables/assistant/pure";
import { approvalOf } from "@/composables/assistant/reducer";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import assistantSettings from "@/services/assistant_settings";
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
  { path: "/dashboards/view", name: "viewDashboard", component: { render: () => null } },
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
    gated?: boolean;
    focusComposer?: () => void;
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
    gated: () => over.gated === true,
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
      provide: {
        ...evidence.provide,
        [assistantApprovalsHostKey as symbol]: host,
        ...(over.focusComposer && {
          [assistantTranscriptHostKey as symbol]: { focusComposer: over.focusComposer },
        }),
      },
    },
    ...(over.focusComposer && { attachTo: document.body }),
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

  it("offers no Ask again on an expired card a gated server would only refuse (PO B96)", () => {
    const expired = { outcome: { state: "expired" as const, at: Date.now() } };
    const open = mountRecord(expired);
    expect(open.wrapper.text()).toContain("Ask again");
    const gated = mountRecord(expired, { gated: true });
    expect(gated.wrapper.text()).not.toContain("Ask again");
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
    ["declined", "Denied: delete 2 alerts"],
    ["new_chat", "Declined because you started a new chat"],
    ["stopped", "Declined · you stopped the answer"],
    ["withdrawn", "This request is no longer valid. The conversation moved on."],
    ["expired", "Request expired. Nothing was changed."],
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
    expect(line(wrapper)).toBe("Declined with a reply");
  });

  it("says the change moved to its editor when Edit in {editor} resolved the card (PO A9)", () => {
    const pause = approvalOf({
      type: "confirmation_required",
      tool: "EnableAlert",
      call_id: "c9",
      args: { alert_id: "a1", value: false },
    });
    const { wrapper } = mountRecord(
      { outcome: { state: "editing", at: 1, decision: { approved: false, reason: "edited" } } },
      { blocks: [{ type: "approval", approval: pause }] },
    );
    expect(line(wrapper)).toBe("Moved to Alerts");
    const batch = mountRecord({ outcome: { state: "editing", at: 1 } });
    expect(line(batch.wrapper)).toBe("Denied: delete 2 alerts");
  });

  it("offers Send again after a lost decision, and Ask again after an expiry", async () => {
    const lost = mountRecord({ outcome: { state: "delivery_failed", at: 1 } });
    expect(line(lost.wrapper)).toBe("Couldn't send your decision. The alert hasn't changed.");
    const row = lost.wrapper.get('[data-test="assistant-approval-result-error"]');
    expect(row.attributes("data-tone")).toBe("failed");
    expect(row.classes().join(" ")).not.toMatch(/bg-|border/);
    const again = row.get('[data-test="assistant-approval-result-send-again"]');
    expect(again.attributes("aria-label")).toBe("Retry");
    expect(again.attributes("data-size")).toBe("sm");
    await again.trigger("click");
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

  it("lets a single done item be the line, and lists what failed", () => {
    const single = mountRecord({
      outcome: { state: "done", at: 1 },
      result: {
        status: "done",
        items: [{ id: "a1", type: "alert", name: "checkout-latency-old", status: "done" }],
        resolvedBy: "ada@example.com",
        resolvedAt: 1,
      },
    });
    expect(single.wrapper.find('[data-test="assistant-approval-result-item-a1"]').exists()).toBe(
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
    expect(failed.wrapper.find('[data-test="assistant-approval-result-item-a1"]').exists()).toBe(
      true,
    );
  });

  it("draws no Undo on a record", () => {
    const { wrapper } = mountRecord({
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
    expect(wrapper.find('[data-test^="assistant-undo"]').exists()).toBe(false);
  });

  it("records an answered question by what was chosen, and an expired one in its own words", () => {
    const question = approvalOf({
      type: "confirmation_required",
      id: "c9",
      tool: "ask_user",
      kind: "question",
      message: "Which folder?",
    });
    const blocks: ContentBlock[] = [{ type: "approval", approval: question }];
    const answered = mountRecord(
      {
        outcome: {
          state: "answered",
          at: 1,
          decision: { approved: false, reason: "answer", answer: "p", answerLabel: "Payments" },
        },
      },
      { blocks },
    );
    expect(line(answered.wrapper)).toBe("Answered: Payments");
    const expired = mountRecord({ outcome: { state: "expired", at: 1 } }, { blocks });
    expect(line(expired.wrapper)).toBe("Question expired. Nothing was changed.");
  });

  it("reads the record of Finish in Alerts with Open, when the card has an object to open", () => {
    const pause = approvalOf({
      type: "confirmation_required",
      id: "c9",
      tool: "EnableAlert",
      targets: [{ type: "alert", id: "a1", name: "cart" }],
      args: { value: false },
    });
    const { wrapper } = mountRecord(
      { outcome: { state: "editing", at: 1 } },
      { blocks: [{ type: "approval", approval: pause }] },
    );
    expect(
      wrapper.get('[data-test="assistant-approval-result-open"]').attributes("href"),
    ).toContain("/alerts/a1");
  });

  it("names a denied create by its title, never by the tool id o2-ai puts in its target", () => {
    const create = approvalOf({
      type: "confirmation_required",
      id: "c9",
      tool: "CreateDashboard",
      kind: "create",
      targets: [{ type: "dashboard", name: "CreateDashboard" }],
      args: { org_id: "default", request_body: { title: "QA approval test" } },
    });
    const { wrapper } = mountRecord(
      { outcome: { state: "declined", at: 1 } },
      { blocks: [{ type: "approval", approval: create }] },
    );
    expect(line(wrapper)).toBe("Denied: create dashboard QA approval test");
  });

  it("opens what an approved create made, by the id its result carries", () => {
    const create = approvalOf({
      type: "confirmation_required",
      id: "c9",
      tool: "CreateAlert",
      kind: "create",
      targets: [{ type: "alert", name: "qa_error_burst" }],
      args: { request_body: { name: "qa_error_burst" } },
    });
    const blocks: ContentBlock[] = [{ type: "approval", approval: create }];
    const made = (item: Record<string, unknown>) =>
      mountRecord(
        {
          outcome: { state: "done", at: 1 },
          result: {
            status: "done",
            items: [{ type: "alert", name: "qa_error_burst", status: "done", ...item }],
            resolvedBy: "ada@example.com",
            resolvedAt: 1,
          },
        },
        { blocks },
      ).wrapper.find('[data-test="assistant-approval-result-open"]');
    expect(made({ id: "a7" }).attributes("href")).toContain("/alerts/a7");
    expect(made({ link: "/alerts/a8" }).attributes("href")).toBe("/alerts/a8");
    expect(made({ link: "https://evil.example/x" }).exists()).toBe(false);
    expect(made({}).exists()).toBe(false);
  });

  it("opens a new panel's dashboard", () => {
    const panel = approvalOf({
      type: "confirmation_required",
      id: "c9",
      tool: "AddPanel",
      kind: "create",
      targets: [{ type: "panel", name: "d1", id: "d1" }],
      args: { dashboard_id: "d1", request_body: { panel: { title: "Total Error Logs" } } },
    });
    const { wrapper } = mountRecord(
      { outcome: { state: "done", at: 1 } },
      { blocks: [{ type: "approval", approval: panel }] },
    );
    expect(
      wrapper.get('[data-test="assistant-approval-result-open"]').attributes("href"),
    ).toContain("d1");
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

  it("reads a reopened chat's own decision as its normal record, never another tab's", () => {
    const reopened = (resolved: Record<string, unknown>) =>
      mountRecord(null, {
        blocks: [
          block,
          { type: "approval_result", resolved: { id: "c9", recorded: true, ...resolved } },
        ],
      }).wrapper;
    const approved = reopened({ approved: true, at: 1_760_000_000_000 });
    expect(line(approved)).toBe("Deleted 2 alerts");
    expect(approved.text()).not.toContain("another tab");
    expect(approved.find('[data-test="assistant-approval-result-meta"]').text()).toMatch(/^you · /);
    expect(line(reopened({ approved: false, at: 1 }))).toBe("Denied: delete 2 alerts");
  });

  it("keeps the server's detail as the reason when the reopened record has no card to name it", () => {
    const orphan = (resolved: Record<string, unknown>) =>
      mountRecord(null, {
        blocks: [
          { type: "approval_result", resolved: { id: "gone", recorded: true, ...resolved } },
        ],
      }).wrapper;
    expect(line(orphan({ approved: false, at: 1 }))).toBe("Denied a change the assistant proposed");
    expect(line(orphan({ approved: false, at: 1, detail: "User declined the request" }))).toBe(
      "Denied a change the assistant proposed · User declined the request",
    );
  });

  it("keeps the record of a Deny made here when its confirmation_resolved follows", () => {
    const resolved: ContentBlock = {
      type: "approval_result",
      resolved: { id: "c9", approved: false, at: 1 },
    };
    const outcome = { state: "declined" as const, at: 1 };
    const card = mountRecord({ outcome }, { blocks: [resolved, block] });
    expect(line(card.wrapper)).toBe("Denied: delete 2 alerts");
    const echo = mountRecord({ outcome }, { blocks: [block, resolved] });
    expect(echo.wrapper.find('[data-test="assistant-approval-result"]').exists()).toBe(false);
  });

  it("reads a confirmation_resolved whose approve failed as failed, in the server's words", () => {
    const resolved: ContentBlock = {
      type: "approval_result",
      resolved: {
        id: "c9",
        approved: true,
        at: 1,
        outcome: "failed",
        detail: "OpenObserve did not accept the assistant's approval for this change.",
      },
    };
    const { wrapper } = mountRecord(null, { blocks: [block, resolved] });
    expect(line(wrapper)).toBe(
      "Nothing was changed. OpenObserve did not accept the assistant's approval for this change.",
    );
  });

  it("words a refused call's raw HTTP error, never its JSON body", () => {
    const refused = (message: string, code?: string) =>
      mountRecord({
        outcome: { state: "failed", at: 1 },
        result: {
          status: "failed",
          items: [
            { type: "alert", name: "mute1", status: "failed", message, ...(code && { code }) },
          ],
          resolvedBy: "ada@example.com",
          resolvedAt: 1,
        },
      }).wrapper;
    const conflict = refused('Error 409: {"code":"already_muted","downtime_id":"d1","until":1}');
    expect(line(conflict)).toBe(
      "Nothing was changed. It already exists or is already in that state",
    );
    expect(conflict.text()).not.toContain("{");
    expect(line(refused('Error 400: {"detail":{"message":"Duration is too long"}}'))).toBe(
      "Nothing was changed. Duration is too long",
    );
    expect(line(refused("Error 418: {}"))).toBe("Nothing was changed. error 418");
    expect(line(refused("whatever", "409"))).toBe(
      "Nothing was changed. It already exists or is already in that state",
    );
  });

  it("names a refusal by the server's detail when it lists no rows", () => {
    const { wrapper } = mountRecord({
      outcome: { state: "failed", at: 1, reason: "Policy refused this change." },
    });
    expect(line(wrapper)).toBe("Nothing was changed. Policy refused this change.");
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
    expect(ended("expired")).toBe("Request expired. Nothing was changed.");
    expect(ended("withdrawn")).toBe("This request is no longer valid. The conversation moved on.");
  });

  it("reads a replayed card's server approval row as this user's own decision", () => {
    const recorded = (status: "approved" | "denied" | "expired" | "withdrawn", at?: number) => {
      const approval = { ...BATCH, recorded: { status, ...(at && { at }) } };
      return mountRecord(null, { readonly: true, blocks: [{ type: "approval", approval }] });
    };
    expect(line(recorded("approved", 1_760_000_000_000).wrapper)).toMatch(/^Approved · /);
    expect(line(recorded("denied").wrapper)).toBe("Denied: delete 2 alerts");
    expect(line(recorded("expired").wrapper)).toBe("Request expired. Nothing was changed.");
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
      "Denied: delete 2 alerts",
    );
    first.wrapper.unmount();
  });

  it("hands focus to the composer when a decision lands on a turn that already ended", async () => {
    const held = ref(true);
    const focusComposer = vi.fn();
    const { wrapper, evidence } = mountRecord(null, { held, focusComposer });
    evidence.store.annotate(evidence.sid, "approval:c9", {
      approvalOutcome: { state: "declined", at: Date.now() },
    });
    held.value = false;
    await nextTick();
    await nextTick();
    expect(focusComposer).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("lands on the record while the turn runs on, then on the composer when it ends", async () => {
    const held = ref(true);
    const focusComposer = vi.fn();
    const { wrapper, evidence } = mountRecord(null, { held, focusComposer });
    const session = evidence.store.state.sessions[evidence.sid]!;
    session.turn = { state: "responding.writing" };
    await nextTick();
    evidence.store.annotate(evidence.sid, "approval:c9", {
      approvalOutcome: { state: "approved", at: Date.now() },
    });
    held.value = false;
    await nextTick();
    await nextTick();
    expect(document.activeElement?.hasAttribute("data-approval-line")).toBe(true);
    expect(focusComposer).not.toHaveBeenCalled();
    session.turn = { state: "idle" };
    await nextTick();
    expect(focusComposer).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("speaks a decision just made once, and history never", () => {
    const fresh = mountRecord({ outcome: { state: "declined", at: Date.now() } });
    expect(fresh.evidence.host.announce).toHaveBeenCalledWith(
      fresh.evidence.sid,
      "Denied: delete 2 alerts",
    );
    const old = mountRecord({ outcome: { state: "declined", at: 1 } });
    expect(old.evidence.host.announce).not.toHaveBeenCalled();
  });

  it("offers Undo on the line of a single undoable change, and leaves a batch's to the actions list", async () => {
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
    const single = mountRecord({ outcome: { state: "done", at: 1 } });
    single.evidence.store.state.sessions[single.evidence.sid]!.ledger.push(entry);
    await nextTick();
    expect(single.wrapper.find('[data-test="assistant-approval-result-undo-led-1"]').exists()).toBe(
      true,
    );
    const batch = mountRecord({ outcome: { state: "done", at: 1 } });
    batch.evidence.store.state.sessions[batch.evidence.sid]!.ledger.push(entry, {
      ...entry,
      id: "led-2",
    });
    await nextTick();
    expect(batch.wrapper.find('[data-test^="assistant-approval-result-undo"]').exists()).toBe(
      false,
    );
  });

  describe("v7", () => {
    const UPDATE = approvalOf({
      type: "confirmation_required",
      call_id: "c9",
      kind: "update",
      operation: "UpdateAlert",
      tool: "UpdateAlert",
      targets: [{ type: "alert", id: "2abc", name: "checkout-5xx" }],
      args: { alert_id: "2abc" },
      after: { threshold: 3, period: "10 min" },
      before: { threshold: 2, period: "5 min" },
      before_digest: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    });
    const updateBlock: ContentBlock = { type: "approval", approval: UPDATE };
    const message =
      "The alert changed after you were asked. Nothing was changed; review the new version and ask again.";

    it("C3 changed_since: says so, redraws the diff against the object as it is now, and offers Ask again", async () => {
      const { wrapper, host } = mountRecord(
        {
          outcome: { state: "skipped", at: 1, decision: { approved: true, scope: "once" } },
          result: {
            status: "skipped",
            items: [
              {
                id: "2abc",
                type: "alert",
                name: "checkout-5xx",
                status: "skipped",
                code: "changed_since",
                message,
                before: { threshold: 2.5, period: "5 min" },
              },
            ],
            resolvedBy: "ada@example.com",
            resolvedAt: 1,
          },
        },
        { blocks: [updateBlock] },
      );

      expect(line(wrapper)).toBe("Changed since asked");
      expect(wrapper.get('[data-test="assistant-approval-result-skipped-detail"]').text()).toBe(
        message,
      );
      const diff = wrapper.get('[data-test="assistant-approval-result-fresh-diff"]');
      expect(diff.findAll("s").map((el) => el.text())).toEqual(["2.5", "5 min"]);
      expect(diff.text()).toContain("10 min");
      expect(wrapper.find('[data-test^="assistant-approval-result-item-"]').exists()).toBe(false);
      await wrapper.get('[data-test="assistant-approval-result-ask-again"]').trigger("click");
      expect(host.askAgain).toHaveBeenCalledWith(expect.anything(), "c9");
    });

    it("C3 recheck_failed: says nothing was written and draws no diff", () => {
      const { wrapper } = mountRecord(
        {
          outcome: { state: "skipped", at: 1, decision: { approved: true, scope: "once" } },
          result: {
            status: "skipped",
            items: [
              {
                type: "alert",
                name: "checkout-5xx",
                status: "skipped",
                code: "recheck_failed",
              },
            ],
            resolvedBy: "ada@example.com",
            resolvedAt: 1,
          },
        },
        { blocks: [updateBlock] },
      );

      expect(line(wrapper)).toBe("Couldn't check for changes, so nothing was written");
      expect(wrapper.find('[data-test="assistant-approval-result-fresh-diff"]').exists()).toBe(
        false,
      );
    });

    it("a reopened chat's skipped resolution reads as skipped, never as done", () => {
      const resolved: ContentBlock = {
        type: "approval_result",
        resolved: {
          id: "c9",
          approved: true,
          recorded: true,
          outcome: "skipped",
          code: "changed_since",
          detail: message,
          at: 1,
        },
      };
      const { wrapper } = mountRecord(null, { blocks: [updateBlock, resolved] });

      expect(line(wrapper)).toBe("Changed since asked");
    });

    it("an always-allowed approve says so with Revoke, which revokes the reader's grant", async () => {
      const { wrapper } = mountRecord(
        {
          outcome: { state: "done", at: 1, decision: { approved: true, scope: "tool" } },
        },
        { blocks: [updateBlock] },
      );
      const always = wrapper.get('[data-test="assistant-approval-result-always"]');
      expect(always.text()).toContain("Always allowed: updating alerts");
      const grants = vi.spyOn(assistantSettings, "grants").mockResolvedValue([
        {
          id: "g1",
          tool: "UpdateAlert",
          operation: "",
          scope: "always",
          granted_by: "ada@example.com",
          granted_at: 1,
        },
      ]);
      const revoke = vi.spyOn(assistantSettings, "revokeGrant").mockResolvedValue(undefined);

      await wrapper.get('[data-test="assistant-approval-result-revoke"]').trigger("click");
      await flushPromises();

      expect(grants).toHaveBeenCalled();
      expect(revoke).toHaveBeenCalledWith(expect.any(String), "g1");
      expect(always.text()).toBe("Approval revoked. The assistant will ask next time.");
    });

    it("a once approve has no always line", () => {
      const { wrapper } = mountRecord(
        { outcome: { state: "done", at: 1, decision: { approved: true, scope: "once" } } },
        { blocks: [updateBlock] },
      );
      expect(wrapper.find('[data-test="assistant-approval-result-always"]').exists()).toBe(false);
    });

    it("a single undoable change carries the shipped undo-limits sentence", async () => {
      const single = mountRecord({ outcome: { state: "done", at: 1 } });
      single.evidence.store.state.sessions[single.evidence.sid]!.ledger.push({
        id: "led-1",
        approvalId: "c9",
        turnId: "t1",
        tool: "o2_delete",
        op: "delete",
        resource: { type: "alert", name: "checkout-latency-old" },
        status: "done",
        undoable: true,
        at: 1,
      });
      await nextTick();
      expect(single.wrapper.get('[data-test="assistant-approval-result-undo-limits"]').text()).toBe(
        "Undo restores the object. Notifications already sent and data already deleted stay as they are.",
      );
    });
  });
});
