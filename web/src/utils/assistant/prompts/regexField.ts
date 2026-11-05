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

import { doorChip, inline, type PromptBuild, type PromptRange } from "./format";

/** A log field the user wants a regex pattern for; the sample is one observed value. */
export interface RegexFieldInput {
  org: string;
  stream: string;
  streamType?: string;
  /** Empty for a selection, which belongs to no single field. */
  field: string;
  sample: string;
  range?: PromptRange;
}

// The chip label shows this much of the sample; the chip's data carries all of it.
const LABEL_SAMPLE_CHARS = 40;

/** The `Field · {field} = {sample}` chip the regex dock receives with the prompt. */
export function regexFieldChip(
  input: RegexFieldInput,
  t: TranslateFn = gt,
): PromptBuild["chips"][number] {
  const shown = inline(input.sample, LABEL_SAMPLE_CHARS);
  const name = input.field ? `${input.field} = ${shown}` : shown;
  return doorChip({
    kind: "field",
    key: `${input.org}|${input.stream}|regex|${input.field}|${input.sample}`,
    label: t("assistant.context.chip.field", { name: raw(name) }),
    short: raw(input.field || shown),
    ref: {
      type: "log_field",
      org: input.org,
      stream: input.stream,
      streamType: input.streamType ?? "logs",
      ...(input.range && { from: input.range.from, to: input.range.to }),
    },
    data: { field: input.field, value: input.sample },
    sent: "serialized",
  });
}

/** The regex hand-off's prompt; the sample is observed data, so it travels only in the chip, and the prompt ends in its one question. */
export function buildRegexFieldPrompt(input: RegexFieldInput, t: TranslateFn = gt): PromptBuild {
  const chip = regexFieldChip(input, t);
  const where = input.field ? `, in field \`${inline(input.field)}\`` : "";
  const text = `Which regex matches values like the sample in the attached Field block${where}?`;
  return { text, chips: [chip], title: chip.label };
}
