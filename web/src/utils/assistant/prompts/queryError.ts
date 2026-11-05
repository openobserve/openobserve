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

/** A failed query on Logs (or any page with `QueryErrorState`). */
export interface QueryErrorInput {
  org: string;
  streams: string[];
  streamType?: string;
  /** "SQL", "filter", "PromQL", "VRL": the language the user wrote. */
  language: string;
  query: string;
  /** The server's error, which may be HTML; only its text is kept. */
  error: string;
  range: PromptRange;
  timeZone: string;
}

// The chip label names the error by its first characters.
const LABEL_CHARS = 40;

/** The error as plain text, parsed on a detached document so no markup ever runs or renders. */
export function errorPlainText(error: string): string {
  if (!/[<&]/.test(error)) return error.trim();
  const doc = new DOMParser().parseFromString(error, "text/html");
  doc.querySelectorAll("script, style").forEach((el) => el.remove());
  doc.querySelectorAll("br").forEach((el) => el.replaceWith(" "));
  return (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Troubleshoot this query: the error and the query are server output and user text, so both are chips. */
export function buildQueryErrorPrompt(input: QueryErrorInput, t: TranslateFn = gt): PromptBuild {
  const error = errorPlainText(input.error);
  const label = t("assistant.context.chip.queryError", { name: raw(inline(error, LABEL_CHARS)) });
  const chip = doorChip({
    kind: "query_error",
    key: `${input.org}|${input.streams.join(",")}|${input.query}|${error}`,
    label,
    ref: {
      type: "query_error",
      org: input.org,
      ...(input.streams[0] && { stream: input.streams[0] }),
      streamType: input.streamType ?? "logs",
      from: input.range.from,
      to: input.range.to,
    },
    data: { error, language: input.language, streams: input.streams },
    sent: "serialized",
  });
  const query = input.query.trim()
    ? queryChip(
        {
          org: input.org,
          query: input.query,
          language: input.language,
          ...(input.streams[0] && { stream: input.streams[0] }),
          range: input.range,
        },
        t,
      )
    : null;
  const language = ident(input.language);
  const streams = input.streams.map(ident);
  const named = streams.length > 0 && streams.every(Boolean);
  const text = finish([
    `This ${language ? `${language} ` : ""}query failed${named ? ` on ${streams.map((s) => `\`${s}\``).join(", ")}` : ""} over ${promptRange(input.range, input.timeZone)}.`,
    "The error is in the attached Query error block.",
    query && "The query is in the attached Query block.",
    "What should I change?",
  ]);
  return { text, chips: query ? [chip, query] : [chip], title: label };
}
