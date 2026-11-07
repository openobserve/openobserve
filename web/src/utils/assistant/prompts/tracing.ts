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

import {
  doorChip,
  finish,
  ident,
  inline,
  promptRange,
  queryChip,
  type PromptBuild,
  type PromptRange,
} from "./format";
import { errorPlainText } from "./queryError";

/** A Traces search that failed or found nothing. */
export interface TracingQueryInput {
  org: string;
  mode: "spans" | "traces";
  /** The WHERE-clause filter as written; empty means none. */
  filter: string;
  stream: string;
  range: PromptRange;
  timeZone: string;
  /** The server's error, possibly HTML; absent when the search found nothing. */
  error?: string;
}

// The error chip names the error by its first characters, as on Logs.
const LABEL_CHARS = 40;

export function buildTracingSetupPrompt(t: TranslateFn = gt): PromptBuild {
  return {
    text: "I don't have any trace streams in OpenObserve yet and want to start sending traces. How do I instrument my services to send traces (e.g. via OpenTelemetry / OTLP)?",
    chips: [],
    title: t("assistant.entry.title.setUpTracing"),
  };
}

export function buildTracingQueryPrompt(
  input: TracingQueryInput,
  t: TranslateFn = gt,
): PromptBuild {
  const error = input.error ? errorPlainText(input.error) : "";
  const errorChips = error
    ? [
        doorChip({
          kind: "query_error",
          key: `${input.org}|${input.stream}|${input.filter}|${error}`,
          label: t("assistant.context.chip.queryError", { name: raw(inline(error, LABEL_CHARS)) }),
          ref: {
            type: "query_error",
            org: input.org,
            stream: input.stream,
            streamType: "traces",
            from: input.range.from,
            to: input.range.to,
          },
          data: { error, language: "filter" },
          sent: "serialized",
        }),
      ]
    : [];
  const filter = input.filter.trim()
    ? queryChip(
        {
          org: input.org,
          query: input.filter,
          language: "filter",
          stream: input.stream,
          range: input.range,
        },
        t,
      )
    : null;
  const chips = filter ? [...errorChips, filter] : errorChips;
  const stream = ident(input.stream);
  const text = finish([
    error
      ? "The traces query produced an error; it is in the attached Query error block."
      : "The traces query ran successfully but returned no results.",
    `I am searching ${input.mode}.`,
    filter
      ? "The filter expression is in the attached Query block. It is a WHERE-clause filter, not a full SQL query."
      : "No filter is set.",
    `${stream ? `Stream: \`${stream}\`. ` : ""}Time range: ${promptRange(input.range, input.timeZone)}.`,
    "Can you help me adjust the filter to get results?",
  ]);
  const title =
    chips[0]?.label ?? t("assistant.entry.title.emptyResult", { name: raw(input.stream) });
  return { text, chips, title };
}
