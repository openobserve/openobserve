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

import { useAssistantName } from "@/composables/assistant/pure";
import { gt, raw, type TranslateFn } from "@/types/i18n";

import { doorChip, finish, inline, type PromptBuild } from "./format";

/** The verdict and report text sent with "Continue in the assistant". */
export const MAX_VERDICT_CHARS = 16_000;

/** An on-call verdict or report card. */
export interface OnCallVerdictInput {
  org: string;
  /** The response or alert the verdict belongs to. */
  id: string;
  name: string;
  verdict: string;
  report?: string;
}

/** Continue in the assistant from an on-call verdict: the verdict as a block, the next-step question in the text. */
export function buildOnCallVerdictPrompt(
  input: OnCallVerdictInput,
  t: TranslateFn = gt,
): PromptBuild {
  const name = inline(input.name || input.id, 60);
  const text = finish([
    "Explain the on-call verdict in the attached Report block and what to do next.",
    "Say which evidence supports it and what would change it.",
  ]);
  const body = [input.verdict, input.report].filter(Boolean).join("\n\n");
  const chip = doorChip({
    kind: "report",
    key: `${input.org}|oncall_verdict|${input.id}`,
    label: t("oncall.verdictByAssistant", useAssistantName()),
    short: raw(name),
    ref: { type: "oncall_verdict", id: input.id, org: input.org },
    data: { name: input.name, verdict: body.slice(0, MAX_VERDICT_CHARS) },
    sent: "serialized",
  });
  return { text, chips: [chip], title: raw(name) };
}
