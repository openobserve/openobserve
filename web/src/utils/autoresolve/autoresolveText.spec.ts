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

import { describe, expect, it } from "vitest";
import { gt } from "@/types/i18n";
import type { AutoResolvePlan, AutoResolveRun, AutoResolveRunState } from "@/services/autoresolve";
import {
  autoresolveOption,
  autoresolveRun,
  autoresolveStep,
} from "@/test/unit/fixtures/autoresolveRun";
import { RCA_T0, rcaStep, rcaThread, rcaToolCall, sec } from "@/test/unit/fixtures/rcaThread";
import {
  AUTORESOLVE_STAGES,
  addableConnection,
  approversSentence,
  asksVerdict,
  autoresolveDuration,
  autoresolveWhen,
  cannotApproveTexts,
  canUseSentence,
  connectionsSentence,
  investigationSummary,
  namesSentence,
  needsText,
  removedChips,
  runConnections,
  shownRunState,
  skippedStages,
  stageIndexFor,
  stepResultView,
  theMcps,
  turnLine,
} from "./autoresolveText";

const NAMES = ["Ana", "Ben", "Cy", "Dee", "Eve", "Fay", "Gus", "Hal", "Ida", "Jo"];
const removedLast = (names: string[], t: typeof gt) =>
  connectionsSentence(
    names.map((name, i) => ({ id: `c${i}`, name, removed: i === names.length - 1 })),
    t,
  );
const LONG_TEXT = Array.from({ length: 7 }, (_, i) => `line ${i + 1}`).join("\n");
const LONG_JSON = JSON.stringify(Array.from({ length: 25 }, (_, i) => i));

