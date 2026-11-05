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

import { gt, type TranslateFn } from "@/types/i18n";

import { finish, ident, type PromptBuild } from "./format";

/** An org with no stream of a type yet (`LogsNoDataState`). */
export interface NoStreamInput {
  org: string;
  /** "logs", "metrics", "traces". */
  streamType: string;
  /** The platform the user picked, when the page knows it. */
  platform?: string;
}

/** Help me set up ingestion: a real setup question, never the fix-my-filter prompt. */
export function buildNoStreamPrompt(input: NoStreamInput, t: TranslateFn = gt): PromptBuild {
  const type = ident(input.streamType) ?? "logs";
  const org = ident(input.org);
  const platform = input.platform ? ident(input.platform) : null;
  const text = finish([
    org
      ? `There are no ${type} streams in organization \`${org}\` yet.`
      : `There are no ${type} streams in this organization yet.`,
    `How do I send my first ${type} to OpenObserve?`,
    platform && `I'm on ${platform}.`,
  ]);
  return { text, chips: [], title: t("assistant.entry.title.setUpIngestion") };
}
