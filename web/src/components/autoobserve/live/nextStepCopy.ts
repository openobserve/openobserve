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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type {
  AutoObserveDeepLink,
  AutoObserveIssueContext,
  AutoObserveStepView,
} from "@/services/autoobserve";
import { causeLinkLabel, isPrimaryKind } from "./causeCopy";

export type StepNote = "working" | "ai" | "judged" | null;

export interface StepLine {
  text: I18nText;
  // The server's own link; null for a check-only step.
  link: { to: AutoObserveDeepLink; label: I18nText; primary: boolean } | null;
  note: StepNote;
  noteText: I18nText | null;
  // Offered only on an AI step; "pressed" once someone marked it.
  notHelpful: "offer" | "pressed" | null;
}

const LOGS_PAGE = "logs";

export const nextStepLine = (
  t: TranslateFn,
  view: AutoObserveStepView,
  cx: AutoObserveIssueContext,
  nowMs: number,
): StepLine => {
  const ai = view.state === "ready" && view.step.source === "ai";
  const state = view.state;
  // Past the served until the AI is taken to have failed: the note goes, the engine step stays (L6).
  const until = typeof state === "object" ? state.working.until : undefined;
  const working = until !== undefined && nowMs < until / 1000;
  const judged = view.judged === false;
  const note: StepNote = ai ? (judged ? "judged" : "ai") : working ? "working" : null;
  return {
    text: raw(view.step.why),
    link: linkOf(t, view, cx),
    note,
    noteText: noteTextOf(t, note, view, cx),
    notHelpful: ai ? (judged ? "pressed" : "offer") : null,
  };
};

const linkOf = (
  t: TranslateFn,
  view: AutoObserveStepView,
  cx: AutoObserveIssueContext,
): StepLine["link"] => {
  const action = view.step.action;
  if (typeof action !== "object" || !("open" in action)) return null;
  // The label names where the button goes, so it comes from the cause whose link the step opens.
  const opens = (c: AutoObserveIssueContext["causes"]["top"][number]) =>
    !!c.record.open && sameLink(c.record.open, action.open);
  const target =
    cx.causes.top.find((c) => view.step.cites.includes(c.id) && opens(c)) ??
    cx.causes.top.find(opens);
  if (target)
    return {
      to: action.open,
      label: causeLinkLabel(t, target.record.kind),
      primary: isPrimaryKind(target.record.kind),
    };
  const logs = pagePath(action.open) === LOGS_PAGE;
  return {
    to: action.open,
    label: logs ? t("autoobserve.nextStep.openLogs") : raw(view.step.label),
    primary: false,
  };
};

const pagePath = (link: AutoObserveDeepLink): string => link.path.replace(/^\/+/, "");

const sameLink = (a: AutoObserveDeepLink, b: AutoObserveDeepLink): boolean => {
  const keys = Object.keys(a.query);
  return (
    pagePath(a) === pagePath(b) &&
    keys.length === Object.keys(b.query).length &&
    keys.every((k) => a.query[k] === b.query[k])
  );
};

const noteTextOf = (
  t: TranslateFn,
  note: StepNote,
  view: AutoObserveStepView,
  cx: AutoObserveIssueContext,
): I18nText | null => {
  if (note === "working") return t("autoobserve.nextStep.working");
  if (note === "judged") return t("autoobserve.nextStep.judged");
  if (note !== "ai") return null;
  const count = cx.causes.top.length + cx.causes.more;
  const used = cx.causes.top.filter((c) => view.step.cites.includes(c.id)).length;
  if (!used) return t("autoobserve.nextStep.ai");
  if (count === 1) return t("autoobserve.nextStep.aiOne");
  if (used === count) return t("autoobserve.nextStep.aiAll", { count });
  return t("autoobserve.nextStep.aiSome", { used, count });
};
