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

import DOMPurify from "dompurify";
import { ref, watch, type Ref } from "vue";

export interface ColorizeSource {
  query: string;
  /** A Monaco language id: "sql", "promql", "json", "plaintext", … */
  language: string;
}

/** Sanitized, syntax-coloured HTML for a query; empty until it is coloured, so callers show plain text meanwhile. */
export const useColorizedQuery = (
  source: () => ColorizeSource,
  colorize: (query: string, language: string) => Promise<string>,
): Ref<string> => {
  const html = ref("");
  let run = 0;

  watch(
    [() => source().query, () => source().language],
    async ([query, language]) => {
      const current = ++run;
      html.value = "";
      if (!query) return;
      try {
        const coloured = await colorize(query, language);
        // A later query started its own run while this one awaited.
        if (current === run) html.value = DOMPurify.sanitize(coloured);
      } catch {
        // The caller's plain text stays as the fallback when the colorizer fails.
      }
    },
    { immediate: true },
  );

  return html;
};
