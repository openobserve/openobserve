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
 * The loading skeleton covers the database-reported fallback read.
 *
 * On an org with no trace streams the client read short-circuits in
 * single-digit milliseconds, so an unawaited fallback produced this
 * sequence: the empty state pops with no visible loading at all, then the
 * database-reported table appears beneath it ~half a second later. Next to
 * tabs whose reads are slow enough to draw the skeleton, the jump reads as
 * broken — and the page repaints twice for one question.
 *
 * Awaiting the fallback inside `load()` keeps `loading` true for the read's
 * real duration: one skeleton, then the empty state and the fallback list
 * paint together. On an org with client rows nothing changes — the fallback
 * is never fired.
 *
 * Source-read like dbmRequestGuard.spec.ts, and for the same reason: these
 * views need a router, a store and a dozen O2 children to mount, and a
 * harness that heavy fails for unrelated reasons and gets deleted.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

/** The two trace-derived pages, paired with their fallback read. */
const PAGES: Array<[page: string, fallback: string]> = [
  ["QueriesPage.vue", "loadServerQueries"],
  ["SamplesPage.vue", "loadServerSamples"],
];

describe("DBM fallback reads settle before the skeleton clears", () => {
  it.each(PAGES)("%s awaits its fallback read", (page, fallback) => {
    expect(read(page)).toContain(`await ${fallback}(token)`);
  });

  it.each(PAGES)("%s never fires the fallback unawaited", (page, fallback) => {
    expect(read(page)).not.toContain(`void ${fallback}(`);
  });
});
