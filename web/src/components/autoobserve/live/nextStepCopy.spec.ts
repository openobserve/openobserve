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
import "@/locales";
import { gt } from "@/types/i18n";
import type {
  AutoObserveCauseLine,
  AutoObserveIssueContext,
  AutoObserveStepView,
} from "@/services/autoobserve";
import { WORKING_MAX_MS, nextStepLine, type StepLine } from "./nextStepCopy";

const NOW_MS = Date.UTC(2026, 10, 16, 14, 15);
const PIPELINE = { path: "pipeline/pipelines/edit", query: { id: "p1" } };
const LOGS = { path: "logs", query: { stream: "payments-api-logs" } };
const VERSIONS = { path: "traces", query: { panel: "versions", service: "checkout" } };
const LINKS: Partial<Record<AutoObserveCauseLine["record"]["kind"], typeof PIPELINE>> = {
  pipeline_failing: PIPELINE,
  deploy: VERSIONS,
};

const row = (id: string, kind: AutoObserveCauseLine["record"]["kind"]): AutoObserveCauseLine =>
  ({
    id,
    record: { kind, open: LINKS[kind] ?? null },
    grade: "likely",
    sentence: id,
    used: false,
  }) as AutoObserveCauseLine;

const cx = {
  causes: {
    top: [row("c1", "pipeline_failing"), row("c2", "settings_changed"), row("c3", "deploy")],
    more: 0,
  },
} as AutoObserveIssueContext;

const step = (
  over: Partial<AutoObserveStepView>,
  cites = ["c1"],
  open = PIPELINE,
): AutoObserveStepView => ({
  step: {
    step_id: "s1",
    source: "engine",
    action: { open },
    label: "Open pipeline mask-pii",
    why: "Pipeline mask-pii started failing, 4 minutes before the issue started.",
    cites,
    at: 0,
    run_id: null,
  },
  state: "engine_only",
  judged: null,
  issue_id: "d1",
  ...over,
});

const ai = (cites: string[], judged: boolean | null = null, open = PIPELINE) => {
  const view = step({ state: "ready", judged }, cites, open);
  view.step.source = "ai";
  return view;
};

const working = (ago: number) => ({ working: { since: (NOW_MS - ago) * 1000 } });

describe("nextStepLine", () => {
  it.each<[string, AutoObserveStepView, Partial<StepLine>]>([
    [
      "engine step on a Likely pipeline: the primary Open pipeline, no note, no Not helpful",
      step({}),
      {
        note: null,
        notHelpful: null,
        link: { to: PIPELINE, label: "Open pipeline", primary: true },
      },
    ],
    [
      "engine step with no cause: outlined Open logs",
      step({}, [], LOGS),
      { link: { to: LOGS, label: "Open logs", primary: false } },
    ],
    [
      "working: the AI note, still the engine text",
      step({ state: working(60_000) }),
      { note: "working", notHelpful: null },
    ],
    [
      "past WORKING_MAX: engine step, no note",
      step({ state: working(WORKING_MAX_MS + 1) }),
      { note: null },
    ],
    [
      "AI step on 2 of 3 changes: the based-on note and Not helpful",
      ai(["c1", "c2"]),
      { note: "ai", noteText: expect.stringContaining("2 of the 3"), notHelpful: "offer" },
    ],
    [
      "AI step on every change",
      ai(["c1", "c2", "c3"]),
      { noteText: expect.stringContaining("all 3") },
    ],
    [
      "AI step citing a pipeline and a deploy that opens the deploy: the button names versions",
      ai(["c1", "c3"], null, VERSIONS),
      { link: { to: VERSIONS, label: "Open versions", primary: false } },
    ],
    [
      "AI check-only step: no button, still judged",
      { ...ai(["c1"]), step: { ...ai(["c1"]).step, action: "check_only" } },
      { link: null, notHelpful: "offer" },
    ],
    [
      "judged not helpful: pressed and says so",
      ai(["c1"], false),
      { note: "judged", notHelpful: "pressed" },
    ],
  ])("%s", (_name, view, want) => {
    expect(nextStepLine(gt, view, cx, NOW_MS)).toMatchObject(want as object);
  });
});
