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

/**
 * DbmEmptyState's trace check exists only if the pages SUPPLY the count.
 *
 * The prop defaults to `null` — "nobody counted" — and the component then
 * omits the trace row entirely. That is the exact dead-code path this file
 * exists to keep closed: with the prop unwired, a never-instrumented org's
 * only failing row was "We haven't finished counting yet … a few minutes",
 * rendered indefinitely, while the correct diagnosis ("built from traces, and
 * this organisation hasn't sent any yet") sat unreachable in the component.
 * DbmEmptyState.spec.ts pins what each count renders; what is pinned HERE is
 * that the pages actually pass one, and resolve it when the empty state
 * shows.
 *
 * Read off the source, for the reason dbmRequestGuard.spec.ts gives.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = (page: string) => readFileSync(join(here, page), "utf8");

/** The `<DbmEmptyState … />` element, template only. */
const emptyStateTag = (page: string): string => {
  const text = source(page);
  const open = text.indexOf("<DbmEmptyState");
  expect(open, `${page} must render DbmEmptyState`).toBeGreaterThan(-1);
  const close = text.indexOf("/>", open);
  expect(close, "the DbmEmptyState tag must be closed").toBeGreaterThan(open);
  return text.slice(open, close);
};

// The second column names the ref each page's load counts its rows in —
// SamplesPage keeps the server rows in `allRows` (its `rows` is the
// client-side search projection, which must not gate the probe).
describe.each([
  ["DatabasesPage.vue", "rows"],
  ["QueriesPage.vue", "rows"],
  ["SamplesPage.vue", "allRows"],
])("%s", (page, rowsRef) => {
  it("binds a trace count so the zero-trace diagnosis can render", () => {
    expect(emptyStateTag(page)).toContain(':trace-count="traceCount"');
  });

  it("owns a presence probe to resolve that count", () => {
    expect(source(page)).toContain(
      "const { traceCount, probeTracePresence } = useDbmTracePresence(getStreams);",
    );
  });

  it("probes when a load ends empty — the only moment the answer is used", () => {
    expect(source(page)).toContain(`if (!${rowsRef}.value.length) void probeTracePresence();`);
  });
});
