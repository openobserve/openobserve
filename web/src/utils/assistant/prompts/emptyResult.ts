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
  finish,
  ident,
  inline,
  promptRange,
  queryChip,
  type PromptBuild,
  type PromptRange,
} from "./format";

/** A Logs search that returned zero events. */
export interface EmptyResultInput {
  org: string;
  /** Every selected stream, not just the first. */
  streams: string[];
  mode: "sql" | "filter";
  query: string;
  range: PromptRange;
  timeZone: string;
}

/** Troubleshoot empty results: absolute range, every stream, SQL wording in SQL mode; the query is a chip. */
export function buildEmptyResultPrompt(input: EmptyResultInput, t: TranslateFn = gt): PromptBuild {
  const streams = input.streams.map(ident);
  const named = streams.length > 0 && streams.every(Boolean);
  const from = named ? ` from ${streams.map((s) => `\`${s}\``).join(", ")}` : "";
  const query = input.query.trim()
    ? queryChip(
        {
          org: input.org,
          query: input.query,
          language: input.mode === "sql" ? "SQL" : "filter",
          ...(input.streams[0] && { stream: input.streams[0] }),
          range: input.range,
        },
        t,
      )
    : null;
  const text = finish([
    `This ${input.mode === "sql" ? "SQL" : "filter"} query returned no rows${from} over ${promptRange(input.range, input.timeZone)}.`,
    query && "The query is in the attached Query block.",
    input.mode === "sql"
      ? "What in this SQL excludes rows?"
      : "Which part of the filter is too narrow?",
    "Suggest a change and the range to try.",
  ]);
  const name = input.streams.length
    ? input.streams.map((s) => inline(s, 40)).join(", ")
    : input.mode;
  return {
    text,
    chips: query ? [query] : [],
    title: t("assistant.entry.title.emptyResult", { name: raw(name) }),
  };
}
