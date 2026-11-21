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

import { gt, raw, type TranslateFn } from "@/types/i18n";

import { doorChip, finish, inline, type PromptBuild } from "./format";

/** The ask text sent with "Continue in the assistant". */
export const MAX_ASK_CHARS = 16_000;

/** One AutoObserve ask card. */
export interface AutoObserveAskInput {
  org: string;
  id: string;
  title: string;
  body: string;
}

/** Continue in the assistant from an AutoObserve ask: the ask as a block, the decision question in the text. */
export function buildAutoObserveAskPrompt(
  input: AutoObserveAskInput,
  t: TranslateFn = gt,
): PromptBuild {
  const name = inline(input.title || input.id, 60);
  const text = finish([
    "AutoObserve asked the question in the attached Report block.",
    "Explain what it found, what each choice would do, and which one you recommend.",
  ]);
  const chip = doorChip({
    kind: "report",
    key: `${input.org}|autoobserve_ask|${input.id}`,
    label: t("assistant.autoobserve.askChip", { name: raw(name) }),
    short: raw(name),
    ref: { type: "autoobserve_ask", id: input.id, org: input.org },
    data: { title: input.title, body: input.body.slice(0, MAX_ASK_CHARS) },
    sent: "serialized",
  });
  return { text, chips: [chip], title: raw(name) };
}