describe("autoresolveText", () => {
  it.each([
    ["namesSentence", 0, namesSentence, ""],
    ["namesSentence", 1, namesSentence, "Ana"],
    // en-US Intl.ListFormat keeps the serial comma.
    ["namesSentence", 3, namesSentence, "Ana, Ben, and Cy"],
    ["namesSentence", 10, namesSentence, "Ana, Ben, Cy, and 7 more"],
    ["canUseSentence", 1, canUseSentence, "the Ana MCP and OpenObserve data"],
    ["canUseSentence", 3, canUseSentence, "the Ana, Ben, and Cy MCPs, and OpenObserve data"],
    [
      "canUseSentence",
      7,
      canUseSentence,
      "the Ana, Ben, Cy, and 4 more MCPs, and OpenObserve data",
    ],
    ["theMcps", 0, theMcps, ""],
    ["theMcps", 1, theMcps, "the Ana MCP"],
    ["theMcps", 4, theMcps, "the Ana, Ben, Cy, and Dee MCPs"],
    ["theMcps", 10, theMcps, "the Ana, Ben, Cy, and 7 more MCPs"],
    ["connectionsSentence", 3, removedLast, "Cy (removed), Ana, and Ben"],
  ])("%s reads well for %i names", (_name, count, sentence, expected) => {
    expect(sentence(NAMES.slice(0, count), gt)).toBe(expected);
  });

  it.each([
    [1, ["Ana"], null],
    [3, ["Ana", "Ben", "Cy"], null],
    [6, ["Ana", "Ben"], 4],
  ])("removedChips folds %i removed connections into a few chips", (count, shown, folded) => {
    const more = folded
      ? gt("autoresolve.connection.moreRemoved", { count: folded }, folded)
      : null;
    expect(removedChips(NAMES.slice(0, count), gt)).toEqual({ shown, more });
  });

  const K8S = { id: "c-k8s", name: "Cluster" };
  const PLANNED = autoresolveRun({
    plan: {
      fingerprint: "fp",
      options: [autoresolveOption({ steps: [autoresolveStep({ connection: K8S })] })],
      omitted_count: 0,
      omitted_reason: null,
      missing_capability: null,
    },
  });
  it.each([
    ["an older run lists its plan's", PLANNED, [], [{ ...K8S, removed: false }]],
    [
      "a run lists the ones it was started with, a refused approval marking one removed",
      {
        ...PLANNED,
        connections: [
          { id: "c-git", name: "Code host" },
          { ...K8S, removed: true },
        ],
      },
      ["c-git"],
      [
        { id: "c-git", name: "Code host", removed: true },
        { ...K8S, removed: true },
      ],
    ],
  ])("runConnections: %s", (_case, run, removedIds, expected) => {
    expect(runConnections(run, new Set(removedIds))).toEqual(expected);
  });

  const role = (name: string) => ({ kind: "role" as const, name });
  const ADMINS = { kind: "org_admins" as const, name: "Org admins" };
  const ROLES = Array.from({ length: 12 }, (_, i) => role(`r${i + 1}`));
  it.each([
    ["nobody", [], ""],
    ["one role", [role("sre")], "Role sre"],
    ["roles only", [role("sre"), role("platform")], "Roles sre and platform"],
    [
      "roles, a group and org admins",
      [role("sre"), role("platform"), { kind: "group" as const, name: "oncall" }, ADMINS],
      "Roles sre and platform; group oncall; Org admins",
    ],
    ["org admins only", [ADMINS], "Org admins"],
    [
      "the same role from two connections",
      [role("sre"), ADMINS, role("sre"), ADMINS],
      "Role sre; Org admins",
    ],
    ["12 roles", [...ROLES, ADMINS], "Roles r1, r2, r3, and 9 more; Org admins"],
  ])("approversSentence names %s by kind", (_case, approvers, expected) => {
    expect(approversSentence(approvers, gt)).toBe(expected);
  });

  const CODE = { id: "c-git", name: "Code host" };
  const CLUSTER = { id: "c-k8s", name: "Cluster" };
  it.each([
    [
      "one the summary marks not approvable",
      [
        ["c-git", false],
        ["c-k8s", true],
      ],
      ["Code host"],
    ],
    ["one missing from the summary", [["c-k8s", true]], ["Code host"]],
    [
      "none when every MCP is approvable",
      [
        ["c-git", true],
        ["c-k8s", true],
      ],
      [],
    ],
  ] as [string, [string, boolean][], string[]][])(
    "cannotApproveTexts reserves %s, naming who may",
    (_case, summary, refused) => {
      expect(
        cannotApproveTexts([CODE, CLUSTER], new Map(summary), [role("sre"), ADMINS], gt),
      ).toEqual(
        refused.map((name) =>
          gt("autoresolve.approval.cannotApprove", {
            mcps: theMcps([name], gt),
            approvers: "Role sre; Org admins",
          }),
        ),
      );
    },
  );

  it.each<[AutoResolveRunState, number]>([
    ["investigating", 0],
    ["waiting_approval", 1],
    ["proceeding", 2],
    ["checking", 3],
    ["worked", 4],
    ["no_change", 4],
    ["worse", 4],
    ["declined", 4],
    ["lapsed", 4],
    ["step_failed", 4],
    ["outcome_unknown", 4],
    ["failed", 4],
  ])("stageIndexFor maps every run state to a stage (%s)", (state, index) => {
    expect(stageIndexFor(state)).toBe(index);
    expect(AUTORESOLVE_STAGES[index]).toBeDefined();
  });

  const PODS = "checkout restarted: 3/3 pods ready";
  const CUT = '{"content":[{"type":"te';
  it.each([
    ["text", PODS, ["text", PODS, PODS, false]],
    [
      "a JSON object",
      '{"pods":3, "ready":true}',
      ["json", '{\n  "pods": 3,\n  "ready": true\n}', '{"pods":3,"ready":true}', false],
    ],
    ["empty", "  ", null],
    // A text result's toggle comes from the cut measured on screen, not from a count.
    ["text past the line cap", LONG_TEXT, ["text", LONG_TEXT, "line 1…", false]],
    [
      "JSON past the line cap",
      LONG_JSON,
      ["json", JSON.stringify(JSON.parse(LONG_JSON), null, 2), LONG_JSON, true],
    ],
    [
      "one line past the evidence cap",
      "x".repeat(130),
      ["text", "x".repeat(130), `${"x".repeat(119)}…`, false],
    ],
    ["a cut JSON prefix", CUT, ["text", CUT, CUT, false]],
  ])("stepResultView reads %s", (_case, summary, expected) => {
    const view = stepResultView(summary);
    expect(view && [view.kind, view.text, view.line, view.long]).toEqual(expected);
  });

  const GUARD = "Not run: this call changes something. Add it as a step to submit_plan.";
  const call = (id: string, at: number, extra = {}) =>
    rcaToolCall({
      call_id: id,
      tool: id,
      started_at: RCA_T0 + sec(at),
      duration_ms: 1_000,
      ...extra,
    });
  const prompt = (at: number) => ({ at: RCA_T0 + sec(at), text: "Proceed.", steer_id: null });
  const PLAN = {
    options: [{ steps: [{ tool: "scale_up", connection: { id: "c-k8s", name: "Cluster" } }] }],
  } as unknown as AutoResolvePlan;
  // The header count and the "Investigated" list both read `steps`, so they cannot disagree.
  it.each([
    [
      "the held flag without planned_at_us, not the guard's wording",
      [
        call("read_status", 2),
        call("restart_service", 8, { held: true }),
        call("worded", 9, { error: GUARD }),
        call("exec", 300),
      ],
      [prompt(200)],
      null,
      [
        3,
        sec(10),
        [{ tool: "restart_service", connection: null }],
        ["read_status", "restart_service", "worded"],
      ],
    ],
    [
      "held flags in a replan turn, named with their connection",
      [
        call("read_status", 2),
        call("restart_service", 8, { held: true }),
        call("exec", 250),
        call("o2_scale_up", 320, { held: true }),
        call("worded", 330, { error: GUARD, held: false }),
      ],
      [prompt(200), prompt(300)],
      sec(400),
      [
        2,
        sec(9),
        [{ tool: "scale_up", connection: "Cluster" }],
        ["read_status", "restart_service"],
      ],
    ],
    [
      "planned_at_us ending the first turn",
      [call("read_status", 2), call("read_logs", 8)],
      [],
      sec(30),
      [2, sec(30), [], ["read_status", "read_logs"]],
    ],
  ])("investigationSummary reads %s", (_case, calls, prompts, plannedAfter, expected) => {
    const thread = rcaThread({
      active: false,
      steps: [rcaStep({ tool_calls: calls })],
      user_messages: prompts,
    });
    const summary = investigationSummary({
      thread,
      created_at_us: RCA_T0,
      planned_at_us: plannedAfter === null ? null : RCA_T0 + plannedAfter,
      plan: PLAN,
    });
    const listed = summary.steps.flatMap((s) => s.tool_calls.map((c) => c.call_id));
    expect([summary.calls, summary.durationUs, summary.held, listed]).toEqual(expected);
  });

  it.each([
    ["needs postgres: end session 4211", "This fix needs the postgres MCP: end session 4211"],
    ["No connected tool can restart the host.", null],
  ])("needsText words %s for people", (text, expected) => {
    expect(needsText(text, gt)).toBe(expected);
  });

  const verdict = (v: "fixed" | "not_fixed", revision: number) => ({
    verdict: v,
    note: null,
    by: "lead@example.com",
    at_us: RCA_T0,
    revision,
  });
  it.each<[string, Partial<AutoResolveRun>, string, boolean]>([
    ["an approver on a worked run", { state: "worked" }, "bob@example.com", true],
    [
      "the requester, typed another way",
      { state: "worked", can_approve: false },
      " Ana@Example.com ",
      true,
    ],
    [
      "someone who may not decide",
      { state: "worked", can_approve: false },
      "bob@example.com",
      false,
    ],
    ["an approver on a run that made it worse", { state: "worse" }, "", true],
    ["an approver on a waiting run", { state: "waiting_approval" }, "", false],
    [
      "this revision's Didn't fix it",
      { state: "worked", person_verdict: verdict("not_fixed", 1) },
      "",
      false,
    ],
    ["this revision's Fixed", { state: "worked", person_verdict: verdict("fixed", 1) }, "", true],
    [
      "an earlier revision's verdict",
      { state: "worked", revision: 2, person_verdict: verdict("not_fixed", 1) },
      "",
      true,
    ],
  ])("asksVerdict for %s", (_case, overrides, email, expected) => {
    expect(asksVerdict(autoresolveRun(overrides), email)).toBe(expected);
  });

  const MISSING = {
    name: "postgres",
    connection_id: "c-pg",
    action: "end session 4211",
    can_add: true,
    cannot_add_reason: null,
  };
  const NEEDS_PLAN = { ...(PLANNED.plan as AutoResolvePlan), missing_connection: MISSING };
  const RAN = autoresolveStep({ state: "done", consumed_at_us: RCA_T0 });
  it.each<[string, Partial<AutoResolveRun>, boolean]>([
    ["a waiting run", { state: "waiting_approval" }, true],
    ["a run a no-option plan ended", { state: "no_change", steps: [] }, true],
    ["a waiting run past its deadline", { approval_deadline_us: RCA_T0 - 1 }, false],
    ["a no-change run whose step ran", { state: "no_change", steps: [RAN] }, false],
    [
      "a no-change run whose step was approved but not yet called",
      { state: "no_change", steps: [autoresolveStep({ state: "approved", consumed_at_us: null })] },
      false,
    ],
    ["a worked run", { state: "worked", steps: [RAN] }, false],
  ])("addableConnection offers the connection on %s", (_case, overrides, offered) => {
    const run = autoresolveRun({ plan: NEEDS_PLAN, ...overrides });
    expect(addableConnection(run, RCA_T0)).toEqual(offered ? MISSING : null);
  });

  it.each<[string, Partial<AutoResolveRun>, string]>([
    ["a run the server marks no MCP can fix", { state: "no_change", cant_fix: true }, "cant_fix"],
    ["any other run", { state: "no_change", cant_fix: false }, "no_change"],
  ])("shownRunState for %s", (_case, overrides, expected) => {
    expect(shownRunState(autoresolveRun(overrides))).toBe(expected);
  });

  const UNASKED = { approval_deadline_us: null };
  const RAN_ON = { approved_at_us: RCA_T0, approval_deadline_us: null, steps: [RAN] };
  const ALL = ["ask", "proceed", "check"];
  it.each<[string, Partial<AutoResolveRun>, string[]]>([
    ["a worked run", { state: "worked", ...RAN_ON }, []],
    ["a no-change run whose check ran", { state: "no_change", ...RAN_ON }, []],
    ["a run no MCP can fix", { state: "no_change", ...UNASKED }, ALL],
    ["a declined run", { state: "declined", ...UNASKED }, ["proceed", "check"]],
    ["a lapsed run", { state: "lapsed" }, ["proceed", "check"]],
    ["a run whose step failed", { state: "step_failed", ...RAN_ON }, ["check"]],
    ["a run that failed before its plan", { state: "failed", ...UNASKED }, ALL],
    ["a waiting run", { state: "waiting_approval" }, []],
  ])("skippedStages for %s", (_case, overrides, expected) => {
    expect(skippedStages(autoresolveRun(overrides))).toEqual(expected);
  });

  const DEC_1_1048 = Date.UTC(2026, 11, 1, 10, 48) * 1000;
  it.each([
    ["today as the time only", DEC_1_1048 - sec(3600), { text: "10:48", today: true }],
    ["another day with its date", DEC_1_1048 - sec(86_400), { text: "Dec 1, 10:48", today: false }],
  ])("autoresolveWhen shows a deadline %s", (_case, nowUs, expected) => {
    expect(autoresolveWhen(DEC_1_1048, nowUs, "en-US", "UTC")).toEqual(expected);
  });

  it.each([
    [sec(40.9), "40 s"],
    [sec(80), "1 min 20 s"],
    [sec(120), "2 min"],
    [sec(3929), "1 h 5 min"],
  ])("autoresolveDuration reads %i µs as %s", (us, expected) => {
    expect(autoresolveDuration(us, gt)).toBe(expected);
  });

  // A slow tool is not a silent model; a call an earlier turn left open does not count.
  it.each([
    ["61 s with no output and no step running", "done", null, 61, true, "1 min"],
    ["150 s, in whole minutes", "done", null, 150, true, "2 min"],
    ["59 s", "done", null, 59, false, "Proceeding for 59 s"],
    ["a running step", "running", null, 150, false, "Proceeding for 2 min 30 s"],
    ["a read call running this turn", "done", sec(10), 150, false, "Proceeding for 2 min 30 s"],
    ["a call left open before this turn", "done", -sec(10), 150, true, "2 min"],
  ] as const)(
    "turnLine says the AI model went quiet after %s",
    (_c, step, callAt, quiet, silent, text) => {
      const call = rcaToolCall({ status: "running", started_at: RCA_T0 + (callAt ?? 0) });
      const run = autoresolveRun({
        state: "proceeding",
        steps: [autoresolveStep({ state: step, consumed_at_us: RCA_T0 })],
        thread: rcaThread({ steps: callAt === null ? [] : [rcaStep({ tool_calls: [call] })] }),
        turn: {
          started_at_us: RCA_T0,
          deadline_us: RCA_T0 + sec(900),
          last_output_us: RCA_T0,
          check_retry: false,
        },
      });
      const line = turnLine(run, RCA_T0 + sec(quiet), gt);
      expect(line.silent).toBe(silent);
      expect(line.text).toContain(text);
    },
  );

  it.each([
    ["a thread step is live", null, false],
    ["every thread step ended", RCA_T0 + sec(20), true],
  ] as const)("turnLine leaves the spinner to the thread when %s", (_c, endedAt, spinner) => {
    const run = autoresolveRun({
      state: "investigating",
      thread: rcaThread({ steps: [rcaStep({ ended_at: endedAt })] }),
      turn: {
        started_at_us: RCA_T0,
        deadline_us: RCA_T0 + sec(900),
        last_output_us: RCA_T0,
        check_retry: false,
      },
    });
    expect(turnLine(run, RCA_T0 + sec(30), gt).spinner).toBe(spinner);
  });
});
