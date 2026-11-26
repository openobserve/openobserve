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

import { describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive, ref } from "vue";

import type { AssistantSession } from "@/composables/assistant";
import { approvalOf } from "@/composables/assistant/reducer";

const state = reactive({ sessions: {} as Record<string, AssistantSession> });

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => ({ state }),
}));

const { settledDashboardWrites, useAssistantDashboardWrites } =
  await import("./assistantDashboardWrites");

const DASH = "7524560427116658688";

function session(overrides: Partial<Record<string, unknown>> = {}): AssistantSession {
  return {
    sid: "s1",
    turn: { state: "idle" },
    messages: [
      {
        role: "assistant",
        content: "",
        contentBlocks: [
          {
            type: "approval",
            approval: {
              id: "call-1",
              kind: "create",
              tool: "create_panel",
              targets: [{ type: "panel", name: DASH }],
              args: { tabId: "default" },
            },
          },
        ],
      },
    ],
    annotations: {
      "approval:call-1": {
        approvalOutcome: { state: "approved", at: 1, decision: { approved: true } },
      },
    },
    ledger: [],
    ...overrides,
  } as unknown as AssistantSession;
}

describe("settledDashboardWrites", () => {
  it("counts an approved write to this dashboard once its turn has ended", () => {
    expect(settledDashboardWrites({ sessions: { s1: session() } }, DASH)).toEqual([
      "s1:approval:call-1",
    ]);
  });

  it("waits while the resumed turn still runs the approved tool", () => {
    const running = session({
      turn: { state: "running_tool", tool: "x", target: null, callId: "c" },
    });
    expect(settledDashboardWrites({ sessions: { s1: running } }, DASH)).toEqual([]);
  });

  it("ignores declines, other dashboards and approvals still sending", () => {
    const declined = session({
      annotations: {
        "approval:call-1": {
          approvalOutcome: { state: "approved", at: 1, decision: { approved: false } },
        },
      },
    });
    const sending = session({
      annotations: { "approval:call-1": { approvalOutcome: { state: "sending", at: 1 } } },
    });
    expect(settledDashboardWrites({ sessions: { s1: declined } }, DASH)).toEqual([]);
    expect(settledDashboardWrites({ sessions: { s1: sending } }, DASH)).toEqual([]);
    expect(settledDashboardWrites({ sessions: { s1: session() } }, "other")).toEqual([]);
  });

  it("matches the dashboard in the tool's arguments and counts an undo of it", () => {
    const byArgs = session({
      messages: [
        {
          role: "assistant",
          contentBlocks: [
            {
              approval: {
                id: "call-1",
                kind: "update",
                tool: "update_panel",
                targets: [{ type: "panel", name: "Errors" }],
                args: { dashboard_id: DASH },
              },
            },
          ],
        },
      ],
      ledger: [{ id: "led-1", status: "undone", resource: { type: "dashboard", name: DASH } }],
    });
    expect(settledDashboardWrites({ sessions: { s1: byArgs } }, DASH)).toEqual([
      "s1:approval:call-1",
      "s1:undo:led-1",
    ]);
  });
  it("matches a dashboard_id arg that follows a request_body too big for the args budget", () => {
    const queries = Array.from({ length: 40 }, (_, i) => ({ id: `q${i}` }));
    const panels = Array.from({ length: 40 }, () => ({ queries }));
    const card = approvalOf({
      call_id: "call-1",
      tool: "update_dashboard",
      kind: "update",
      args: { request_body: { panels }, dashboard_id: DASH },
    });
    expect(card.args?.dashboard_id).toBe(DASH);
    const big = session({
      messages: [{ role: "assistant", contentBlocks: [{ type: "approval", approval: card }] }],
    });
    expect(settledDashboardWrites({ sessions: { s1: big } }, DASH)).toEqual(["s1:approval:call-1"]);
  });

  it("reads the id of a dashboard arg given as an object", () => {
    const byObject = (dashboard: unknown) =>
      session({
        messages: [
          {
            role: "assistant",
            contentBlocks: [
              {
                type: "approval",
                approval: {
                  id: "call-1",
                  kind: "update",
                  tool: "update_dashboard",
                  args: { dashboard },
                },
              },
            ],
          },
        ],
      });
    expect(
      settledDashboardWrites({ sessions: { s1: byObject({ dashboardId: DASH }) } }, DASH),
    ).toEqual(["s1:approval:call-1"]);
    expect(settledDashboardWrites({ sessions: { s1: byObject({ title: "x" }) } }, DASH)).toEqual(
      [],
    );
    expect(
      settledDashboardWrites({ sessions: { s1: byObject({ title: "x" }) } }, "[object Object]"),
    ).toEqual([]);
  });

  it("counts an undo of a panel by the approval that made it, and reads the link's id exactly", () => {
    const panelUndo = session({
      ledger: [
        {
          id: "led-2",
          approvalId: "call-1",
          status: "undone",
          resource: { type: "panel", id: "p9", name: "Errors" },
        },
      ],
    });
    const otherLink = session({
      messages: [
        {
          role: "assistant",
          contentBlocks: [
            {
              approval: {
                id: "call-1",
                kind: "update",
                tool: "update_dashboard",
                targets: [
                  { type: "dashboard", name: "x", link: `/dashboards/view?dashboard=${DASH}9` },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(settledDashboardWrites({ sessions: { s1: panelUndo } }, DASH)).toEqual([
      "s1:approval:call-1",
      "s1:undo:led-2",
    ]);
    expect(settledDashboardWrites({ sessions: { s1: otherLink } }, DASH)).toEqual([]);
  });
});

describe("useAssistantDashboardWrites", () => {
  it("reloads when a new write to the open dashboard settles, not for one already there", async () => {
    state.sessions = { s1: session() };
    const reload = vi.fn();
    const dashboard = ref(DASH);
    const scope = effectScope();
    scope.run(() => useAssistantDashboardWrites(() => dashboard.value, reload));

    state.sessions.s1.turn = { state: "running_tool", tool: "x", target: null, callId: "c" };
    await nextTick();
    state.sessions.s1.turn = { state: "idle" };
    await nextTick();
    expect(reload).not.toHaveBeenCalled();

    state.sessions.s2 = session({
      sid: "s2",
      turn: { state: "running_tool", tool: "x", target: null, callId: "c" },
    });
    await nextTick();
    expect(reload).not.toHaveBeenCalled();
    state.sessions.s2.turn = { state: "idle" };
    await nextTick();
    expect(reload).toHaveBeenCalledTimes(1);

    scope.stop();
  });

  it("does not reload for an old chat that arrives from history or another tab", async () => {
    state.sessions = {};
    const reload = vi.fn();
    const scope = effectScope();
    scope.run(() => useAssistantDashboardWrites(() => DASH, reload));

    state.sessions.s3 = session({ sid: "s3" });
    await nextTick();
    expect(reload).not.toHaveBeenCalled();

    scope.stop();
  });

  it("does not reload for the writes it finds on switching to another dashboard", async () => {
    state.sessions = { s1: session() };
    const reload = vi.fn();
    const dashboard = ref("other");
    const scope = effectScope();
    scope.run(() => useAssistantDashboardWrites(() => dashboard.value, reload));

    dashboard.value = DASH;
    await nextTick();
    expect(reload).not.toHaveBeenCalled();

    scope.stop();
  });
});
